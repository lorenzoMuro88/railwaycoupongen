'use strict';

const { getDb } = require('../../utils/db');
const { requireAdmin } = require('../../middleware/auth');
const { getTenantIdForApi } = require('../../middleware/tenant');
const logger = require('../../utils/logger');

/**
 * Setup users routes
 */
function setupUsersRoutes(app) {
    // GET /api/admin/users - List users with search and filters
    app.get('/api/admin/users', requireAdmin, async (req, res) => {
        try {
            const { search, campaigns } = req.query;
            const dbConn = await getDb();
            const tenantId = await getTenantIdForApi(req);
            if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
            
            let query = `
                SELECT 
                    u.id,
                    u.email,
                    u.first_name,
                    u.last_name,
                    GROUP_CONCAT(DISTINCT c.name) as campaigns,
                    COUNT(DISTINCT co.id) as total_coupons,
                    MIN(u.created_at) as first_coupon_date,
                    MAX(u.created_at) as last_coupon_date
                FROM users u
                LEFT JOIN coupons co ON u.id = co.user_id AND co.tenant_id = u.tenant_id
                LEFT JOIN campaigns c ON co.campaign_id = c.id AND c.tenant_id = u.tenant_id
            `;
            
            const params = [tenantId];
            const conditions = ['u.tenant_id = ?'];
            
            if (search && search.trim()) {
                conditions.push(`u.last_name LIKE ?`);
                params.push(`%${search.trim()}%`);
            }
            
            if (campaigns && campaigns.trim()) {
                const campaignList = campaigns.split(',').map(c => c.trim()).filter(c => c);
                if (campaignList.length > 0) {
                    const placeholders = campaignList.map(() => '?').join(',');
                    conditions.push(`c.name IN (${placeholders})`);
                    params.push(...campaignList);
                }
            }
            
            if (conditions.length > 0) {
                query += ` WHERE ${conditions.join(' AND ')}`;
            }
            
            query += `
                GROUP BY u.id
                ORDER BY last_coupon_date DESC
            `;
            
            const users = await dbConn.all(query, params);
            
            // Fetch all custom fields in a single query (fixes N+1 problem)
            if (users.length > 0) {
                const userIds = users.map(u => u.id);
                const placeholders = userIds.map(() => '?').join(',');
                const allCustomFields = await dbConn.all(
                    `SELECT user_id, field_name, field_value 
                     FROM user_custom_data 
                     WHERE user_id IN (${placeholders}) AND tenant_id = ?`,
                    ...userIds, tenantId
                );
                
                // Map custom fields by user_id
                const customFieldsByUserId = {};
                for (const field of allCustomFields) {
                    if (!customFieldsByUserId[field.user_id]) {
                        customFieldsByUserId[field.user_id] = {};
                    }
                    customFieldsByUserId[field.user_id][field.field_name] = field.field_value;
                }
                
                // Attach custom fields to users
                for (const user of users) {
                    user.customFields = customFieldsByUserId[user.id] || {};
                }
            }
            
            res.json(users);
        } catch (e) {
            logger.error({ err: e }, 'Error fetching users');
            res.status(500).json({ error: 'Errore server' });
        }
    });

    // GET /api/admin/users/export.csv - Export users as CSV
    app.get('/api/admin/users/export.csv', requireAdmin, async (req, res) => {
        try {
            const dbConn = await getDb();
            const tenantId = await getTenantIdForApi(req);
            if (!tenantId) return res.status(400).send('Tenant non valido');

            let query = `
                SELECT 
                    u.id,
                    u.email,
                    u.first_name,
                    u.last_name,
                    GROUP_CONCAT(DISTINCT c.name) as campaigns,
                    COUNT(DISTINCT co.id) as total_coupons,
                    MIN(u.created_at) as first_coupon_date,
                    MAX(u.created_at) as last_coupon_date
                FROM users u
                LEFT JOIN coupons co ON u.id = co.user_id AND co.tenant_id = u.tenant_id
                LEFT JOIN campaigns c ON co.campaign_id = c.id AND c.tenant_id = u.tenant_id
                WHERE u.tenant_id = ?
                GROUP BY u.id
                ORDER BY last_coupon_date DESC
            `;

            const users = await dbConn.all(query, tenantId);

            // Fetch all custom fields in a single query (fixes N+1 problem)
            const allCustomFieldNames = new Set();
            if (users.length > 0) {
                const userIds = users.map(u => u.id);
                const placeholders = userIds.map(() => '?').join(',');
                const allCustomFields = await dbConn.all(
                    `SELECT user_id, field_name, field_value 
                     FROM user_custom_data 
                     WHERE user_id IN (${placeholders}) AND tenant_id = ?`,
                    ...userIds, tenantId
                );
                
                // Map custom fields by user_id and collect field names
                const customFieldsByUserId = {};
                for (const field of allCustomFields) {
                    if (!customFieldsByUserId[field.user_id]) {
                        customFieldsByUserId[field.user_id] = {};
                    }
                    customFieldsByUserId[field.user_id][field.field_name] = field.field_value;
                    allCustomFieldNames.add(field.field_name);
                }
                
                // Attach custom fields to users
                for (const user of users) {
                    user.customFields = customFieldsByUserId[user.id] || {};
                }
            }

            // Prepare CSV
            const customFieldColumns = Array.from(allCustomFieldNames).sort();
            const headers = [
                'email',
                'first_name',
                'last_name',
                'campaigns',
                'total_coupons',
                'first_coupon_date',
                'last_coupon_date',
                ...customFieldColumns
            ];

            const escapeCsv = (value) => {
                if (value === null || value === undefined) return '';
                const str = String(value);
                if (/[",\n]/.test(str)) {
                    return '"' + str.replace(/"/g, '""') + '"';
                }
                return str;
            };

            const rows = [];
            rows.push(headers.join(','));
            for (const u of users) {
                const baseCols = [
                    u.email || '',
                    u.first_name || '',
                    u.last_name || '',
                    (u.campaigns || ''),
                    u.total_coupons || 0,
                    u.first_coupon_date || '',
                    u.last_coupon_date || ''
                ];
                const customCols = customFieldColumns.map(name => (u.customFields && u.customFields[name]) ? u.customFields[name] : '');
                const line = [...baseCols, ...customCols].map(escapeCsv).join(',');
                rows.push(line);
            }

            const csvContent = '\uFEFF' + rows.join('\n'); // BOM for Excel
            const timestamp = new Date().toISOString().replace(/[:T]/g, '-').split('.')[0];
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="utenti-${timestamp}.csv"`);
            return res.send(csvContent);
        } catch (e) {
            logger.error({ err: e }, 'Error exporting users CSV');
            res.status(500).send('Errore server');
        }
    });

    // GET /api/admin/users/:id - Get single user by ID
    app.get('/api/admin/users/:id', requireAdmin, async (req, res) => {
        try {
            const dbConn = await getDb();
            const tenantId = await getTenantIdForApi(req);
            if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
            const user = await dbConn.get('SELECT * FROM users WHERE id = ? AND tenant_id = ?', req.params.id, tenantId);
            if (!user) {
                return res.status(404).json({ error: 'Utente non trovato' });
            }
            
            // Fetch custom fields
            const customFields = await dbConn.all(
                'SELECT field_name, field_value FROM user_custom_data WHERE user_id = ? AND tenant_id = ?',
                user.id, tenantId
            );
            user.customFields = customFields.reduce((acc, field) => {
                acc[field.field_name] = field.field_value;
                return acc;
            }, {});
            
            res.json(user);
        } catch (e) {
            logger.error({ err: e }, 'Error fetching user');
            res.status(500).json({ error: 'Errore server' });
        }
    });

    // PUT /api/admin/users/:id - Update user
    app.put('/api/admin/users/:id', requireAdmin, async (req, res) => {
        try {
            const { email, first_name, last_name, customFields } = req.body;
            const dbConn = await getDb();
            const tenantId = await getTenantIdForApi(req);
            if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
            
            // Check if user exists
            const existingUser = await dbConn.get('SELECT * FROM users WHERE id = ? AND tenant_id = ?', req.params.id, tenantId);
            if (!existingUser) {
                return res.status(404).json({ error: 'Utente non trovato' });
            }
            
            // Check if email is already taken by another user
            if (email && email !== existingUser.email) {
                const emailExists = await dbConn.get('SELECT id FROM users WHERE email = ? AND id != ? AND tenant_id = ?', email, req.params.id, tenantId);
                if (emailExists) {
                    return res.status(400).json({ error: 'Email già utilizzata da un altro utente' });
                }
            }
            
            // Update user basic info
            await dbConn.run(
                'UPDATE users SET email = ?, first_name = ?, last_name = ? WHERE id = ? AND tenant_id = ?',
                email, first_name, last_name, req.params.id, tenantId
            );
            
            // Update custom fields
            if (customFields && typeof customFields === 'object') {
                // Delete existing custom fields
                await dbConn.run('DELETE FROM user_custom_data WHERE user_id = ? AND tenant_id = ?', req.params.id, tenantId);
                
                // Insert new custom fields
                for (const [fieldName, fieldValue] of Object.entries(customFields)) {
                    if (fieldValue !== undefined && fieldValue !== '') {
                        await dbConn.run(
                            'INSERT INTO user_custom_data (user_id, field_name, field_value, tenant_id) VALUES (?, ?, ?, ?)',
                            req.params.id, fieldName, fieldValue, tenantId
                        );
                    }
                }
            }
            
            res.json({ success: true, message: 'Utente aggiornato con successo' });
        } catch (e) {
            logger.error({ err: e }, 'Error updating user');
            res.status(500).json({ error: 'Errore server' });
        }
    });

    // DELETE /api/admin/users/:id - Delete user
    app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
        try {
            const dbConn = await getDb();
            const tenantId = await getTenantIdForApi(req);
            if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
            
            // Check if user exists
            const user = await dbConn.get('SELECT * FROM users WHERE id = ? AND tenant_id = ?', req.params.id, tenantId);
            if (!user) {
                return res.status(404).json({ error: 'Utente non trovato' });
            }
            
            // Check if user has active coupons
            const activeCouponCount = await dbConn.get('SELECT COUNT(*) as count FROM coupons WHERE user_id = ? AND status = "active" AND tenant_id = ?', req.params.id, tenantId);
            if (activeCouponCount.count > 0) {
                return res.status(400).json({ 
                    error: 'Impossibile eliminare l\'utente: ha dei coupon attivi. Elimina prima i coupon attivi o cambia il loro stato.' 
                });
            }
            
            // Delete user (custom fields will be deleted automatically due to CASCADE)
            await dbConn.run('DELETE FROM users WHERE id = ? AND tenant_id = ?', req.params.id, tenantId);
            
            res.json({ success: true, message: 'Utente eliminato con successo' });
        } catch (e) {
            logger.error({ err: e }, 'Error deleting user');
            res.status(500).json({ error: 'Errore server' });
        }
    });

    // GET /api/admin/users/:id/coupons - Get user coupons
    app.get('/api/admin/users/:id/coupons', requireAdmin, async (req, res) => {
        try {
            const dbConn = await getDb();
            const tenantId = await getTenantIdForApi(req);
            if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
            
            // Check if user exists
            const user = await dbConn.get('SELECT * FROM users WHERE id = ? AND tenant_id = ?', req.params.id, tenantId);
            if (!user) {
                return res.status(404).json({ error: 'Utente non trovato' });
            }
            
            // Get user coupons with campaign info
            const coupons = await dbConn.all(`
                SELECT 
                    c.id,
                    c.code,
                    c.status,
                    c.discount_type,
                    c.discount_value,
                    c.issued_at,
                    c.redeemed_at,
                    camp.name as campaign_name
                FROM coupons c
                LEFT JOIN campaigns camp ON camp.id = c.campaign_id
                WHERE c.user_id = ? AND c.tenant_id = ?
                ORDER BY c.issued_at DESC
            `, req.params.id, tenantId);
            
            res.json(coupons);
        } catch (e) {
            const logContext = logger.withRequest(req);
            logContext.error({ err: e }, 'Error fetching user coupons');
            res.status(500).json({ error: 'Errore server' });
        }
    });
}

module.exports = { setupUsersRoutes };

