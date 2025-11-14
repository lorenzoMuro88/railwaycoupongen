'use strict';

const { getDb } = require('../../utils/db');
const { requireAdmin } = require('../../middleware/auth');
const { getTenantIdForApi } = require('../../middleware/tenant');
const logger = require('../../utils/logger');

/**
 * Setup coupons routes
 */
function setupCouponsRoutes(app) {
    // GET /api/admin/coupons/search - Search coupons
    app.get('/api/admin/coupons/search', requireAdmin, async (req, res) => {
        try {
            const { q } = req.query;
            if (!q || q.trim().length < 2) {
                return res.json([]);
            }
            
            const dbConn = await getDb();
            const tenantId = await getTenantIdForApi(req);
            if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
            const searchTerm = `%${q.trim().toUpperCase()}%`;
            
            const coupons = await dbConn.all(`
                SELECT c.id, c.code, c.discount_type AS discountType, c.discount_value AS discountValue, c.status, c.issued_at AS issuedAt, c.redeemed_at AS redeemedAt,
                       u.first_name AS firstName, u.last_name AS lastName, u.email, camp.name AS campaignName
                FROM coupons c
                JOIN users u ON u.id = c.user_id AND u.tenant_id = c.tenant_id
                LEFT JOIN campaigns camp ON camp.id = c.campaign_id AND camp.tenant_id = c.tenant_id
                WHERE (c.code LIKE ? OR UPPER(u.last_name) LIKE ?) AND c.tenant_id = ?
                ORDER BY c.issued_at DESC
                LIMIT 100
            `, searchTerm, searchTerm, tenantId);
            
            res.json(coupons);
        } catch (e) {
            const logContext = logger.withRequest(req);
            logContext.error({ err: e }, 'Error searching coupons');
            res.status(500).json({ error: 'Errore server' });
        }
    });

    // GET /api/admin/coupons - List coupons with filters
    app.get('/api/admin/coupons', requireAdmin, async (req, res) => {
        try {
            const { status = 'active', limit = '50', offset = '0', order = 'desc' } = req.query;
            const orderDir = String(order).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
            const parsedLimit = Math.min(Math.max(parseInt(String(limit), 10) || 50, 1), 500);
            const parsedOffset = Math.max(parseInt(String(offset), 10) || 0, 0);

            const dbConn = await getDb();
            const tenantId = await getTenantIdForApi(req);
            if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
            
            const params = [];
            let whereClause = 'WHERE c.tenant_id = ?';
            params.push(tenantId);
            if (status) {
                whereClause += ' AND c.status = ?';
                params.push(String(status));
            }

            const rows = await dbConn.all(
                `SELECT c.code, c.status, c.discount_type AS discountType, c.discount_value AS discountValue, 
                        c.issued_at AS issuedAt, c.redeemed_at AS redeemedAt,
                        u.email AS userEmail, camp.name AS campaignName
                 FROM coupons c
                 JOIN users u ON u.id = c.user_id AND u.tenant_id = c.tenant_id
                 LEFT JOIN campaigns camp ON camp.id = c.campaign_id AND camp.tenant_id = c.tenant_id
                 ${whereClause}
                 ORDER BY c.issued_at ${orderDir}
                 LIMIT ? OFFSET ?`,
                ...params, parsedLimit, parsedOffset
            );
            const totalRow = await dbConn.get(
                `SELECT COUNT(*) AS total FROM coupons c ${whereClause}`,
                ...params
            );
            res.json({ total: totalRow.total, items: rows });
        } catch (e) {
            logger.error({ err: e }, 'Error fetching coupons');
            res.status(500).json({ error: 'Errore server' });
        }
    });

    // DELETE /api/admin/coupons/:id - Delete coupon
    app.delete('/api/admin/coupons/:id', requireAdmin, async (req, res) => {
        try {
            const dbConn = await getDb();
            const tenantId = await getTenantIdForApi(req);
            if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
            
            // Check if coupon exists
            const coupon = await dbConn.get('SELECT * FROM coupons WHERE id = ? AND tenant_id = ?', req.params.id, tenantId);
            if (!coupon) {
                return res.status(404).json({ error: 'Coupon non trovato' });
            }
            
            // Delete coupon
            const result = await dbConn.run('DELETE FROM coupons WHERE id = ? AND tenant_id = ?', req.params.id, tenantId);
            if (result.changes === 0) return res.status(404).json({ error: 'Coupon non trovato' });
            
            res.json({ success: true, message: 'Coupon eliminato con successo' });
        } catch (e) {
            logger.error({ err: e }, 'Error deleting coupon');
            res.status(500).json({ error: 'Errore server' });
        }
    });
}

module.exports = { setupCouponsRoutes };


