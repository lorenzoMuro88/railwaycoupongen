'use strict';

/**
 * Middleware: Require authenticated user (any logged-in user).
 * 
 * Verifies that the request has a valid session with a logged-in user.
 * Redirects to `/login` if not authenticated.
 * 
 * @param {ExpressRequest} req - Express request object
 * @param {Express.Response} res - Express response object
 * @param {Function} next - Express next middleware function
 * 
 * @example
 * // Protect a route
 * app.get('/protected', requireAuth, (req, res) => {
 *     res.send('Protected content');
 * });
 * 
 * @description
 * Checks for `req.session.user` existence. If missing, redirects to login page.
 * Works for all user types: admin, store, superadmin.
 * 
 * @see {@link LLM_MD/TYPES.md} For ExpressRequest and SessionUser type definitions
 */
function requireAuth(req, res, next) {
    if (req.session && req.session.user) {
        return next();
    } else {
        return res.redirect('/login');
    }
}

/**
 * Middleware: Require admin or superadmin role.
 * 
 * Verifies that the authenticated user has role "admin" or "superadmin".
 * Returns 403 Forbidden for API requests, redirects to login for HTML requests.
 * 
 * @param {ExpressRequest} req - Express request object (must have req.session.user)
 * @param {Express.Response} res - Express response object
 * @param {Function} next - Express next middleware function
 * 
 * @returns {void} Calls next() if authorized, otherwise sends error response
 * 
 * @example
 * // Protect admin routes
 * app.get('/api/admin/users', requireAdmin, async (req, res) => {
 *     // Only admin/superadmin can access
 * });
 * 
 * @description
 * Behavior:
 * - If not authenticated: Redirects to `/login` (HTML) or returns 403 (API)
 * - If userType is "admin" or "superadmin": Allows access
 * - Otherwise: Returns 403 Forbidden
 * 
 * API requests (path starts with `/api/`) return JSON error.
 * HTML requests redirect to login page.
 * 
 * @throws {403} Forbidden - If user doesn't have admin/superadmin role
 * 
 * @see {@link requireRole} For role-specific middleware factory
 * @see {@link LLM_MD/TYPES.md} For SessionUser type definition
 */
function requireAdmin(req, res, next) {
    if (req.session && req.session.user && (req.session.user.userType === 'admin' || req.session.user.userType === 'superadmin')) {
        return next();
    } else {
        // If it's an API request, return JSON
        if (req.path.startsWith('/api/')) {
            return res.status(403).json({ error: 'Accesso negato. Richiesto ruolo Admin.' });
        }
        return res.status(403).send('Accesso negato. Richiesto ruolo Admin.');
    }
}

/**
 * Middleware: Require superadmin role.
 * 
 * Verifies that the authenticated user has role "superadmin".
 * Returns 403 Forbidden if user is not superadmin.
 * 
 * @param {ExpressRequest} req - Express request object (must have req.session.user)
 * @param {Express.Response} res - Express response object
 * @param {Function} next - Express next middleware function
 * 
 * @returns {void} Calls next() if authorized, otherwise sends 403 response
 * 
 * @example
 * // Protect superadmin-only routes
 * app.get('/superadmin/tenants', requireSuperAdmin, async (req, res) => {
 *     // Only superadmin can access
 * });
 * 
 * @description
 * Checks if `req.session.user.userType === 'superadmin'`.
 * Returns 403 Forbidden for all non-superadmin users.
 * 
 * @throws {403} Forbidden - If user is not superadmin
 * 
 * @see {@link LLM_MD/TYPES.md} For SessionUser type definition
 */
function requireSuperAdmin(req, res, next) {
    if (req.session && req.session.user && req.session.user.userType === 'superadmin') {
        return next();
    }
    return res.status(403).send('Accesso negato. Richiesto ruolo SuperAdmin.');
}

/**
 * Middleware: Require store, admin, or superadmin role.
 * 
 * Verifies that the authenticated user has role "store", "admin", or "superadmin".
 * Returns 403 Forbidden if user doesn't have one of these roles.
 * 
 * @param {ExpressRequest} req - Express request object (must have req.session.user)
 * @param {Express.Response} res - Express response object
 * @param {Function} next - Express next middleware function
 * 
 * @returns {void} Calls next() if authorized, otherwise sends 403 response
 * 
 * @example
 * // Protect store interface routes
 * app.get('/store/coupons', requireStore, async (req, res) => {
 *     // Store, admin, or superadmin can access
 * });
 * 
 * @description
 * Allows access for:
 * - "store" role users
 * - "admin" role users
 * - "superadmin" role users
 * 
 * Returns 403 Forbidden for any other user type or unauthenticated users.
 * 
 * @throws {403} Forbidden - If user doesn't have store/admin/superadmin role
 * 
 * @see {@link LLM_MD/TYPES.md} For SessionUser type definition
 */
function requireStore(req, res, next) {
    if (req.session && req.session.user && (req.session.user.userType === 'store' || req.session.user.userType === 'admin' || req.session.user.userType === 'superadmin')) {
        return next();
    } else {
        return res.status(403).send('Accesso negato. Richiesto ruolo Store.');
    }
}

/**
 * Middleware factory: Create role-specific middleware.
 * 
 * Returns a middleware function that verifies the user has the specified role.
 * Superadmin can access all routes regardless of role requirement.
 * 
 * @param {string} role - Required role: 'admin' or 'store'
 * @returns {Function} Express middleware function
 * 
 * @example
 * // Create admin-only middleware
 * const requireAdminRole = requireRole('admin');
 * app.get('/api/admin/campaigns', requireAdminRole, handler);
 * 
 * @example
 * // Create store-only middleware
 * const requireStoreRole = requireRole('store');
 * app.get('/store/redeem', requireStoreRole, handler);
 * 
 * @description
 * Behavior:
 * - Superadmin: Always allowed (can access everything)
 * - Admin role: Allowed for 'admin' role requirement
 * - Store role: Allowed for 'store' role requirement, admin can also access store routes
 * - Other roles: Not allowed
 * - Unauthenticated: Redirects to `/login`
 * 
 * @throws {Error} If role is not 'admin' or 'store'
 * 
 * @see {@link requireAdmin} For direct admin middleware
 * @see {@link requireStore} For direct store middleware
 * @see {@link LLM_MD/TYPES.md} For SessionUser type definition
 */
function requireRole(role) {
    return function(req, res, next) {
        const user = req.session && req.session.user;
        if (!user) return res.redirect('/login');
        
        // Superadmin can access everything
        if (user.userType === 'superadmin') {
            return next();
        }
        
        if (role === 'admin' && user.userType !== 'admin') return res.status(403).send('Accesso negato. Richiesto ruolo Admin.');
        if (role === 'store' && user.userType !== 'store' && user.userType !== 'admin') return res.status(403).send('Accesso negato. Richiesto ruolo Store.');
        return next();
    }
}

module.exports = {
    requireAuth,
    requireAdmin,
    requireSuperAdmin,
    requireStore,
    requireRole
};


