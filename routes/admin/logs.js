'use strict';

const { getDb } = require('../../utils/db');
const { registerAdminRoute, getTenantId, sendSanitizedJson } = require('../../utils/routeHelper');
const logger = require('../../utils/logger');

/**
 * Setup logs routes (audit log querying).
 * 
 * Registers routes for querying system audit logs.
 * 
 * Routes registered:
 * - GET /api/admin/logs - List audit logs with filters and pagination
 * 
 * @param {Express.App} app - Express application instance
 * @returns {void}
 */
function setupLogsRoutes(app) {
    /**
     * GET /api/admin/logs and /t/:tenantSlug/api/admin/logs - List audit logs
     * 
     * Returns paginated list of audit logs with optional filters.
     * Only returns logs for the tenant (or all logs for superadmin).
     * 
     * @route GET /api/admin/logs
     * @route GET /t/:tenantSlug/api/admin/logs
     * @middleware requireAdmin (legacy) | tenantLoader, requireSameTenantAsSession, requireRole('admin') (tenant-scoped)
     * 
     * @param {ExpressRequest} req - Express request object
     * @param {ExpressRequest.query} req.query - Query parameters
     * @param {string} [req.query.actionType] - Filter by action type (e.g., 'create', 'update', 'delete')
     * @param {string} [req.query.level] - Filter by log level ('info', 'success', 'warning', 'error')
     * @param {string} [req.query.limit='50'] - Number of results per page (1-500, default: 50)
     * @param {string} [req.query.offset='0'] - Number of results to skip (default: 0)
     * @param {string} [req.query.order='desc'] - Sort order (asc, desc, default: desc)
     * @param {Express.Response} res - Express response object
     * 
     * @returns {Object} Paginated response
     * @returns {number} returns.total - Total number of logs matching filters
     * @returns {Array<Object>} returns.items - Array of log objects
     * @returns {number} returns.items[].id - Log ID
     * @returns {string} returns.items[].timestamp - Timestamp (ISO datetime string)
     * @returns {string} returns.items[].actionType - Action type
     * @returns {string} returns.items[].actionDescription - Action description
     * @returns {string} returns.items[].level - Log level
     * @returns {string} returns.items[].username - Username who performed action
     * @returns {string} returns.items[].userType - User type (admin, store, superadmin)
     * @returns {Object} [returns.items[].details] - Additional details (parsed JSON)
     * 
     * @throws {400} Bad Request - If tenant ID is invalid (for regular admin)
     * @throws {500} Internal Server Error - If database query fails
     * 
     * @example
     * // Request: GET /api/admin/logs?actionType=delete&level=warning&limit=20
     * // Response
     * {
     *   total: 15,
     *   items: [
     *     {
     *       id: 1,
     *       timestamp: "2024-01-15T10:00:00.000Z",
     *       actionType: "delete",
     *       actionDescription: "Campaign deleted: Summer Sale",
     *       level: "warning",
     *       username: "admin",
     *       userType: "admin",
     *       details: { resourceType: "campaign", resourceId: 123 }
     *     }
     *   ]
     * }
     */
    registerAdminRoute(app, '/logs', 'get', async (req, res) => {
        try {
            const { actionType, level, limit = '50', offset = '0', order = 'desc' } = req.query;
            const orderDir = String(order).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
            const parsedLimit = Math.min(Math.max(parseInt(String(limit), 10) || 50, 1), 500);
            const parsedOffset = Math.max(parseInt(String(offset), 10) || 0, 0);

            const dbConn = await getDb();
            const sess = req.session && req.session.user;
            
            // Build WHERE clause
            const params = [];
            const conditions = [];
            
            // Superadmin can see all logs, regular admin only tenant-scoped
            if (sess && sess.userType === 'superadmin') {
                // Superadmin: no tenant filter
            } else {
                const tenantId = await getTenantId(req);
                if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
                conditions.push('tenant_id = ?');
                params.push(tenantId);
            }
            
            // Filter by action type
            if (actionType) {
                conditions.push('action_type = ?');
                params.push(String(actionType));
            }
            
            // Filter by level
            if (level) {
                conditions.push('level = ?');
                params.push(String(level));
            }
            
            const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
            
            // Get logs
            const rows = await dbConn.all(
                `SELECT id, timestamp, action_type AS actionType, action_description AS actionDescription,
                        level, username, user_type AS userType, details, ip_address AS ipAddress
                 FROM system_logs
                 ${whereClause}
                 ORDER BY timestamp ${orderDir}
                 LIMIT ? OFFSET ?`,
                ...params, parsedLimit, parsedOffset
            );
            
            // Parse details JSON
            const items = rows.map(row => ({
                ...row,
                details: row.details ? JSON.parse(row.details) : null
            }));
            
            // Get total count
            const totalRow = await dbConn.get(
                `SELECT COUNT(*) AS total FROM system_logs ${whereClause}`,
                ...params
            );
            
            // Sanitize output to prevent XSS
            sendSanitizedJson(res, { total: totalRow.total, items });
        } catch (e) {
            logger.error({ err: e }, 'Error fetching logs');
            res.status(500).json({ error: 'Errore server' });
        }
    });
}

module.exports = { setupLogsRoutes };


