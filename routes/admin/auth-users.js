'use strict';

const { getDb } = require('../../utils/db');
const { registerAdminRoute, getTenantId, sendSanitizedJson } = require('../../utils/routeHelper');
const { hashPassword } = require('../../routes/auth');
const { validatePassword, getPolicyRequirements } = require('../../utils/passwordPolicy');
const logger = require('../../utils/logger');

/**
 * Setup auth-users routes (admin/store users management).
 * 
 * Registers all authentication user-related admin routes (both legacy and tenant-scoped variants).
 * These routes manage admin and store users (not end users).
 * 
 * Routes registered:
 * - GET /api/admin/auth-users - List auth users (admin/store users)
 * - POST /api/admin/auth-users - Create auth user
 * - PUT /api/admin/auth-users/:id - Update auth user
 * - DELETE /api/admin/auth-users/:id - Delete auth user
 * 
 * @param {Express.App} app - Express application instance
 * @returns {void}
 */
function setupAuthUsersRoutes(app) {
    /**
     * GET /api/admin/auth-users and /t/:tenantSlug/api/admin/auth-users - List auth users
     * 
     * Returns list of authentication users (admin/store users) for the tenant.
     * Superadmin can view all users across all tenants if no tenant context.
     * Regular admin can only view users for their tenant.
     * Superadmin users are never returned for security.
     * 
     * @route GET /api/admin/auth-users
     * @route GET /t/:tenantSlug/api/admin/auth-users
     * @middleware requireAdmin (legacy) | tenantLoader, requireSameTenantAsSession, requireRole('admin') (tenant-scoped)
     * 
     * @param {ExpressRequest} req - Express request object
     * @param {Express.Response} res - Express response object
     * 
     * @returns {Array<AuthUser>} Array of auth user objects
     * @returns {number} returns[].id - User ID
     * @returns {string} returns[].username - Username
     * @returns {string} returns[].userType - User type (admin, store)
     * @returns {boolean} returns[].isActive - Whether user is active
     * @returns {string} [returns[].lastLogin] - Last login date (ISO datetime string, if logged in)
     * @returns {number} [returns[].tenantId] - Tenant ID (only for superadmin view)
     * 
     * @throws {400} Bad Request - If tenant ID is invalid (for regular admin)
     * @throws {403} Forbidden - If user is not admin or superadmin
     * @throws {500} Internal Server Error - If database query fails
     * 
     * @example
     * // Response (tenant-scoped)
     * [
     *   {
     *     id: 1,
     *     username: "admin1",
     *     userType: "admin",
     *     isActive: true,
     *     lastLogin: "2024-01-15T10:00:00.000Z"
     *   }
     * ]
     */
    registerAdminRoute(app, '/auth-users', 'get', async (req, res) => {
        try {
            const sess = req.session && req.session.user;
            if (!sess || (sess.userType !== 'admin' && sess.userType !== 'superadmin')) return res.status(403).json({ error: 'Accesso negato' });
            const dbConn = await getDb();
            
            // Resolve tenant from path/referrer/session
            const tenantId = await getTenantId(req);
            
            // Superadmin can see all users if no tenant context, otherwise tenant-scoped
            // Regular admin must have a tenant
            if (sess.userType === 'superadmin' && !tenantId) {
                // Superadmin viewing all users across all tenants
                const rows = await dbConn.all(
                    `SELECT id, username, user_type as userType, is_active as isActive, last_login as lastLogin, tenant_id as tenantId
                     FROM auth_users
                     WHERE user_type IN ('admin','store')
                     ORDER BY user_type ASC, username ASC`
                );
                // Sicurezza extra: non mostrare mai superadmin
                const filtered = rows.filter(u => u.userType !== 'superadmin');
                // Sanitize output to prevent XSS
                sendSanitizedJson(res, filtered);
            } else {
                // Tenant-scoped access (admin or superadmin with tenant context)
                if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
                
                const rows = await dbConn.all(
                    `SELECT id, username, user_type as userType, is_active as isActive, last_login as lastLogin
                     FROM auth_users
                     WHERE tenant_id = ? AND user_type IN ('admin','store')
                     ORDER BY user_type ASC, username ASC`,
                    tenantId
                );
                // Sicurezza extra: non mostrare mai superadmin
                const filtered = rows.filter(u => u.userType !== 'superadmin');
                // Sanitize output to prevent XSS
                sendSanitizedJson(res, filtered);
            }
        } catch (e) {
            logger.error({ err: e }, 'Error fetching auth users');
            res.status(500).json({ error: 'Errore server' });
        }
    });

    /**
     * POST /api/admin/auth-users and /t/:tenantSlug/api/admin/auth-users - Create auth user
     * 
     * Creates a new authentication user (admin or store). Password must meet policy requirements.
     * Only superadmin can create admin users. Regular admin can only create store users.
     * Superadmin can specify tenant_id in body, otherwise uses request context.
     * 
     * @route POST /api/admin/auth-users
     * @route POST /t/:tenantSlug/api/admin/auth-users
     * @middleware requireAdmin (legacy) | tenantLoader, requireSameTenantAsSession, requireRole('admin') (tenant-scoped)
     * 
     * @param {ExpressRequest} req - Express request object
     * @param {ExpressRequest.body} req.body - Request body
     * @param {string} req.body.username - Username (required, alphanumeric, 3-30 chars)
     * @param {string} req.body.password - Password (required, must meet policy: min 12 chars, uppercase, lowercase, number, special char)
     * @param {string} req.body.user_type - User type: "admin" or "store" (required)
     * @param {number} [req.body.tenant_id] - Tenant ID (optional, only for superadmin, otherwise uses context)
     * @param {Express.Response} res - Express response object
     * 
     * @returns {Object} Created user response
     * @returns {number} returns.id - User ID
     * @returns {string} returns.username - Username
     * @returns {string} returns.userType - User type (admin, store)
     * @returns {number} returns.isActive - Always 1 (active)
     * 
     * @throws {400} Bad Request - If data invalid, password doesn't meet policy, username already exists, or tenant ID invalid
     * @throws {403} Forbidden - If user is not admin/superadmin, or regular admin trying to create admin user
     * @throws {500} Internal Server Error - If database insert fails
     * 
     * @example
     * // Request body
     * {
     *   username: "storeuser1",
     *   password: "SecureP@ssw0rd123",
     *   user_type: "store"
     * }
     * 
     * // Response
     * {
     *   id: 1,
     *   username: "storeuser1",
     *   userType: "store",
     *   isActive: 1
     * }
     */
    registerAdminRoute(app, '/auth-users', 'post', async (req, res) => {
        try {
            const sess = req.session && req.session.user;
            if (!sess || (sess.userType !== 'admin' && sess.userType !== 'superadmin')) return res.status(403).json({ error: 'Accesso negato' });
            const { username, password, user_type, tenant_id } = req.body || {};
            const role = String(user_type || '').toLowerCase();
            if (!username || !password || !['admin', 'store'].includes(role)) {
                return res.status(400).json({ error: 'Dati non validi' });
            }
            
            // Validate password against policy
            const passwordValidation = validatePassword(password);
            if (!passwordValidation.valid) {
                return res.status(400).json({ 
                    error: 'Password non conforme alla policy',
                    details: passwordValidation.errors,
                    requirements: getPolicyRequirements()
                });
            }
            
            // Solo il Superadmin può creare utenti con ruolo admin
            if (role === 'admin' && sess.userType !== 'superadmin') {
                return res.status(403).json({ error: 'Solo il Superadmin può creare utenti admin' });
            }
            const dbConn = await getDb();
            // Secure password hashing using bcrypt
            const passwordHash = await hashPassword(password);
            
            // Resolve tenant: SuperAdmin can specify tenant_id in body, otherwise use context
            let tenantId = tenant_id;
            if (!tenantId) {
                tenantId = await getTenantId(req);
            }
            // SuperAdmin can create users without tenant context if tenant_id is provided in body
            // Regular admin must have tenant context
            if (!tenantId && sess.userType !== 'superadmin') {
                return res.status(400).json({ error: 'Tenant non valido' });
            }
            if (!tenantId) {
                return res.status(400).json({ error: 'Tenant ID richiesto' });
            }
            
            try {
                const result = await dbConn.run(
                    'INSERT INTO auth_users (username, password_hash, user_type, is_active, tenant_id) VALUES (?, ?, ?, 1, ?)',
                    username, passwordHash, role, tenantId
                );
                res.json({ id: result.lastID, username, userType: role, isActive: 1 });
            } catch (err) {
                if (String(err && err.message || '').includes('UNIQUE')) {
                    return res.status(400).json({ error: 'Username già esistente' });
                }
                throw err;
            }
        } catch (e) {
            logger.error({ err: e }, 'Error creating auth user');
            res.status(500).json({ error: 'Errore server' });
        }
    });

    /**
     * PUT /api/admin/auth-users/:id and /t/:tenantSlug/api/admin/auth-users/:id - Update auth user
     * 
     * Updates an authentication user. Only updates fields provided in request body.
     * Password must meet policy requirements if provided.
     * Only superadmin can modify admin users or change roles to/from admin.
     * Users cannot deactivate themselves or change their own role.
     * 
     * @route PUT /api/admin/auth-users/:id
     * @route PUT /t/:tenantSlug/api/admin/auth-users/:id
     * @middleware requireAdmin (legacy) | tenantLoader, requireSameTenantAsSession, requireRole('admin') (tenant-scoped)
     * 
     * @param {ExpressRequest} req - Express request object
     * @param {ExpressRequest.params} req.params - URL parameters
     * @param {string} req.params.id - User ID to update
     * @param {ExpressRequest.body} req.body - Request body
     * @param {string} [req.body.username] - Username (optional)
     * @param {string} [req.body.password] - Password (optional, must meet policy if provided)
     * @param {string} [req.body.user_type] - User type: "admin" or "store" (optional, only superadmin can set admin)
     * @param {boolean} [req.body.is_active] - Whether user is active (optional, cannot deactivate self)
     * @param {Express.Response} res - Express response object
     * 
     * @returns {Object} Success response
     * @returns {boolean} returns.ok - Always true
     * 
     * @throws {400} Bad Request - If role invalid, password doesn't meet policy, username already exists, or operation not allowed
     * @throws {403} Forbidden - If user is not admin/superadmin, or regular admin trying to modify admin user
     * @throws {404} Not Found - If user doesn't exist or doesn't belong to tenant
     * @throws {500} Internal Server Error - If database update fails
     * 
     * @example
     * // Request: PUT /api/admin/auth-users/1
     * // Body:
     * {
     *   password: "NewSecureP@ssw0rd123",
     *   is_active: true
     * }
     * // Response
     * {
     *   ok: true
     * }
     */
    registerAdminRoute(app, '/auth-users/:id', 'put', async (req, res) => {
        try {
            const sess = req.session && req.session.user;
            if (!sess || (sess.userType !== 'admin' && sess.userType !== 'superadmin')) return res.status(403).json({ error: 'Accesso negato' });
            const { username, password, user_type, is_active } = req.body || {};
            const role = user_type ? String(user_type).toLowerCase() : undefined;
            if (role && !['admin', 'store'].includes(role)) {
                return res.status(400).json({ error: 'Ruolo non valido' });
            }
            const dbConn = await getDb();
            
            // SuperAdmin can modify any user, regular admin only tenant-scoped users
            let user;
            if (sess.userType === 'superadmin') {
                // SuperAdmin can modify any user (no tenant restriction)
                user = await dbConn.get('SELECT * FROM auth_users WHERE id = ?', req.params.id);
            } else {
                // Regular admin: tenant-scoped
                const tenantId = await getTenantId(req);
                if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
                user = await dbConn.get('SELECT * FROM auth_users WHERE id = ? AND tenant_id = ?', req.params.id, tenantId);
            }
            
            if (!user) return res.status(404).json({ error: 'Utente non trovato' });
            if (user.user_type === 'superadmin') return res.status(400).json({ error: 'Operazione non consentita' });
            // Solo il Superadmin può modificare utenti con ruolo admin
            if (user.user_type === 'admin' && sess.userType !== 'superadmin') {
                return res.status(403).json({ error: 'Solo il Superadmin può modificare utenti admin' });
            }
            // Solo il Superadmin può promuovere/demotere a/da admin
            if (role === 'admin' && sess.userType !== 'superadmin') {
                return res.status(403).json({ error: 'Solo il Superadmin può assegnare il ruolo admin' });
            }
            if (user.id === (sess.authUserId || sess.id)) {
                // Prevent demoting or deactivating self
                if ((role && role !== 'admin') || (is_active === 0 || is_active === false)) {
                    return res.status(400).json({ error: 'Non puoi disattivare o cambiare ruolo al tuo utente' });
                }
            }
            
            // Rimuoviamo l'eccezione del "primo admin": ora solo il Superadmin può modificare admin
            // Build update dynamically
            const fields = [];
            const params = [];
            if (username && username !== user.username) {
                fields.push('username = ?');
                params.push(username);
            }
            if (typeof is_active !== 'undefined') {
                fields.push('is_active = ?');
                params.push(is_active ? 1 : 0);
            }
            if (role) {
                fields.push('user_type = ?');
                params.push(role);
            }
            if (password) {
                // Validate password against policy
                const passwordValidation = validatePassword(password);
                if (!passwordValidation.valid) {
                    return res.status(400).json({ 
                        error: 'Password non conforme alla policy',
                        details: passwordValidation.errors,
                        requirements: getPolicyRequirements()
                    });
                }
                fields.push('password_hash = ?');
                const newPasswordHash = await hashPassword(password);
                params.push(newPasswordHash);
            }
            if (fields.length === 0) return res.json({ ok: true });
            params.push(req.params.id);
            // For superadmin, no tenant restriction; for regular admin, add tenant_id filter
            if (sess.userType === 'superadmin') {
                await dbConn.run(`UPDATE auth_users SET ${fields.join(', ')} WHERE id = ?`, ...params);
            } else {
                const tenantId = await getTenantId(req);
                if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
                params.push(tenantId);
                await dbConn.run(`UPDATE auth_users SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ?`, ...params);
            }
            res.json({ ok: true });
        } catch (e) {
            if (String(e && e.message || '').includes('UNIQUE')) {
                return res.status(400).json({ error: 'Username già esistente' });
            }
            logger.error({ err: e }, 'Error updating auth user');
            res.status(500).json({ error: 'Errore server' });
        }
    });

    /**
     * DELETE /api/admin/auth-users/:id and /t/:tenantSlug/api/admin/auth-users/:id - Delete auth user
     * 
     * Permanently deletes an authentication user. Only deletes users belonging to the tenant (or any tenant for superadmin).
     * Superadmin users cannot be deleted. Users cannot delete themselves.
     * 
     * @route DELETE /api/admin/auth-users/:id
     * @route DELETE /t/:tenantSlug/api/admin/auth-users/:id
     * @middleware requireAdmin (legacy) | tenantLoader, requireSameTenantAsSession, requireRole('admin') (tenant-scoped)
     * 
     * @param {ExpressRequest} req - Express request object
     * @param {ExpressRequest.params} req.params - URL parameters
     * @param {string} req.params.id - User ID to delete
     * @param {Express.Response} res - Express response object
     * 
     * @returns {Object} Success response
     * @returns {boolean} returns.ok - Always true
     * 
     * @throws {400} Bad Request - If tenant ID is invalid or operation not allowed (superadmin, self-deletion)
     * @throws {403} Forbidden - If user is not admin/superadmin
     * @throws {404} Not Found - If user doesn't exist or doesn't belong to tenant
     * @throws {500} Internal Server Error - If database operation fails
     * 
     * @example
     * // Request: DELETE /api/admin/auth-users/1
     * // Response
     * {
     *   ok: true
     * }
     */
    registerAdminRoute(app, '/auth-users/:id', 'delete', async (req, res) => {
        try {
            const sess = req.session && req.session.user;
            if (!sess || (sess.userType !== 'admin' && sess.userType !== 'superadmin')) return res.status(403).json({ error: 'Accesso negato' });
            const dbConn = await getDb();
            
            // SuperAdmin can delete any user, regular admin only tenant-scoped users
            let user;
            if (sess.userType === 'superadmin') {
                // SuperAdmin can delete any user (no tenant restriction)
                user = await dbConn.get('SELECT * FROM auth_users WHERE id = ?', req.params.id);
            } else {
                // Regular admin: tenant-scoped
                const tenantId = await getTenantId(req);
                if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
                user = await dbConn.get('SELECT * FROM auth_users WHERE id = ? AND tenant_id = ?', req.params.id, tenantId);
            }
            
            if (!user) return res.status(404).json({ error: 'Utente non trovato' });
            if (user.user_type === 'superadmin') return res.status(400).json({ error: 'Operazione non consentita' });
            // Solo il Superadmin può eliminare utenti con ruolo admin
            if (user.user_type === 'admin' && sess.userType !== 'superadmin') {
                return res.status(403).json({ error: 'Solo il Superadmin può eliminare utenti admin' });
            }
            
            // Rimuoviamo la regola del "primo admin": gestione riservata al Superadmin
            if (user.id === (sess.authUserId || sess.id)) return res.status(400).json({ error: 'Non puoi eliminare il tuo utente' });
            // For superadmin, no tenant restriction; for regular admin, add tenant_id filter
            if (sess.userType === 'superadmin') {
                await dbConn.run('DELETE FROM auth_users WHERE id = ?', req.params.id);
            } else {
                const tenantId = await getTenantId(req);
                if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
                await dbConn.run('DELETE FROM auth_users WHERE id = ? AND tenant_id = ?', req.params.id, tenantId);
            }
            res.json({ ok: true });
        } catch (e) {
            logger.error({ err: e }, 'Error deleting auth user');
            res.status(500).json({ error: 'Errore server' });
        }
    });
}

module.exports = { setupAuthUsersRoutes };

