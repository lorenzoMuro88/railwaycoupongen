'use strict';

const { getDb, ensureTenantEmailColumns, ensureFormCustomizationTenantId, ensureTenantScopedUniqueConstraints } = require('../utils/db');
const logger = require('../utils/logger');

const DEFAULT_TENANT_SLUG = process.env.DEFAULT_TENANT_SLUG || 'default';

/**
 * Middleware: Tenant loader - resolves :tenantSlug URL parameter to req.tenant object.
 * 
 * Loads tenant from database based on slug in URL path (`/t/:tenantSlug/...`).
 * Sets `req.tenant` and `req.tenantSlug` for use in route handlers.
 * 
 * @param {ExpressRequest} req - Express request object (must have req.params.tenantSlug)
 * @param {Express.Response} res - Express response object
 * @param {Function} next - Express next middleware function
 * 
 * @returns {Promise<void>} Calls next() if tenant found, otherwise sends 404 response
 * 
 * @example
 * // Use in tenant-scoped routes
 * app.get('/t/:tenantSlug/api/admin/campaigns', tenantLoader, requireSameTenantAsSession, handler);
 * 
 * @description
 * Process:
 * 1. Extracts `tenantSlug` from `req.params.tenantSlug`
 * 2. Queries database for tenant with matching slug
 * 3. If found: Sets `req.tenant` (full tenant object) and `req.tenantSlug`
 * 4. If not found: Returns 404 "Tenant non trovato"
 * 5. Runs migrations if needed (ensureTenantEmailColumns, etc.)
 * 
 * The loaded tenant object includes: id, slug, name, custom_domain, email_from_name,
 * email_from_address, mailgun_domain, mailgun_region.
 * 
 * @throws {404} Not Found - If tenant slug doesn't exist in database
 * @throws {500} Internal Server Error - If database query fails
 * 
 * @see {@link requireSameTenantAsSession} For verifying tenant matches session
 * @see {@link LLM_MD/TYPES.md} For Tenant and ExpressRequest type definitions
 */
async function tenantLoader(req, res, next) {
    try {
        const { tenantSlug } = req.params;
        logger.debug({ tenantSlug, path: req.path }, 'Loading tenant');
        const dbConn = await getDb();
        await ensureTenantEmailColumns(dbConn);
        await ensureFormCustomizationTenantId(dbConn);
        await ensureTenantScopedUniqueConstraints(dbConn);
        const tenant = await dbConn.get('SELECT id, slug, name, custom_domain, email_from_name, email_from_address, mailgun_domain, mailgun_region FROM tenants WHERE slug = ?', tenantSlug);
        if (!tenant) {
            logger.warn({ tenantSlug }, 'Tenant not found');
            return res.status(404).send('Tenant non trovato');
        }
        req.tenant = tenant;
        req.tenantSlug = tenant.slug;
        logger.debug({ tenant: tenant.slug }, 'Tenant loaded successfully');
        const logContext = logger.withRequest(req);
        logContext.debug({ tenant: tenant.slug }, 'Tenant loaded for request');
        next();
    } catch (e) {
        logger.error({ err: e, tenantSlug: req.params.tenantSlug }, 'tenantLoader error');
        const logContext = logger.withRequest(req);
        logContext.error({ err: e, tenantSlug: req.params.tenantSlug }, 'tenantLoader error');
        res.status(500).send('Errore tenant');
    }
}

/**
 * Middleware: Require that logged-in user's tenant matches tenant in URL path.
 * 
 * Verifies tenant isolation by ensuring the authenticated user's tenant matches
 * the tenant loaded from URL path (`req.tenant`). Superadmin can access all tenants.
 * 
 * @param {ExpressRequest} req - Express request object (must have req.session.user and req.tenant)
 * @param {Express.Response} res - Express response object
 * @param {Function} next - Express next middleware function
 * 
 * @returns {void} Calls next() if tenant matches, otherwise sends error/redirect
 * 
 * @example
 * // Protect tenant-scoped routes
 * app.get('/t/:tenantSlug/api/admin/campaigns', 
 *     tenantLoader, 
 *     requireSameTenantAsSession, 
 *     requireRole('admin'),
 *     handler
 * );
 * 
 * @description
 * Behavior:
 * - If not authenticated: Redirects to `/login`
 * - If superadmin: Always allowed (can access all tenants)
 * - If `req.tenant.id` matches `req.session.user.tenantId`: Allows access
 * - If `req.tenant.slug` matches `req.session.user.tenantSlug`: Allows access
 * - If slug mismatch but tenant ID matches: Redirects to correct slug path
 * - Otherwise: Returns 403 "Tenant mismatch"
 * 
 * This middleware MUST be used after `tenantLoader` to ensure `req.tenant` is set.
 * 
 * @throws {400} Bad Request - If req.tenant is invalid
 * @throws {403} Forbidden - If tenant doesn't match session (non-superadmin)
 * 
 * @see {@link tenantLoader} For loading tenant from URL
 * @see {@link LLM_MD/TYPES.md} For Tenant and SessionUser type definitions
 */
function requireSameTenantAsSession(req, res, next) {
    if (!req.session || !req.session.user) {
        return res.redirect('/login');
    }
    
    // Superadmin can access all tenants
    if (req.session.user.userType === 'superadmin') {
        return next();
    }
    
    if (!req.tenant || typeof req.tenant.id !== 'number') {
        return res.status(400).send('Tenant non valido');
    }
    const sessTenantId = req.session.user.tenantId;
    const sessTenantSlug = req.session.user.tenantSlug;
    if (typeof sessTenantId === 'number' && sessTenantId === req.tenant.id) {
        return next();
    }
    if (sessTenantSlug && sessTenantSlug === req.tenant.slug) {
        return next();
    }
    // As a safety, if only slug matches session, redirect to correct slug path
    if (sessTenantSlug && sessTenantSlug !== req.tenant.slug) {
        return res.redirect(`/t/${sessTenantSlug}${req.path.replace(`/t/${req.params.tenantSlug}`, '')}`);
    }
    return res.status(403).send('Tenant mismatch');
}

/**
 * Helper: Resolve tenant ID for legacy API requests (not tenant-prefixed).
 * 
 * Attempts to determine tenant ID from session or referer header for legacy routes
 * that don't have tenant slug in URL path (e.g., `/api/admin/*`).
 * 
 * @param {ExpressRequest} req - Express request object
 * @returns {Promise<number|null>} Tenant ID or null if not found
 * 
 * @example
 * // In legacy route handler
 * const tenantId = await getTenantIdForApi(req);
 * if (!tenantId) {
 *     return res.status(400).json({ error: 'Tenant non valido' });
 * }
 * 
 * @description
 * Resolution order:
 * 1. If `req.tenant?.id` exists (already loaded by tenantLoader), return it
 * 2. Try to extract tenant slug from Referer header (`/t/:tenantSlug/...`)
 * 3. If found, query database for tenant ID
 * 4. Otherwise, return `req.session.user.tenantId` if available
 * 5. Return null if none found
 * 
 * This function is used by legacy routes (`/api/admin/*`) that don't have tenant
 * in URL path but need tenant ID for database queries.
 * 
 * @see {@link getTenantId} For unified tenant ID resolution (preferred)
 * @see {@link LLM_MD/TYPES.md} For ExpressRequest type definition
 */
async function getTenantIdForApi(req) {
    const sess = req.session && req.session.user;
    if (req.tenant && typeof req.tenant.id === 'number') return req.tenant.id;
    // Try to infer from Referer: /t/:tenantSlug/...
    try {
        const ref = req.headers && (req.headers.referer || req.headers.referrer);
        if (ref) {
            const m = ref.match(/\/t\/([^\/]+)/);
            if (m && m[1]) {
                const dbConn = await getDb();
                const t = await dbConn.get('SELECT id FROM tenants WHERE slug = ?', m[1]);
                if (t && typeof t.id === 'number') return t.id;
            }
        }
    } catch (_) {}
    return (sess && typeof sess.tenantId === 'number') ? sess.tenantId : null;
}

module.exports = {
    tenantLoader,
    requireSameTenantAsSession,
    getTenantIdForApi
};


