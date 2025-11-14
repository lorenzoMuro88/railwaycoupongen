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
 * Setup settings routes
 */
function setupSettingsRoutes(app) {
    // GET /api/admin/test-email and /t/:tenantSlug/api/admin/test-email - Test email
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

    // PUT /api/admin/email-from-name and /t/:tenantSlug/api/admin/email-from-name - Update email from name
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

    // GET /api/admin/email-from-name and /t/:tenantSlug/api/admin/email-from-name - Get email from name
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

    // GET /api/admin/form-customization - Get form customization (legacy)
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

    // POST /api/admin/form-customization - Update form customization (legacy)
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


    // POST /api/admin/email-template and /t/:tenantSlug/api/admin/email-template - Update email template
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

    // POST /api/admin/upload-image and /t/:tenantSlug/api/admin/upload-image - Upload image
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

    // GET /api/admin/brand-settings - Get brand settings (legacy)
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

