'use strict';

const { sanitizeObject } = require('./sanitize');
const logger = require('./logger');

const { requireAdmin, requireRole } = require('../middleware/auth');
const { tenantLoader, requireSameTenantAsSession, getTenantIdForApi } = require('../middleware/tenant');

/**
 * Helper function to register both legacy and tenant-scoped admin routes.
 * 
 * This function eliminates code duplication by automatically registering two route variants:
 * 1. Legacy route: `/api/admin{path}` - Uses session/referer for tenant resolution
 * 2. Tenant-scoped route: `/t/:tenantSlug/api/admin{path}` - Uses URL path for tenant resolution
 * 
 * Both routes maintain tenant isolation security through appropriate middleware.
 * 
 * @param {Express.App} app - Express application instance
 * @param {string} path - Route path without prefix (e.g., '/campaigns' or '/campaigns/:id')
 * @param {string} method - HTTP method ('get', 'post', 'put', 'delete')
 * @param {Function} handler - Route handler function that receives (req, res)
 * 
 * @description
 * The handler function should use `getTenantId(req)` helper to get tenant ID, which works
 * for both route types. Alternatively:
 * - For tenant-scoped routes: `req.tenant?.id` (already set by tenantLoader)
 * - For legacy routes: `await getTenantIdForApi(req)` (from session/referer)
 * 
 * Both approaches return the same tenant ID, ensuring tenant isolation.
 * 
 * @example
 * // Register GET /api/admin/campaigns and GET /t/:tenantSlug/api/admin/campaigns
 * registerAdminRoute(app, '/campaigns', 'get', async (req, res) => {
 *     const tenantId = await getTenantId(req);
 *     if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
 *     // ... handler logic
 * });
 * 
 * @example
 * // Register DELETE /api/admin/campaigns/:id and DELETE /t/:tenantSlug/api/admin/campaigns/:id
 * registerAdminRoute(app, '/campaigns/:id', 'delete', async (req, res) => {
 *     const tenantId = await getTenantId(req);
 *     const campaignId = req.params.id;
 *     // ... delete logic
 * });
 * 
 * @throws {Error} If path doesn't start with '/', it will be normalized automatically
 * 
 * @see {@link getTenantId} For getting tenant ID in route handlers
 * @see {@link LLM_MD/TYPES.md} For ExpressRequest type definition
 * @since 1.0.0
 */
function registerAdminRoute(app, path, method, handler) {
    // Ensure path starts with /
    const normalizedPath = path.startsWith('/') ? path : '/' + path;
    
    // Legacy route: /api/admin{path}
    // Uses requireAdmin middleware and getTenantIdForApi(req) for tenant resolution
    const legacyPath = `/api/admin${normalizedPath}`;
    try {
        app[method](legacyPath, requireAdmin, handler);
        logger.debug({ method, legacyPath }, 'Registered legacy admin route');
    } catch (e) {
        logger.error({ err: e, method, legacyPath }, 'Error registering legacy admin route');
        throw e;
    }
    
    // Tenant-scoped route: /t/:tenantSlug/api/admin{path}
    // Uses tenantLoader, requireSameTenantAsSession, requireRole('admin')
    // Tenant is already loaded in req.tenant by tenantLoader
    const tenantScopedPath = `/t/:tenantSlug/api/admin${normalizedPath}`;
    try {
        app[method](tenantScopedPath, tenantLoader, requireSameTenantAsSession, requireRole('admin'), handler);
        logger.info({ method, tenantScopedPath, normalizedPath }, 'Registered tenant-scoped admin route');
    } catch (e) {
        logger.error({ err: e, method, tenantScopedPath }, 'Error registering tenant-scoped admin route');
        throw e;
    }
}

/**
 * Helper to get tenant ID from request (works for both legacy and tenant-scoped routes).
 * 
 * This function provides a unified way to get tenant ID regardless of route type:
 * - For tenant-scoped routes (`/t/:tenantSlug/api/admin/*`): Returns `req.tenant.id` (already loaded by tenantLoader)
 * - For legacy routes (`/api/admin/*`): Resolves tenant from session or referer header
 * 
 * @param {ExpressRequest} req - Express request object (may have req.tenant set by tenantLoader)
 * @returns {Promise<number|null>} Tenant ID or null if not found/invalid
 * 
 * @example
 * // In a route handler
 * const tenantId = await getTenantId(req);
 * if (!tenantId) {
 *     return res.status(400).json({ error: 'Tenant non valido' });
 * }
 * 
 * @description
 * Resolution order:
 * 1. If `req.tenant?.id` exists (tenant-scoped route), return it
 * 2. Otherwise, try to resolve from session (`req.session.user.tenantId`)
 * 3. Otherwise, try to resolve from referer header (`/t/:tenantSlug/...`)
 * 4. Return null if none found
 * 
 * @see {@link LLM_MD/TYPES.md} For ExpressRequest and Tenant type definitions
 * @since 1.0.0
 */
async function getTenantId(req) {
    // For tenant-scoped routes, tenant is already loaded by tenantLoader
    if (req.tenant?.id) {
        return req.tenant.id;
    }
    // For legacy routes, resolve from session/referer
    return await getTenantIdForApi(req);
}

/**
 * Helper to send sanitized JSON response
 * 
 * Sanitizes data before sending as JSON to prevent XSS attacks.
 * Escapes HTML entities in all string values.
 * 
 * @param {Express.Response} res - Express response object
 * @param {*} data - Data to send (object, array, or primitive)
 * @param {Array<string>} excludeKeys - Keys to exclude from sanitization (optional)
 * @returns {void}
 * 
 * @example
 * // In route handler
 * const campaigns = await db.all('SELECT * FROM campaigns WHERE tenant_id = ?', tenantId);
 * sendSanitizedJson(res, campaigns);
 */
function sendSanitizedJson(res, data, excludeKeys = []) {
    // Sanitize data before sending
    const sanitized = sanitizeObject(data, excludeKeys);
    res.json(sanitized);
}

module.exports = {
    registerAdminRoute,
    getTenantId,
    sendSanitizedJson
};


