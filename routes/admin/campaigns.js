'use strict';

const crypto = require('crypto');
const { getDb } = require('../../utils/db');
const { registerAdminRoute, getTenantId } = require('../../utils/routeHelper');
const { tenantLoader, requireSameTenantAsSession } = require('../../middleware/tenant');
const { requireRole } = require('../../middleware/auth');
const logger = require('../../utils/logger');

/**
 * Helper function to generate unique alphanumeric IDs.
 * 
 * Generates a random ID using uppercase letters and numbers (A-Z, 0-9).
 * Used for generating campaign codes and form link tokens.
 * 
 * @param {number} [length=12] - Length of the generated ID (default: 12)
 * @returns {string} Random alphanumeric ID (uppercase)
 * 
 * @example
 * const campaignCode = generateId(12).toUpperCase(); // "ABC123XYZ456"
 * const token = generateId(16); // "ABC123XYZ456DEF7"
 */
function generateId(length = 12) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const bytes = crypto.randomBytes(length);
    let out = '';
    for (let i = 0; i < length; i++) {
        out += alphabet[bytes[i] % alphabet.length];
    }
    return out;
}

/**
 * Helper function: Auto-deactivate expired campaigns.
 * 
 * Checks all campaigns and automatically deactivates those with expiry_date in the past.
 * Updates both database and local campaign objects.
 * 
 * @param {Object} dbConn - Database connection object
 * @param {Array<Campaign>} campaigns - Array of campaign objects to check
 * @param {number} tenantId - Tenant ID for tenant isolation
 * @returns {Promise<void>}
 * 
 * @description
 * Side effects:
 * - Updates database: Sets `is_active = 0` for expired campaigns
 * - Updates local objects: Sets `campaign.is_active = 0` in provided array
 * 
 * @example
 * const campaigns = await dbConn.all('SELECT * FROM campaigns WHERE tenant_id = ?', tenantId);
 * await autoDeactivateExpiredCampaigns(dbConn, campaigns, tenantId);
 * // campaigns array now has updated is_active values
 */
async function autoDeactivateExpiredCampaigns(dbConn, campaigns, tenantId) {
    const now = new Date();
    for (const campaign of campaigns) {
        if (campaign.expiry_date && new Date(campaign.expiry_date) < now && campaign.is_active) {
            await dbConn.run('UPDATE campaigns SET is_active = 0 WHERE id = ? AND tenant_id = ?', campaign.id, tenantId);
            campaign.is_active = 0; // Update local object for response
        }
    }
}

/**
 * Setup campaigns routes.
 * 
 * Registers all campaign-related admin routes (both legacy and tenant-scoped variants).
 * 
 * Routes registered:
 * - GET /api/admin/campaigns - List all campaigns
 * - POST /api/admin/campaigns - Create new campaign
 * - PUT /api/admin/campaigns/:id - Update campaign
 * - DELETE /api/admin/campaigns/:id - Delete campaign
 * - PUT /api/admin/campaigns/:id/activate - Activate campaign
 * - PUT /api/admin/campaigns/:id/deactivate - Deactivate campaign
 * - GET /api/admin/campaigns/:id/form-config - Get form configuration
 * - PUT /api/admin/campaigns/:id/form-config - Update form configuration
 * - GET /api/admin/campaigns-list - Get campaigns list (for selects)
 * - GET /api/admin/campaigns/:id/custom-fields - Get custom fields
 * - PUT /api/admin/campaigns/:id/custom-fields - Update custom fields
 * - GET /api/admin/campaigns/:id/products - Get campaign products
 * - POST /api/admin/campaigns/:id/products - Update campaign products
 * - POST /t/:tenantSlug/api/admin/campaigns/:id/form-links - Generate form links (tenant-scoped only)
 * - GET /t/:tenantSlug/api/admin/campaigns/:id/form-links - List form links (tenant-scoped only)
 * 
 * @param {Express.App} app - Express application instance
 * @returns {void}
 */
function setupCampaignsRoutes(app) {
    /**
     * GET /api/admin/campaigns and /t/:tenantSlug/api/admin/campaigns - List campaigns
     * 
     * Returns all campaigns for the tenant, ordered by creation date (newest first).
     * Automatically deactivates expired campaigns before returning.
     * 
     * @route GET /api/admin/campaigns
     * @route GET /t/:tenantSlug/api/admin/campaigns
     * @middleware requireAdmin (legacy) | tenantLoader, requireSameTenantAsSession, requireRole('admin') (tenant-scoped)
     * 
     * @param {ExpressRequest} req - Express request object
     * @param {Express.Response} res - Express response object
     * 
     * @returns {Array<Campaign>} Array of campaign objects
     * 
     * @throws {400} Bad Request - If tenant ID is invalid
     * @throws {500} Internal Server Error - If database query fails
     * 
     * @example
     * // Response
     * [
     *   {
     *     id: 1,
     *     campaign_code: "ABC123XYZ456",
     *     name: "Sconto 20%",
     *     description: "Promozione estiva",
     *     is_active: 1,
     *     discount_type: "percent",
     *     discount_value: "20",
     *     expiry_date: "2024-12-31T23:59:59.000Z",
     *     created_at: "2024-01-01T00:00:00.000Z",
     *     tenant_id: 1
     *   }
     * ]
     */
    registerAdminRoute(app, '/campaigns', 'get', async (req, res) => {
        try {
            const dbConn = await getDb();
            const tenantId = await getTenantId(req);
            if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
            
            const campaigns = await dbConn.all('SELECT * FROM campaigns WHERE tenant_id = ? ORDER BY created_at DESC', tenantId);
            await autoDeactivateExpiredCampaigns(dbConn, campaigns, tenantId);
            res.json(campaigns);
        } catch (e) {
            logger.error({ err: e }, 'Error fetching campaigns');
            res.status(500).json({ error: 'Errore server' });
        }
    });

    /**
     * POST /api/admin/campaigns and /t/:tenantSlug/api/admin/campaigns - Create campaign
     * 
     * Creates a new campaign with auto-generated campaign_code.
     * Sets default form configuration if not provided.
     * 
     * @route POST /api/admin/campaigns
     * @route POST /t/:tenantSlug/api/admin/campaigns
     * @middleware requireAdmin (legacy) | tenantLoader, requireSameTenantAsSession, requireRole('admin') (tenant-scoped)
     * 
     * @param {ExpressRequest} req - Express request object
     * @param {ExpressRequest.body} req.body - Request body
     * @param {string} req.body.name - Campaign name (required, non-empty string)
     * @param {string} [req.body.description] - Campaign description (optional)
     * @param {string} req.body.discount_type - Discount type: "percent", "fixed", or "text" (required)
     * @param {string} req.body.discount_value - Discount value (required, numeric for percent/fixed)
     * @param {string} [req.body.expiry_date] - Expiry date ISO string (optional)
     * @param {Express.Response} res - Express response object
     * 
     * @returns {Object} Created campaign object with id and campaign_code
     * @returns {number} returns.id - Campaign ID
     * @returns {string} returns.campaign_code - Auto-generated campaign code
     * @returns {string} returns.name - Campaign name
     * @returns {string} returns.description - Campaign description
     * @returns {string} returns.discount_type - Discount type
     * @returns {string} returns.discount_value - Discount value
     * 
     * @throws {400} Bad Request - If name is invalid, required fields missing, or discount_type invalid
     * @throws {409} Conflict - If campaign_code already exists (shouldn't happen, but handled)
     * @throws {500} Internal Server Error - If database insert fails
     * @throws {503} Service Unavailable - If database is locked
     * 
     * @example
     * // Request body
     * {
     *   name: "Sconto 20%",
     *   description: "Promozione estiva",
     *   discount_type: "percent",
     *   discount_value: "20",
     *   expiry_date: "2024-12-31T23:59:59.000Z"
     * }
     * 
     * // Response
     * {
     *   id: 1,
     *   campaign_code: "ABC123XYZ456",
     *   name: "Sconto 20%",
     *   description: "Promozione estiva",
     *   discount_type: "percent",
     *   discount_value: "20"
     * }
     */
    registerAdminRoute(app, '/campaigns', 'post', async (req, res) => {
        let tenantId = null;
        try {
            const { name, description, discount_type, discount_value, expiry_date } = req.body || {};
            
            // Validation: check name is valid string
            if (typeof name !== 'string' || !name.trim()) {
                return res.status(400).json({ error: 'Nome non valido' });
            }
            
            // Validation: check required fields
            if (!name || !discount_type || !discount_value) {
                return res.status(400).json({ error: 'Nome, tipo sconto e valore richiesti' });
            }
            
            // Validation: check discount_type
            if (!['percent', 'fixed', 'text'].includes(String(discount_type))) {
                return res.status(400).json({ error: 'Tipo sconto non valido' });
            }
            
            // Validation: check discount_value is numeric (unless text type)
            if (discount_type !== 'text' && isNaN(Number(discount_value))) {
                return res.status(400).json({ error: 'Valore sconto non valido' });
            }
            
            const dbConn = await getDb();
            tenantId = await getTenantId(req);
            if (!tenantId) {
                logger.warn({ name, discount_type }, 'Campaign creation failed: invalid tenant');
                return res.status(400).json({ error: 'Tenant non valido' });
            }
            
            const campaignCode = generateId(12).toUpperCase();
            const defaultFormConfig = JSON.stringify({ 
                email: { visible: true, required: true }, 
                firstName: { visible: true, required: true }, 
                lastName: { visible: true, required: true },
                phone: { visible: false, required: false },
                address: { visible: false, required: false },
                allergies: { visible: false, required: false },
                customFields: []
            });
            const result = await dbConn.run(
                'INSERT INTO campaigns (campaign_code, name, description, discount_type, discount_value, form_config, tenant_id, is_active, expiry_date) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)',
                campaignCode, name, description || null, discount_type, discount_value, defaultFormConfig, tenantId, expiry_date || null
            );
            res.json({ id: result.lastID, campaign_code: campaignCode, name, description, discount_type, discount_value });
        } catch (e) {
            const logContext = logger.withRequest(req);
            if (e && e.code === 'SQLITE_CONSTRAINT' && e.message && e.message.includes('campaign_code')) {
                logContext.warn({ err: e, tenantId }, 'Campaign code already exists for tenant');
                return res.status(409).json({ error: 'Codice campagna già esistente per questo tenant' });
            }
            if (e && (e.code === 'SQLITE_BUSY' || e.code === 'SQLITE_LOCKED')) {
                return res.status(503).json({ error: 'Database temporaneamente occupato, riprova tra qualche istante' });
            }
            logContext.error({ err: e, name: req.body?.name, tenantId }, 'Error creating campaign');
            res.status(500).json({ error: 'Errore server' });
        }
    });

    // PUT /api/admin/campaigns/:id and /t/:tenantSlug/api/admin/campaigns/:id - Update campaign
    registerAdminRoute(app, '/campaigns/:id', 'put', async (req, res) => {
        try {
            const { name, description, discount_type, discount_value, expiry_date } = req.body || {};
            const fields = [];
            const params = [];
            if (typeof name === 'string') { fields.push('name = ?'); params.push(name); }
            if (typeof description === 'string') { fields.push('description = ?'); params.push(description); }
            if (typeof discount_type === 'string') { fields.push('discount_type = ?'); params.push(discount_type); }
            if (typeof discount_value === 'string') { fields.push('discount_value = ?'); params.push(discount_value); }
            if (typeof expiry_date === 'string' || expiry_date === null) { fields.push('expiry_date = ?'); params.push(expiry_date || null); }
            if (fields.length === 0) return res.status(400).json({ error: 'Nessun campo da aggiornare' });
            const dbConn = await getDb();
            const tenantId = await getTenantId(req);
            if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
            params.push(req.params.id, tenantId);
            await dbConn.run(`UPDATE campaigns SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ?`, params);
            const updated = await dbConn.get('SELECT * FROM campaigns WHERE id = ? AND tenant_id = ?', req.params.id, tenantId);
            if (!updated) return res.status(404).json({ error: 'Campagna non trovata' });
            res.json(updated);
        } catch (e) {
            logger.error({ err: e }, 'Error updating campaign');
            if (e && e.code === 'SQLITE_CONSTRAINT' && e.message && e.message.includes('campaign_code')) {
                return res.status(409).json({ error: 'Codice campagna già esistente' });
            }
            res.status(500).json({ error: 'Errore server' });
        }
    });

    // PUT /api/admin/campaigns/:id/activate and /t/:tenantSlug/api/admin/campaigns/:id/activate - Activate campaign
    registerAdminRoute(app, '/campaigns/:id/activate', 'put', async (req, res) => {
        try {
            const dbConn = await getDb();
            const tenantId = await getTenantId(req);
            if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
            const result = await dbConn.run('UPDATE campaigns SET is_active = 1 WHERE id = ? AND tenant_id = ?', req.params.id, tenantId);
            if (result.changes === 0) return res.status(404).json({ error: 'Campagna non trovata' });
            res.json({ ok: true });
        } catch (e) {
            logger.error({ err: e }, 'Error activating campaign');
            res.status(500).json({ error: 'Errore server' });
        }
    });

    // PUT /api/admin/campaigns/:id/deactivate and /t/:tenantSlug/api/admin/campaigns/:id/deactivate - Deactivate campaign
    registerAdminRoute(app, '/campaigns/:id/deactivate', 'put', async (req, res) => {
        try {
            const dbConn = await getDb();
            const tenantId = await getTenantId(req);
            if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
            const result = await dbConn.run('UPDATE campaigns SET is_active = 0 WHERE id = ? AND tenant_id = ?', req.params.id, tenantId);
            if (result.changes === 0) return res.status(404).json({ error: 'Campagna non trovata' });
            res.json({ ok: true });
        } catch (e) {
            logger.error({ err: e }, 'Error deactivating campaign');
            res.status(500).json({ error: 'Errore server' });
        }
    });

    // DELETE /api/admin/campaigns/:id and /t/:tenantSlug/api/admin/campaigns/:id - Delete campaign
    registerAdminRoute(app, '/campaigns/:id', 'delete', async (req, res) => {
        try {
            const dbConn = await getDb();
            const tenantId = await getTenantId(req);
            if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
            const result = await dbConn.run('DELETE FROM campaigns WHERE id = ? AND tenant_id = ?', req.params.id, tenantId);
            if (result.changes === 0) return res.status(404).json({ error: 'Campagna non trovata' });
            res.json({ ok: true });
        } catch (e) {
            logger.error({ err: e }, 'Error deleting campaign');
            res.status(500).json({ error: 'Errore server' });
        }
    });

    // GET /api/admin/campaigns/:id/form-config and /t/:tenantSlug/api/admin/campaigns/:id/form-config - Get form config
    registerAdminRoute(app, '/campaigns/:id/form-config', 'get', async (req, res) => {
        try {
            const dbConn = await getDb();
            const tenantId = await getTenantId(req);
            if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
            const campaign = await dbConn.get('SELECT form_config FROM campaigns WHERE id = ? AND tenant_id = ?', req.params.id, tenantId);
            if (!campaign) {
                return res.status(404).json({ error: 'Campagna non trovata' });
            }
            const formConfig = JSON.parse(campaign.form_config || '{"email": {"visible": true, "required": true}, "firstName": {"visible": true, "required": true}, "lastName": {"visible": true, "required": true}}');
            res.json(formConfig);
        } catch (e) {
            logger.error({ err: e }, 'Error fetching form config');
            res.status(500).json({ error: 'Errore server' });
        }
    });

    // PUT /api/admin/campaigns/:id/form-config and /t/:tenantSlug/api/admin/campaigns/:id/form-config - Update form config
    registerAdminRoute(app, '/campaigns/:id/form-config', 'put', async (req, res) => {
        try {
            const dbConn = await getDb();
            const tenantId = await getTenantId(req);
            if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
            
            const { formConfig } = req.body;
            if (!formConfig || typeof formConfig !== 'object') {
                return res.status(400).json({ error: 'Configurazione form non valida' });
            }
            
            const result = await dbConn.run('UPDATE campaigns SET form_config = ? WHERE id = ? AND tenant_id = ?', JSON.stringify(formConfig), req.params.id, tenantId);
            if (result.changes === 0) return res.status(404).json({ error: 'Campagna non trovata' });
            res.json({ ok: true });
        } catch (e) {
            logger.error({ err: e }, 'Error updating form config');
            res.status(500).json({ error: 'Errore server' });
        }
    });

    // GET /api/admin/campaigns-list and /t/:tenantSlug/api/admin/campaigns-list - Get campaigns list
    registerAdminRoute(app, '/campaigns-list', 'get', async (req, res) => {
        try {
            const dbConn = await getDb();
            const tenantId = await getTenantId(req);
            if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
            const campaigns = await dbConn.all(`
                SELECT id, name, campaign_code
                FROM campaigns 
                WHERE name IS NOT NULL AND name != '' AND tenant_id = ?
                ORDER BY name, created_at DESC
            `, tenantId);
            res.json(campaigns.map(c => ({ id: c.id, name: c.name, code: c.campaign_code })));
        } catch (e) {
            logger.error({ err: e }, 'Error fetching campaigns list');
            res.status(500).json({ error: 'Errore server' });
        }
    });

    // GET /api/admin/campaigns/:id/custom-fields and /t/:tenantSlug/api/admin/campaigns/:id/custom-fields - Get custom fields
    registerAdminRoute(app, '/campaigns/:id/custom-fields', 'get', async (req, res) => {
        try {
            const dbConn = await getDb();
            const tenantId = await getTenantId(req);
            if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
            const campaign = await dbConn.get('SELECT form_config FROM campaigns WHERE id = ? AND tenant_id = ?', req.params.id, tenantId);
            if (!campaign) {
                return res.status(404).json({ error: 'Campagna non trovata' });
            }
            
            const formConfig = JSON.parse(campaign.form_config || '{"customFields": []}');
            res.json(formConfig.customFields || []);
        } catch (error) {
            logger.error({ err: error }, 'Error fetching custom fields');
            res.status(500).json({ error: 'Errore nel recupero dei campi custom' });
        }
    });

    // PUT /api/admin/campaigns/:id/custom-fields and /t/:tenantSlug/api/admin/campaigns/:id/custom-fields - Update custom fields
    registerAdminRoute(app, '/campaigns/:id/custom-fields', 'put', async (req, res) => {
        try {
            const { customFields } = req.body;
            const dbConn = await getDb();
            const tenantId = await getTenantId(req);
            if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
            
            if (customFields && customFields.length > 5) {
                return res.status(400).json({ error: 'Limite massimo di 5 campi custom per campagna' });
            }
            
            const campaign = await dbConn.get('SELECT form_config FROM campaigns WHERE id = ? AND tenant_id = ?', req.params.id, tenantId);
            if (!campaign) {
                return res.status(404).json({ error: 'Campagna non trovata' });
            }
            
            const formConfig = JSON.parse(campaign.form_config || '{"customFields": []}');
            formConfig.customFields = customFields || [];
            
            const result = await dbConn.run('UPDATE campaigns SET form_config = ? WHERE id = ? AND tenant_id = ?', JSON.stringify(formConfig), req.params.id, tenantId);
            if (result.changes === 0) return res.status(404).json({ error: 'Campagna non trovata' });
            
            res.json({ success: true });
        } catch (error) {
            logger.error({ err: error }, 'Error updating custom fields');
            res.status(500).json({ error: 'Errore nell\'aggiornamento dei campi custom' });
        }
    });

    // POST /t/:tenantSlug/api/admin/campaigns/:id/form-links - Generate form links (tenant-scoped only)
    app.post('/t/:tenantSlug/api/admin/campaigns/:id/form-links', tenantLoader, requireSameTenantAsSession, requireRole('admin'), async (req, res) => {
        try {
            const { count } = req.body || {};
            const campaignId = parseInt(req.params.id);
            
            if (!count || !Number.isInteger(count) || count < 1 || count > 1000) {
                return res.status(400).json({ error: 'Count deve essere un numero tra 1 e 1000' });
            }
            
            const dbConn = await getDb();
            
            const campaign = await dbConn.get('SELECT id, tenant_id FROM campaigns WHERE id = ? AND tenant_id = ?', campaignId, req.tenant.id);
            if (!campaign) {
                return res.status(404).json({ error: 'Campagna non trovata' });
            }
            
            const tokens = [];
            const links = [];
            
            for (let i = 0; i < count; i++) {
                let token;
                let attempts = 0;
                do {
                    token = generateId(16);
                    const existing = await dbConn.get('SELECT id FROM form_links WHERE token = ?', token);
                    if (!existing) break;
                    attempts++;
                    if (attempts > 10) {
                        throw new Error('Impossibile generare token univoco dopo 10 tentativi');
                    }
                } while (true);
                
                tokens.push(token);
                
                const result = await dbConn.run(
                    'INSERT INTO form_links (campaign_id, token, tenant_id) VALUES (?, ?, ?)',
                    campaignId, token, req.tenant.id
                );
                
                links.push({
                    id: result.lastID,
                    token: token,
                    used_at: null,
                    coupon_id: null,
                    created_at: new Date().toISOString()
                });
            }
            
            res.json({ links, count: links.length });
        } catch (e) {
            const logContext = logger.withRequest(req);
            logContext.error({ err: e, campaignId: req.params.id }, 'Error generating form links');
            res.status(500).json({ error: 'Errore server' });
        }
    });

    // GET /t/:tenantSlug/api/admin/campaigns/:id/form-links - List form links (tenant-scoped only)
    app.get('/t/:tenantSlug/api/admin/campaigns/:id/form-links', tenantLoader, requireSameTenantAsSession, requireRole('admin'), async (req, res) => {
        try {
            const campaignId = parseInt(req.params.id);
            const dbConn = await getDb();
            
            const campaign = await dbConn.get('SELECT id, tenant_id FROM campaigns WHERE id = ? AND tenant_id = ?', campaignId, req.tenant.id);
            if (!campaign) {
                return res.status(404).json({ error: 'Campagna non trovata' });
            }
            
            const formLinks = await dbConn.all(
                'SELECT id, token, used_at, coupon_id, created_at FROM form_links WHERE campaign_id = ? AND tenant_id = ? ORDER BY created_at DESC',
                campaignId, req.tenant.id
            );
            
            const total = formLinks.length;
            const used = formLinks.filter(link => link.used_at !== null).length;
            const available = total - used;
            
            res.json({
                links: formLinks,
                statistics: {
                    total,
                    used,
                    available
                }
            });
        } catch (e) {
            const logContext = logger.withRequest(req);
            logContext.error({ err: e, campaignId: req.params.id }, 'Error listing form links');
            res.status(500).json({ error: 'Errore server' });
        }
    });

    // GET /api/admin/campaigns/:id/products and /t/:tenantSlug/api/admin/campaigns/:id/products - Get campaign products
    registerAdminRoute(app, '/campaigns/:id/products', 'get', async (req, res) => {
        try {
            const dbConn = await getDb();
            const tenantId = await getTenantId(req);
            if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
            const products = await dbConn.all(`
                SELECT p.*, cp.created_at as assigned_at
                FROM products p
                INNER JOIN campaign_products cp ON p.id = cp.product_id
                INNER JOIN campaigns c ON c.id = cp.campaign_id
                WHERE cp.campaign_id = ? AND c.tenant_id = ? AND p.tenant_id = ?
                ORDER BY p.name
            `, req.params.id, tenantId, tenantId);
            res.json(products);
        } catch (error) {
            logger.error({ err: error }, 'Error fetching campaign products');
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // POST /api/admin/campaigns/:id/products and /t/:tenantSlug/api/admin/campaigns/:id/products - Update campaign products
    registerAdminRoute(app, '/campaigns/:id/products', 'post', async (req, res) => {
        try {
            const { product_ids } = req.body;
            const dbConn = await getDb();
            const tenantId = await getTenantId(req);
            if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });

            const campaign = await dbConn.get('SELECT id FROM campaigns WHERE id = ? AND tenant_id = ?', req.params.id, tenantId);
            if (!campaign) return res.status(404).json({ error: 'Campagna non trovata' });

            await dbConn.run('DELETE FROM campaign_products WHERE campaign_id = ?', req.params.id);
            
            if (product_ids && product_ids.length > 0) {
                for (const product_id of product_ids) {
                    const prod = await dbConn.get('SELECT id FROM products WHERE id = ? AND tenant_id = ?', product_id, tenantId);
                    if (prod) {
                        await dbConn.run(
                            'INSERT OR IGNORE INTO campaign_products (campaign_id, product_id) VALUES (?, ?)',
                            [req.params.id, product_id]
                        );
                    }
                }
            }
            
            res.json({ success: true });
        } catch (error) {
            logger.error({ err: error }, 'Error updating campaign products');
            res.status(500).json({ error: 'Internal server error' });
        }
    });
}

module.exports = { setupCampaignsRoutes };

