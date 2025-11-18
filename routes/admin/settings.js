'use strict';

const path = require('path');
const fs = require('fs');
const { getDb, ensureFormCustomizationTenantId } = require('../../utils/db');
const { registerAdminRoute, getTenantId } = require('../../utils/routeHelper');
const { requireAdmin } = require('../../middleware/auth');
const { buildTenantEmailFrom, getTenantMailgunDomain, transporter } = require('../../utils/email');
const { generateQRDataURL, generateQRBuffer } = require('../../utils/qrcode');
const { logAction } = require('../../routes/auth');
const logger = require('../../utils/logger');

const DEFAULT_TENANT_SLUG = process.env.DEFAULT_TENANT_SLUG || 'default';
const UPLOADS_BASE_DIR = process.env.UPLOADS_DIR
    ? path.resolve(process.env.UPLOADS_DIR)
    : path.join(__dirname, '../../static', 'uploads');

/**
 * Setup settings routes.
 * 
 * Registers all settings-related admin routes (both legacy and tenant-scoped variants).
 * 
 * Routes registered:
 * - GET /api/admin/test-email - Test email configuration
 * - PUT /api/admin/email-from-name - Update email sender name
 * - GET /api/admin/email-from-name - Get email sender name
 * - GET /api/admin/form-customization - Get form customization (legacy)
 * - POST /api/admin/form-customization - Update form customization (legacy)
 * - GET /api/admin/email-template - Get email template
 * - POST /api/admin/email-template - Update email template
 * - POST /api/admin/upload-image - Upload image file
 * - GET /api/admin/brand-settings - Get brand settings (legacy)
 * 
 * @param {Express.App} app - Express application instance
 * @returns {void}
 */
function setupSettingsRoutes(app) {
    /**
     * GET /api/admin/test-email and /t/:tenantSlug/api/admin/test-email - Test email configuration
     * 
     * Sends a test email using the tenant's email configuration (sender name, domain, etc.).
     * Useful for verifying email setup and Mailgun integration.
     * 
     * @route GET /api/admin/test-email
     * @route GET /t/:tenantSlug/api/admin/test-email
     * @middleware requireAdmin (legacy) | tenantLoader, requireSameTenantAsSession, requireRole('admin') (tenant-scoped)
     * 
     * @param {ExpressRequest} req - Express request object
     * @param {ExpressRequest.query} req.query - Query parameters
     * @param {string} [req.query.to] - Email recipient (defaults to MAIL_TEST_TO env var or 'test@example.com')
     * @param {Express.Response} res - Express response object
     * 
     * @returns {Object} Test email result
     * @returns {boolean} returns.ok - Whether email was sent successfully
     * @returns {Object} returns.info - Email transport info (messageId, etc.)
     * 
     * @throws {500} Internal Server Error - If email sending fails
     * 
     * @example
     * // Request
     * GET /api/admin/test-email?to=admin@example.com
     * 
     * // Response
     * {
     *   ok: true,
     *   info: {
     *     messageId: "<message-id@mailgun.org>",
     *     accepted: ["admin@example.com"]
     *   }
     * }
     */
    registerAdminRoute(app, '/test-email', 'get', async (req, res) => {
        try {
            const to = req.query.to || process.env.MAIL_TEST_TO || 'test@example.com';
            
            // Load tenant (if any) to honor per-tenant sender/domain
            let tenant = null;
            const dbConn = await getDb();
            if (req.tenant?.id) {
                // Tenant-scoped route: tenant already loaded
                tenant = await dbConn.get('SELECT email_from_name, email_from_address, mailgun_domain, mailgun_region FROM tenants WHERE id = ?', req.tenant.id);
            } else if (req.session?.user?.tenantSlug) {
                // Legacy route: load tenant from session
                try {
                    tenant = await dbConn.get('SELECT email_from_name, email_from_address, mailgun_domain, mailgun_region FROM tenants WHERE slug = ?', req.session.user.tenantSlug);
                } catch (e) {
                    logger.warn({ err: e, tenantSlug: req.session?.user?.tenantSlug }, 'Error getting tenant for test email');
                }
            }

            const senderName = (tenant && tenant.email_from_name) || 'CouponGen';
            const html = `<p>Test email da ${senderName} - Mailgun integrazione da CouponGen.</p>`;
            const message = {
                from: buildTenantEmailFrom(tenant),
                to,
                subject: `Test Email - ${senderName}`,
                html,
                mailgunDomain: getTenantMailgunDomain(tenant)
            };
            const info = await transporter.sendMail(message);
            res.json({ ok: true, info });
        } catch (e) {
            const logContext = logger.withRequest(req);
            logContext.error({ err: e, to: req.query.to }, 'Test email error');
            res.status(500).json({ ok: false, error: String(e?.message || e) });
        }
    });

    /**
     * PUT /api/admin/email-from-name and /t/:tenantSlug/api/admin/email-from-name - Update email sender name
     * 
     * Updates the email sender name (display name) for the tenant.
     * This name appears in the "From" field of emails sent by the tenant.
     * 
     * @route PUT /api/admin/email-from-name
     * @route PUT /t/:tenantSlug/api/admin/email-from-name
     * @middleware requireAdmin (legacy) | tenantLoader, requireSameTenantAsSession, requireRole('admin') (tenant-scoped)
     * 
     * @param {ExpressRequest} req - Express request object
     * @param {ExpressRequest.body} req.body - Request body
     * @param {string} req.body.emailFromName - Email sender name (required, non-empty string)
     * @param {Express.Response} res - Express response object
     * 
     * @returns {Object} Update result
     * @returns {boolean} returns.ok - Whether update was successful
     * @returns {string} returns.emailFromName - Updated email sender name
     * 
     * @throws {400} Bad Request - If emailFromName is missing, invalid, or tenant ID is invalid
     * @throws {500} Internal Server Error - If database update fails
     * 
     * @example
     * // Request body
     * {
     *   emailFromName: "Mario's Store"
     * }
     * 
     * // Response
     * {
     *   ok: true,
     *   emailFromName: "Mario's Store"
     * }
     */
    registerAdminRoute(app, '/email-from-name', 'put', async (req, res) => {
        try {
            const { emailFromName } = req.body || {};
            if (!emailFromName || typeof emailFromName !== 'string' || emailFromName.trim().length === 0) {
                return res.status(400).json({ error: 'Nome mittente email richiesto' });
            }
            
            const dbConn = await getDb();
            const tenantId = await getTenantId(req);
            if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
            
            // Update tenant by ID (works for both legacy and tenant-scoped routes)
            await dbConn.run('UPDATE tenants SET email_from_name = ? WHERE id = ?', emailFromName.trim(), tenantId);
            
            // Log the action
            await logAction(req, 'update', `Nome mittente email aggiornato: ${emailFromName.trim()}`, 'info');
            
            res.json({ ok: true, emailFromName: emailFromName.trim() });
        } catch (e) {
            const logContext = logger.withRequest(req);
            logContext.error({ err: e }, 'Error updating email from name');
            res.status(500).json({ error: 'Errore server' });
        }
    });

    /**
     * GET /api/admin/email-from-name and /t/:tenantSlug/api/admin/email-from-name - Get email sender name
     * 
     * Retrieves the current email sender name for the tenant.
     * Returns default "CouponGen" if not set.
     * 
     * @route GET /api/admin/email-from-name
     * @route GET /t/:tenantSlug/api/admin/email-from-name
     * @middleware requireAdmin (legacy) | tenantLoader, requireSameTenantAsSession, requireRole('admin') (tenant-scoped)
     * 
     * @param {ExpressRequest} req - Express request object
     * @param {Express.Response} res - Express response object
     * 
     * @returns {Object} Email sender name
     * @returns {string} returns.emailFromName - Current email sender name (default: "CouponGen")
     * 
     * @throws {500} Internal Server Error - If database query fails
     * 
     * @example
     * // Response
     * {
     *   emailFromName: "Mario's Store"
     * }
     */
    registerAdminRoute(app, '/email-from-name', 'get', async (req, res) => {
        try {
            const dbConn = await getDb();
            const tenantId = await getTenantId(req);
            if (!tenantId) return res.json({ emailFromName: 'CouponGen' });
            
            const tenant = await dbConn.get('SELECT email_from_name FROM tenants WHERE id = ?', tenantId);
            const emailFromName = tenant?.email_from_name || 'CouponGen';
            res.json({ emailFromName });
        } catch (e) {
            logger.error({ err: e }, 'Error fetching email from name');
            res.status(500).json({ error: 'Errore server' });
        }
    });

    /**
     * GET /api/admin/form-customization - Get form customization (legacy)
     * 
     * Retrieves the form customization configuration for the tenant.
     * Returns empty object if no configuration exists.
     * 
     * @route GET /api/admin/form-customization
     * @middleware requireAdmin
     * 
     * @param {ExpressRequest} req - Express request object
     * @param {ExpressRequest.session} req.session - Session object
     * @param {Object} req.session.user - User session data
     * @param {number} req.session.user.tenantId - Tenant ID from session
     * @param {Express.Response} res - Express response object
     * 
     * @returns {Object} Form customization configuration object (parsed JSON)
     * 
     * @throws {400} Bad Request - If tenant ID is invalid
     * @throws {500} Internal Server Error - If database query fails
     * 
     * @example
     * // Response
     * {
     *   email: { visible: true, required: true },
     *   firstName: { visible: true, required: true },
     *   lastName: { visible: true, required: true },
     *   phone: { visible: false, required: false },
     *   customFields: []
     * }
     */
    app.get('/api/admin/form-customization', requireAdmin, async (req, res) => {
        try {
            const dbConn = await getDb();
            await ensureFormCustomizationTenantId(dbConn);
            const tenantId = req.session.user.tenantId;
            if (!tenantId) {
                return res.status(400).json({ error: 'Tenant non valido' });
            }
            const config = await dbConn.get('SELECT * FROM form_customization WHERE tenant_id = ?', tenantId);
            if (config) {
                res.json(JSON.parse(config.config_data));
            } else {
                res.json({});
            }
        } catch (error) {
            logger.error({ err: error }, 'Errore caricamento configurazione form');
            res.status(500).json({ success: false, message: 'Errore durante il caricamento della configurazione' });
        }
    });

    /**
     * POST /api/admin/form-customization - Update form customization (legacy)
     * 
     * Updates or creates the form customization configuration for the tenant.
     * Configuration is stored as JSON string in the database.
     * 
     * @route POST /api/admin/form-customization
     * @middleware requireAdmin
     * 
     * @param {ExpressRequest} req - Express request object
     * @param {ExpressRequest.body} req.body - Form customization configuration object (will be stringified)
     * @param {ExpressRequest.session} req.session - Session object
     * @param {Object} req.session.user - User session data
     * @param {number} req.session.user.tenantId - Tenant ID from session
     * @param {Express.Response} res - Express response object
     * 
     * @returns {Object} Update result
     * @returns {boolean} returns.success - Whether update was successful
     * @returns {string} returns.message - Success message
     * 
     * @throws {400} Bad Request - If tenant ID is invalid
     * @throws {500} Internal Server Error - If database update fails
     * 
     * @example
     * // Request body
     * {
     *   email: { visible: true, required: true },
     *   firstName: { visible: true, required: true },
     *   customFields: [
     *     { name: "favoriteColor", label: "Favorite Color", type: "text" }
     *   ]
     * }
     * 
     * // Response
     * {
     *   success: true,
     *   message: "Configurazione salvata con successo!"
     * }
     */
    app.post('/api/admin/form-customization', requireAdmin, async (req, res) => {
        try {
            const dbConn = await getDb();
            await ensureFormCustomizationTenantId(dbConn);
            const tenantId = req.session.user.tenantId;
            if (!tenantId) {
                return res.status(400).json({ error: 'Tenant non valido' });
            }
            const configData = JSON.stringify(req.body);
            
            // Check if config exists for this tenant
            const existing = await dbConn.get('SELECT id FROM form_customization WHERE tenant_id = ?', tenantId);
            
            if (existing) {
                // Update existing configuration
                await dbConn.run(`
                    UPDATE form_customization 
                    SET config_data = ?, updated_at = datetime('now')
                    WHERE tenant_id = ?
                `, configData, tenantId);
            } else {
                // Insert new configuration
                await dbConn.run(`
                    INSERT INTO form_customization (tenant_id, config_data, updated_at) 
                    VALUES (?, ?, datetime('now'))
                `, tenantId, configData);
            }
            
            res.json({ success: true, message: 'Configurazione salvata con successo!' });
        } catch (error) {
            logger.error({ err: error }, 'Errore salvataggio configurazione form');
            res.status(500).json({ success: false, message: 'Errore durante il salvataggio della configurazione' });
        }
    });

    /**
     * GET /api/admin/email-template and /t/:tenantSlug/api/admin/email-template - Get email template
     * 
     * Retrieves the current email template for the tenant.
     * Returns the subject and HTML template, or default values if no template exists.
     * 
     * @route GET /api/admin/email-template
     * @route GET /t/:tenantSlug/api/admin/email-template
     * @middleware requireAdmin (legacy) | tenantLoader, requireSameTenantAsSession, requireRole('admin') (tenant-scoped)
     * 
     * @param {ExpressRequest} req - Express request object
     * @param {Express.Response} res - Express response object
     * 
     * @returns {Object} Email template data
     * @returns {string} returns.subject - Email subject line
     * @returns {string} returns.html - Email HTML template
     * 
     * @throws {400} Bad Request - If tenant ID is invalid
     * @throws {500} Internal Server Error - If database query fails
     * 
     * @example
     * // Response
     * {
     *   subject: "Il tuo coupon",
     *   html: "<html><body><h1>Ciao {{firstName}}!</h1><p>Il tuo codice: {{code}}</p></body></html>"
     * }
     */
    registerAdminRoute(app, '/email-template', 'get', async (req, res) => {
        try {
            logger.info({ path: req.path, method: req.method, tenantSlug: req.params.tenantSlug }, 'GET email-template route called');
            const dbConn = await getDb();
            const tenantId = await getTenantId(req);
            if (!tenantId) {
                logger.warn({ tenantId }, 'Tenant ID not found in GET email-template');
                return res.status(400).json({ error: 'Tenant non valido' });
            }
            
            // Get template for this tenant
            const template = await dbConn.get('SELECT subject, html FROM email_template WHERE tenant_id = ?', tenantId);
            
            if (template) {
                res.json({ subject: template.subject, html: template.html });
            } else {
                // Return default values if no template exists
                res.json({ subject: 'Il tuo coupon', html: '' });
            }
        } catch (e) {
            logger.error({ err: e }, 'Errore get email template');
            res.status(500).json({ error: 'Errore server' });
        }
    });

    /**
     * POST /api/admin/email-template and /t/:tenantSlug/api/admin/email-template - Update email template
     * 
     * Updates or creates the email template for coupon emails sent by the tenant.
     * Template supports placeholders like {{code}}, {{firstName}}, {{lastName}}, {{discountText}}, {{qrDataUrl}}.
     * 
     * @route POST /api/admin/email-template
     * @route POST /t/:tenantSlug/api/admin/email-template
     * @middleware requireAdmin (legacy) | tenantLoader, requireSameTenantAsSession, requireRole('admin') (tenant-scoped)
     * 
     * @param {ExpressRequest} req - Express request object
     * @param {ExpressRequest.body} req.body - Request body
     * @param {string} req.body.subject - Email subject line (required)
     * @param {string} req.body.html - Email HTML template (required)
     * @param {Express.Response} res - Express response object
     * 
     * @returns {Object} Update result
     * @returns {boolean} returns.success - Whether update was successful
     * 
     * @throws {400} Bad Request - If subject or html is missing, or tenant ID is invalid
     * @throws {500} Internal Server Error - If database update fails
     * 
     * @example
     * // Request body
     * {
     *   subject: "Il tuo coupon",
     *   html: "<html><body><h1>Ciao {{firstName}}!</h1><p>Il tuo codice: {{code}}</p></body></html>"
     * }
     * 
     * // Response
     * {
     *   success: true
     * }
     */
    registerAdminRoute(app, '/email-template', 'post', async (req, res) => {
        try {
            const { subject, html } = req.body || {};
            if (!subject || !html) {
                return res.status(400).json({ error: 'Subject e html sono richiesti' });
            }
            const dbConn = await getDb();
            const tenantId = await getTenantId(req);
            if (!tenantId) {
                return res.status(400).json({ error: 'Tenant non valido' });
            }
            
            // Check if template exists for this tenant
            const existing = await dbConn.get('SELECT id FROM email_template WHERE tenant_id = ?', tenantId);
            
            if (existing) {
                // Update existing template
                await dbConn.run(
                    'UPDATE email_template SET subject = ?, html = ?, updated_at = datetime("now") WHERE tenant_id = ?',
                    subject, html, tenantId
                );
            } else {
                // Create new template for tenant
                await dbConn.run(
                    'INSERT INTO email_template (tenant_id, subject, html, updated_at) VALUES (?, ?, ?, datetime("now"))',
                    tenantId, subject, html
                );
            }
            
            res.json({ success: true });
        } catch (e) {
            logger.error({ err: e }, 'Errore save email template');
            res.status(500).json({ error: 'Errore server' });
        }
    });

    /**
     * POST /api/admin/upload-image and /t/:tenantSlug/api/admin/upload-image - Upload image file
     * 
     * Uploads an image file from a data URL (base64 encoded).
     * Images are stored in tenant-specific upload directories.
     * Supports PNG, JPEG, JPG, and WebP formats with size limit (default 2MB).
     * 
     * @route POST /api/admin/upload-image
     * @route POST /t/:tenantSlug/api/admin/upload-image
     * @middleware requireAdmin (legacy) | tenantLoader, requireSameTenantAsSession, requireRole('admin') (tenant-scoped)
     * 
     * @param {ExpressRequest} req - Express request object
     * @param {ExpressRequest.body} req.body - Request body
     * @param {string} req.body.dataUrl - Base64-encoded data URL (format: "data:image/png;base64,...") (required)
     * @param {Express.Response} res - Express response object
     * 
     * @returns {Object} Upload result
     * @returns {string} returns.url - Public URL path to uploaded image (e.g., "/api/uploads/tenant-slug/filename.png")
     * 
     * @throws {400} Bad Request - If dataUrl is missing, invalid format, unsupported MIME type, or file too large
     * @throws {500} Internal Server Error - If file write fails
     * 
     * @example
     * // Request body
     * {
     *   dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
     * }
     * 
     * // Response
     * {
     *   url: "/api/uploads/default/header-1234567890-abc123.png"
     * }
     */
    registerAdminRoute(app, '/upload-image', 'post', async (req, res) => {
        try {
            const { dataUrl } = req.body || {};
            if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
                return res.status(400).json({ error: 'dataUrl mancante o non valido' });
            }
            const match = dataUrl.match(/^data:(.*?);base64,(.*)$/);
            if (!match) return res.status(400).json({ error: 'Formato dataUrl non valido' });
            const mime = match[1];
            const base64 = match[2];
            // Whitelist mime types and size limit (~2MB)
            const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
            if (!allowed.includes(mime)) {
                return res.status(400).json({ error: 'Tipo file non consentito' });
            }
            const buffer = Buffer.from(base64, 'base64');
            if (buffer.length > (Number(process.env.UPLOAD_MAX_BYTES || 2 * 1024 * 1024))) {
                return res.status(400).json({ error: 'File troppo grande' });
            }
            const ext = mime.includes('png') ? 'png' : mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : mime.includes('webp') ? 'webp' : 'png';
            
            // Get tenant slug for upload directory
            let tenantSlug = DEFAULT_TENANT_SLUG;
            if (req.tenant?.slug) {
                tenantSlug = req.tenant.slug;
            } else if (req.session?.user?.tenantSlug) {
                tenantSlug = req.session.user.tenantSlug;
            }
            
            // Ensure uploads dir exists
            const uploadsDir = path.join(UPLOADS_BASE_DIR, tenantSlug);
            if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
            const filename = `header-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
            const filePath = path.join(uploadsDir, filename);
            fs.writeFileSync(filePath, buffer);
            // Use protected endpoint instead of public static
            const publicUrl = `/api/uploads/${tenantSlug}/${filename}`;
            res.json({ url: publicUrl });
        } catch (e) {
            logger.error({ err: e }, 'Upload image error');
            res.status(500).json({ error: 'Errore durante il caricamento immagine' });
        }
    });

    /**
     * GET /api/admin/brand-settings - Get brand settings (legacy)
     * 
     * Retrieves brand color settings for the tenant (primary, accent, light, background, text colors).
     * Returns empty object if no brand settings exist or tenant is invalid.
     * 
     * @route GET /api/admin/brand-settings
     * @middleware requireAdmin
     * 
     * @param {ExpressRequest} req - Express request object
     * @param {ExpressRequest.session} req.session - Session object
     * @param {Object} req.session.user - User session data
     * @param {number} [req.session.user.tenantId] - Tenant ID from session (optional)
     * @param {string} [req.session.user.tenantSlug] - Tenant slug from session (optional)
     * @param {Express.Response} res - Express response object
     * 
     * @returns {Object} Brand settings object
     * @returns {string} [returns.primary_color] - Primary brand color (hex)
     * @returns {string} [returns.accent_color] - Accent brand color (hex)
     * @returns {string} [returns.light_color] - Light brand color (hex)
     * @returns {string} [returns.background_color] - Background color (hex)
     * @returns {string} [returns.text_dark_color] - Dark text color (hex)
     * 
     * @throws {500} Internal Server Error - If database query fails
     * 
     * @example
     * // Response (when settings exist)
     * {
     *   primary_color: "#2d5a3d",
     *   accent_color: "#4a7c59",
     *   light_color: "#f8f9fa",
     *   background_color: "#ffffff",
     *   text_dark_color: "#333333"
     * }
     * 
     * // Response (when no settings)
     * {}
     */
    app.get('/api/admin/brand-settings', requireAdmin, async (req, res) => {
        try {
            const sess = req.session && req.session.user;
            if (!sess || (!sess.tenantId && !sess.tenantSlug)) {
                return res.json({});
            }
            const dbConn = await getDb();
            const tenant = sess.tenantId
                ? { id: sess.tenantId }
                : await dbConn.get('SELECT id FROM tenants WHERE slug = ?', sess.tenantSlug);
            if (!tenant || !tenant.id) return res.json({});
            const row = await dbConn.get('SELECT * FROM tenant_brand_settings WHERE tenant_id = ?', tenant.id);
            if (!row) return res.json({});
            res.json({
                primary_color: row.primary_color,
                accent_color: row.accent_color,
                light_color: row.light_color,
                background_color: row.background_color,
                text_dark_color: row.text_dark_color
            });
        } catch (e) {
            logger.error({ err: e }, 'Error fetching session tenant brand settings');
            res.json({});
        }
    });
}

module.exports = { setupSettingsRoutes };

