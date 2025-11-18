'use strict';

const { getDb } = require('../../utils/db');
const { requireAdmin } = require('../../middleware/auth');
const { getTenantIdForApi } = require('../../middleware/tenant');
const { sendSanitizedJson } = require('../../utils/routeHelper');
const logger = require('../../utils/logger');

/**
 * Setup coupons routes.
 * 
 * Registers all coupon-related admin routes.
 * 
 * Routes registered:
 * - GET /api/admin/coupons/search - Search coupons by code or user last name
 * - GET /api/admin/coupons - List coupons with filters and pagination
 * - DELETE /api/admin/coupons/:id - Delete coupon
 * 
 * @param {Express.App} app - Express application instance
 * @returns {void}
 */
function setupCouponsRoutes(app) {
    /**
     * GET /api/admin/coupons/search - Search coupons
     * 
     * Searches coupons by coupon code or user last name (case-insensitive).
     * Returns up to 100 matching coupons ordered by issue date (newest first).
     * 
     * @route GET /api/admin/coupons/search
     * @middleware requireAdmin
     * 
     * @param {ExpressRequest} req - Express request object
     * @param {ExpressRequest.query} req.query - Query parameters
     * @param {string} req.query.q - Search term (minimum 2 characters, required)
     * @param {Express.Response} res - Express response object
     * 
     * @returns {Array<Object>} Array of coupon objects with user and campaign info
     * @returns {number} returns[].id - Coupon ID
     * @returns {string} returns[].code - Coupon code
     * @returns {string} returns[].discountType - Discount type (percent, fixed, text)
     * @returns {string} returns[].discountValue - Discount value
     * @returns {string} returns[].status - Coupon status (active, redeemed, expired)
     * @returns {string} returns[].issuedAt - Issue date (ISO datetime string)
     * @returns {string} [returns[].redeemedAt] - Redemption date (ISO datetime string, if redeemed)
     * @returns {string} returns[].firstName - User first name
     * @returns {string} returns[].lastName - User last name
     * @returns {string} returns[].email - User email
     * @returns {string} [returns[].campaignName] - Campaign name (if associated)
     * 
     * @throws {400} Bad Request - If tenant ID is invalid
     * @throws {500} Internal Server Error - If database query fails
     * 
     * @example
     * // Request: GET /api/admin/coupons/search?q=ABC123
     * // Response
     * [
     *   {
     *     id: 1,
     *     code: "ABC123XYZ456",
     *     discountType: "percent",
     *     discountValue: "20",
     *     status: "active",
     *     issuedAt: "2024-01-01T00:00:00.000Z",
     *     firstName: "Mario",
     *     lastName: "Rossi",
     *     email: "mario@example.com",
     *     campaignName: "Sconto 20%"
     *   }
     * ]
     */
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
            
            // Sanitize output to prevent XSS
            sendSanitizedJson(res, coupons);
        } catch (e) {
            const logContext = logger.withRequest(req);
            logContext.error({ err: e }, 'Error searching coupons');
            res.status(500).json({ error: 'Errore server' });
        }
    });

    /**
     * GET /api/admin/coupons - List coupons with filters
     * 
     * Returns paginated list of coupons with optional status filter.
     * Includes user email and campaign name for each coupon.
     * 
     * @route GET /api/admin/coupons
     * @middleware requireAdmin
     * 
     * @param {ExpressRequest} req - Express request object
     * @param {ExpressRequest.query} req.query - Query parameters
     * @param {string} [req.query.status='active'] - Filter by status (active, redeemed, expired)
     * @param {string} [req.query.limit='50'] - Number of results per page (1-500, default: 50)
     * @param {string} [req.query.offset='0'] - Number of results to skip (default: 0)
     * @param {string} [req.query.order='desc'] - Sort order (asc, desc, default: desc)
     * @param {Express.Response} res - Express response object
     * 
     * @returns {Object} Paginated response
     * @returns {number} returns.total - Total number of coupons matching filters
     * @returns {Array<Object>} returns.items - Array of coupon objects
     * @returns {string} returns.items[].code - Coupon code
     * @returns {string} returns.items[].status - Coupon status
     * @returns {string} returns.items[].discountType - Discount type
     * @returns {string} returns.items[].discountValue - Discount value
     * @returns {string} returns.items[].issuedAt - Issue date (ISO datetime string)
     * @returns {string} [returns.items[].redeemedAt] - Redemption date (ISO datetime string)
     * @returns {string} returns.items[].userEmail - User email
     * @returns {string} [returns.items[].campaignName] - Campaign name
     * 
     * @throws {400} Bad Request - If tenant ID is invalid
     * @throws {500} Internal Server Error - If database query fails
     * 
     * @example
     * // Request: GET /api/admin/coupons?status=active&limit=10&offset=0
     * // Response
     * {
     *   total: 150,
     *   items: [
     *     {
     *       code: "ABC123XYZ456",
     *       status: "active",
     *       discountType: "percent",
     *       discountValue: "20",
     *       issuedAt: "2024-01-01T00:00:00.000Z",
     *       userEmail: "mario@example.com",
     *       campaignName: "Sconto 20%"
     *     }
     *   ]
     * }
     */
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
            // Sanitize output to prevent XSS
            sendSanitizedJson(res, { total: totalRow.total, items: rows });
        } catch (e) {
            logger.error({ err: e }, 'Error fetching coupons');
            res.status(500).json({ error: 'Errore server' });
        }
    });

    /**
     * DELETE /api/admin/coupons/:id - Delete coupon
     * 
     * Permanently deletes a coupon by ID. Only deletes coupons belonging to the tenant.
     * 
     * @route DELETE /api/admin/coupons/:id
     * @middleware requireAdmin
     * 
     * @param {ExpressRequest} req - Express request object
     * @param {ExpressRequest.params} req.params - URL parameters
     * @param {string} req.params.id - Coupon ID to delete
     * @param {Express.Response} res - Express response object
     * 
     * @returns {Object} Success response
     * @returns {boolean} returns.success - Always true
     * @returns {string} returns.message - Success message
     * 
     * @throws {400} Bad Request - If tenant ID is invalid
     * @throws {404} Not Found - If coupon doesn't exist or doesn't belong to tenant
     * @throws {500} Internal Server Error - If database operation fails
     * 
     * @example
     * // Request: DELETE /api/admin/coupons/123
     * // Response
     * {
     *   success: true,
     *   message: "Coupon eliminato con successo"
     * }
     */
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


