'use strict';

const { getDb } = require('../../utils/db');
const { registerAdminRoute, getTenantId } = require('../../utils/routeHelper');
const { hashPassword } = require('../../routes/auth');
const logger = require('../../utils/logger');

/**
 * Setup auth-users routes (admin/store users management)
 */
function setupAuthUsersRoutes(app) {
    // GET /api/admin/auth-users and /t/:tenantSlug/api/admin/auth-users - List auth users (admin/store users)
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
                res.json(filtered);
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
                res.json(filtered);
            }
        } catch (e) {
            logger.error({ err: e }, 'Error fetching auth users');
            res.status(500).json({ error: 'Errore server' });
        }
    });

    // POST /api/admin/auth-users and /t/:tenantSlug/api/admin/auth-users - Create auth user
    registerAdminRoute(app, '/auth-users', 'post', async (req, res) => {
        try {
            const sess = req.session && req.session.user;
            if (!sess || (sess.userType !== 'admin' && sess.userType !== 'superadmin')) return res.status(403).json({ error: 'Accesso negato' });
            const { username, password, user_type, tenant_id } = req.body || {};
            const role = String(user_type || '').toLowerCase();
            if (!username || !password || !['admin', 'store'].includes(role)) {
                return res.status(400).json({ error: 'Dati non validi' });
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

    // PUT /api/admin/auth-users/:id and /t/:tenantSlug/api/admin/auth-users/:id - Update auth user
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
                fields.push('password_hash = ?');
                const newPasswordHash = await hashPassword(password);
                params.push(newPasswordHash);
            }
            if (fields.length === 0) return res.json({ ok: true });
            params.push(req.params.id);
            await dbConn.run(`UPDATE auth_users SET ${fields.join(', ')} WHERE id = ?` , ...params);
            res.json({ ok: true });
        } catch (e) {
            if (String(e && e.message || '').includes('UNIQUE')) {
                return res.status(400).json({ error: 'Username già esistente' });
            }
            logger.error({ err: e }, 'Error updating auth user');
            res.status(500).json({ error: 'Errore server' });
        }
    });

    // DELETE /api/admin/auth-users/:id and /t/:tenantSlug/api/admin/auth-users/:id - Delete auth user
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
            await dbConn.run('DELETE FROM auth_users WHERE id = ?', req.params.id);
            res.json({ ok: true });
        } catch (e) {
            logger.error({ err: e }, 'Error deleting auth user');
            res.status(500).json({ error: 'Errore server' });
        }
    });
}

module.exports = { setupAuthUsersRoutes };

