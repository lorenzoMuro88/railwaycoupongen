'use strict';

const path = require('path');
const bcrypt = require('bcrypt');
const { getDb } = require('../utils/db');
const { checkLoginRateLimit, recordLoginFailure, recordLoginSuccess } = require('../middleware/rateLimit');
const logger = require('../utils/logger');
const { tenantLoader } = require('../middleware/tenant');

const DEFAULT_TENANT_SLUG = process.env.DEFAULT_TENANT_SLUG || 'default';

/**
 * Convert string to URL-friendly slug.
 * 
 * Converts a string to a lowercase, URL-friendly slug by:
 * - Converting to lowercase
 * - Removing diacritics (accents)
 * - Replacing non-alphanumeric characters with hyphens
 * - Trimming leading/trailing hyphens
 * - Limiting to 64 characters
 * 
 * @param {string} input - String to convert to slug
 * @returns {string} URL-friendly slug (defaults to 'tenant' if input is empty)
 * 
 * @example
 * toSlug("Mario's Store") // Returns: "marios-store"
 * toSlug("Café & Restaurant") // Returns: "cafe-restaurant"
 * toSlug("") // Returns: "tenant"
 */
function toSlug(input) {
    return String(input || '')
        .toLowerCase()
        .normalize('NFD').replace(/\p{Diacritic}/gu, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64) || 'tenant';
}

/**
 * Log action to system logs database.
 * 
 * Records user actions, system events, and administrative operations to the system_logs table.
 * Used for audit trails and debugging. Does not throw errors to avoid breaking main flow.
 * 
 * Enhanced with:
 * - Better tenant context resolution
 * - Request ID tracking
 * - Automatic cleanup of old logs (retention policy)
 * 
 * @param {ExpressRequest} req - Express request object
 * @param {string} actionType - Type of action (e.g., 'login', 'logout', 'create', 'update', 'delete', 'read', 'access')
 * @param {string} actionDescription - Human-readable description of the action
 * @param {string} [level='info'] - Log level ('info', 'success', 'warning', 'error')
 * @param {Object|null} [details=null] - Additional details object (will be JSON stringified)
 * @returns {Promise<void>}
 * 
 * @example
 * await logAction(req, 'login', 'Login effettuato come admin', 'success', {
 *   username: 'admin',
 *   userType: 'admin'
 * });
 * 
 * @example
 * await logAction(req, 'create', 'Campaign created', 'info', {
 *   resourceType: 'campaign',
 *   resourceId: 123,
 *   name: 'Summer Sale'
 * });
 * 
 * @description
 * Retention Policy:
 * - Logs older than RETENTION_DAYS (default: 90 days) are automatically deleted
 * - Cleanup runs periodically (every 24 hours) and on-demand
 * - Configure via LOG_RETENTION_DAYS environment variable
 */
async function logAction(req, actionType, actionDescription, level = 'info', details = null) {
    try {
        const db = await getDb();
        const user = req.session?.user;
        const tenant = req.tenant;
        
        // Resolve tenant ID from multiple sources
        const tenantId = tenant?.id || user?.tenantId || null;
        const tenantName = tenant?.name || null;
        const tenantSlug = tenant?.slug || user?.tenantSlug || null;
        
        // Get request ID if available
        const requestId = req.requestId || req.id || req.headers['x-request-id'] || null;
        
        // Include request ID in details if available
        const enhancedDetails = {
            ...(details || {}),
            ...(requestId ? { requestId } : {})
        };
        
        await db.run(`
            INSERT INTO system_logs (
                user_id, username, user_type, tenant_id, tenant_name, tenant_slug,
                action_type, action_description, level, details, ip_address, user_agent
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            user?.id || null,
            user?.username || 'Sistema',
            user?.userType || 'system',
            tenantId,
            tenantName,
            tenantSlug,
            actionType,
            actionDescription,
            level,
            Object.keys(enhancedDetails).length > 0 ? JSON.stringify(enhancedDetails) : null,
            req.ip || req.connection?.remoteAddress || null,
            req.get('User-Agent') || null
        ]);
        
        // Periodic cleanup of old logs (run cleanup every 1000 inserts to avoid performance impact)
        // Full cleanup runs via scheduled job (see cleanupOldLogs function)
        if (Math.random() < 0.001) { // 0.1% chance per insert
            cleanupOldLogs(db).catch(err => {
                logger.warn({ err }, 'Failed to cleanup old logs');
            });
        }
    } catch (error) {
        logger.warn({ err: error }, 'Failed to log action to database');
        // Don't throw error to avoid breaking the main flow
    }
}

/**
 * Cleanup old logs based on retention policy.
 * 
 * Deletes logs older than LOG_RETENTION_DAYS (default: 90 days).
 * This function is called periodically to maintain log table size.
 * 
 * @param {Object} dbConn - Database connection object
 * @returns {Promise<number>} Number of deleted logs
 * 
 * @description
 * Retention Policy:
 * - Default: 90 days (configurable via LOG_RETENTION_DAYS env variable)
 * - Logs are permanently deleted (no archive)
 * - Runs automatically on periodic basis
 */
async function cleanupOldLogs(dbConn) {
    try {
        const RETENTION_DAYS = Number(process.env.LOG_RETENTION_DAYS || 90);
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);
        const cutoffDateStr = cutoffDate.toISOString();
        
        const result = await dbConn.run(
            'DELETE FROM system_logs WHERE timestamp < ?',
            cutoffDateStr
        );
        
        if (result.changes > 0) {
            logger.info({ deleted: result.changes, retentionDays: RETENTION_DAYS }, 'Cleaned up old logs');
        }
        
        return result.changes;
    } catch (error) {
        logger.error({ err: error }, 'Error cleaning up old logs');
        throw error;
    }
}

/**
 * Verify password against stored hash.
 * 
 * Supports both bcrypt (modern) and Base64 (legacy) password hashes for backward compatibility.
 * Automatically detects hash format and uses appropriate verification method.
 * 
 * @param {string} password - Plain text password to verify
 * @param {string} hash - Stored password hash (bcrypt or Base64)
 * @returns {Promise<boolean>} True if password matches hash, false otherwise
 * 
 * @example
 * const isValid = await verifyPassword('userPassword123', user.password_hash);
 * if (!isValid) {
 *   return res.status(401).json({ error: 'Invalid credentials' });
 * }
 */
async function verifyPassword(password, hash) {
    // If hash looks like bcrypt (starts with $2a$, $2b$, or $2y$), use bcrypt
    if (hash && (hash.startsWith('$2a$') || hash.startsWith('$2b$') || hash.startsWith('$2y$'))) {
        return await bcrypt.compare(password, hash);
    }
    // Legacy Base64 hashing for backward compatibility
    return Buffer.from(password).toString('base64') === hash;
}

/**
 * Hash password using bcrypt.
 * 
 * Creates a secure bcrypt hash of the password with cost factor 10
 * (good balance between security and performance).
 * 
 * @param {string} password - Plain text password to hash
 * @returns {Promise<string>} Bcrypt hash string (starts with $2a$, $2b$, or $2y$)
 * 
 * @example
 * const hash = await hashPassword('userPassword123');
 * await db.run('INSERT INTO auth_users (username, password_hash) VALUES (?, ?)', username, hash);
 */
async function hashPassword(password) {
    // Use bcrypt with cost factor 10 (good balance between security and performance)
    const saltRounds = 10;
    return await bcrypt.hash(password, saltRounds);
}

/**
 * Setup authentication routes.
 * 
 * Registers all authentication-related routes including:
 * - Public pages (access, signup, login)
 * - API endpoints (login, signup, logout)
 * - Convenience redirect routes
 * 
 * Routes registered:
 * - GET /access - Access page (public)
 * - GET /signup - Signup page (public)
 * - GET /login - Login page (public, redirects if already logged in)
 * - POST /api/login - Login API endpoint
 * - POST /api/signup - Tenant provisioning and signup
 * - POST /api/logout - Logout API endpoint
 * - GET /logout - Logout convenience route (redirects to /access)
 * - GET /t/:tenantSlug/logout - Tenant-scoped logout route (redirects to /access)
 * 
 * @param {Express.App} app - Express application instance
 * @returns {void}
 */
function setupAuthRoutes(app) {
    // Import validation middleware and schemas
    const { validateBody } = require('../middleware/validation');
    const { loginSchema, authUserSchema } = require('../utils/validators');
    const { validatePassword, getPolicyRequirements } = require('../utils/passwordPolicy');
    
    /**
     * GET /access - Access page (public)
     * 
     * Serves the public access page HTML file.
     * 
     * @route GET /access
     * @public
     * 
     * @param {ExpressRequest} req - Express request object
     * @param {Express.Response} res - Express response object
     * @returns {void} Sends access.html file
     * 
     * @example
     * // Request: GET /access
     * // Response: HTML file (access.html)
     */
    app.get('/access', (req, res) => {
        res.sendFile(path.join(__dirname, '..', 'views', 'access.html'));
    });

    /**
     * GET /signup - Signup page (public)
     * 
     * Serves the public signup page HTML file.
     * 
     * @route GET /signup
     * @public
     * 
     * @param {ExpressRequest} req - Express request object
     * @param {Express.Response} res - Express response object
     * @returns {void} Sends signup.html file
     * 
     * @example
     * // Request: GET /signup
     * // Response: HTML file (signup.html)
     */
    app.get('/signup', (req, res) => {
        res.sendFile(path.join(__dirname, '..', 'views', 'signup.html'));
    });

    /**
     * GET /login - Login page (public)
     * 
     * Serves the login page HTML file. If user is already logged in,
     * redirects to appropriate dashboard based on user type.
     * 
     * @route GET /login
     * @public
     * 
     * @param {ExpressRequest} req - Express request object
     * @param {ExpressRequest.session} req.session - Session object
     * @param {Object} [req.session.user] - User session data (if logged in)
     * @param {Express.Response} res - Express response object
     * @returns {void} Sends login.html file or redirects if already logged in
     * 
     * @example
     * // Request: GET /login
     * // Response: HTML file (login.html) or redirect to /admin or /store if already logged in
     */
    app.get('/login', (req, res) => {
        // If already logged in, redirect to appropriate page
        if (req.session && req.session.user) {
            const base = req.session.user.tenantSlug ? `/t/${req.session.user.tenantSlug}` : '';
            if (req.session.user.userType === 'admin') return res.redirect(base + '/admin');
            if (req.session.user.userType === 'store') return res.redirect(base + '/store');
        }
        res.sendFile(path.join(__dirname, '..', 'views', 'login.html'));
    });

    /**
     * POST /api/login - Login API endpoint
     * 
     * Authenticates user credentials and creates a session.
     * 
     * Features:
     * - Rate limiting protection (prevents brute force attacks)
     * - Password verification with bcrypt (supports legacy Base64 upgrade)
     * - Session regeneration (prevents session fixation)
     * - Automatic password hash upgrade (Base64 → bcrypt)
     * - Action logging for audit trail
     * 
     * @route POST /api/login
     * @middleware validateBody(loginSchema)
     * @public
     * 
     * @param {ExpressRequest} req - Express request object
     * @param {ExpressRequest.body} req.body - Request body (validated by middleware)
     * @param {string} req.body.username - Username (required, 3-50 chars, alphanumeric + underscore/hyphen)
     * @param {string} req.body.password - Password (required)
     * @param {string} req.body.userType - User type: 'admin' or 'store' (required)
     * @param {Express.Response} res - Express response object
     * 
     * @returns {Object} Login result
     * @returns {boolean} returns.success - Whether login was successful
     * @returns {string} returns.message - Success message
     * @returns {string} returns.redirect - Redirect URL based on user type ('/admin', '/store', or '/')
     * 
     * @throws {400} Bad Request - If validation fails (handled by middleware)
     * @throws {401} Unauthorized - If credentials are invalid
     * @throws {429} Too Many Requests - If rate limit exceeded
     * @throws {500} Internal Server Error - If database connection fails or other server error
     * 
     * @example
     * // Request body
     * {
     *   username: "admin",
     *   password: "SecureP@ssw0rd123",
     *   userType: "admin"
     * }
     * 
     * // Response (success)
     * {
     *   success: true,
     *   message: "Login effettuato con successo",
     *   redirect: "/admin"
     * }
     * 
     * // Response (invalid credentials)
     * {
     *   error: "Credenziali non valide"
     * }
     */
    app.post('/api/login', validateBody(loginSchema), async (req, res) => {
        try {
            // Data is already validated and sanitized by validateBody middleware
            const { username, password, userType } = req.body;
            const ip = req.ip || req.connection?.remoteAddress || 'unknown';
            const rate = checkLoginRateLimit(ip);
            if (!rate.ok) {
                return res.status(429).json({ error: 'Troppi tentativi. Riprova più tardi.' });
            }
            
            const dbConn = await getDb();
            if (!dbConn) {
                logger.error({ username, userType, ip }, 'Database connection failed during login');
                return res.status(500).json({ error: 'Errore di connessione al database' });
            }
            
            const user = await dbConn.get(
                'SELECT * FROM auth_users WHERE username = ? AND user_type = ? AND is_active = 1',
                username, userType
            );
            
            if (!user) {
                recordLoginFailure(ip);
                return res.status(401).json({ error: 'Credenziali non valide' });
            }
            
            // Verify password (with backward compatibility for Base64)
            const isValid = await verifyPassword(password, user.password_hash);
            if (!isValid) {
                recordLoginFailure(ip);
                return res.status(401).json({ error: 'Credenziali non valide' });
            }
            
            // If using legacy Base64 hash, upgrade to bcrypt on successful login
            if (!user.password_hash.startsWith('$2a$') && !user.password_hash.startsWith('$2b$') && !user.password_hash.startsWith('$2y$')) {
                try {
                    const newHash = await hashPassword(password);
                    await dbConn.run('UPDATE auth_users SET password_hash = ? WHERE id = ?', newHash, user.id);
                } catch (upgradeError) {
                    logger.warn({ err: upgradeError }, 'Error upgrading password hash');
                    // Continue with login even if upgrade fails
                }
            }
            
            recordLoginSuccess(ip);
            // Update last login
            await dbConn.run(
                'UPDATE auth_users SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
                user.id
            );
            
            // Regenerate session to prevent fixation
            try {
                await new Promise((resolve, reject) => {
                    req.session.regenerate(err => err ? reject(err) : resolve());
                });
            } catch (sessionError) {
                logger.warn({ userId: user.id, username: user.username }, 'Session regeneration failed during login');
                // Continue with login even if session regeneration fails
            }
            // Create session (tenant-scoped payload)
            const superAdminUsername = process.env.SUPERADMIN_USERNAME || 'admin';
            const isSuperAdmin = user && user.username === superAdminUsername;
            req.session.user = {
                id: user.id,
                username: user.username,
                userType: user.user_type,
                tenantId: user.tenant_id,
                tenantSlug: DEFAULT_TENANT_SLUG, // until path-based routing is introduced
                isSuperAdmin
            };
            
            // Determine redirect URL
            let redirectUrl;
            if (userType === 'admin') {
                redirectUrl = '/admin';
            } else if (userType === 'store') {
                redirectUrl = '/store';
            } else {
                redirectUrl = '/';
            }
            
            // Log successful login
            try {
                await logAction(req, 'login', `Login effettuato come ${userType}`, 'success', {
                    username: user.username,
                    userType: user.user_type,
                    tenantId: user.tenant_id
                });
            } catch (logError) {
                logger.warn({ userId: user.id, username: user.username }, 'Failed to log login action to database');
                // Continue with login even if logging fails
            }
            
            res.json({ 
                success: true, 
                message: 'Login effettuato con successo',
                redirect: redirectUrl
            });
            
        } catch (error) {
            const logContext = logger.withRequest(req);
            logContext.error({
                err: error,
                username: req.body?.username,
                userType: req.body?.userType
            }, 'Login endpoint error');
            res.status(500).json({ 
                error: 'Errore interno del server',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    });

    /**
     * POST /api/signup - Tenant provisioning and signup
     * 
     * Creates a new tenant with first admin user and automatically logs in.
     * 
     * Process:
     * 1. Validates tenant name, slug, and admin credentials
     * 2. Checks tenant slug uniqueness
     * 3. Validates admin password against policy
     * 4. Creates tenant record
     * 5. Creates default email template for tenant
     * 6. Creates first admin user (auth_users)
     * 7. Creates session and logs in automatically
     * 8. Logs tenant creation action
     * 
     * @route POST /api/signup
     * @public
     * 
     * @param {ExpressRequest} req - Express request object
     * @param {ExpressRequest.body} req.body - Request body
     * @param {string} req.body.tenantName - Tenant name (required)
     * @param {string} [req.body.tenantSlug] - Tenant slug (optional, auto-generated from tenantName if not provided)
     * @param {string} req.body.adminUsername - Admin username (required, 3-50 chars, alphanumeric + underscore/hyphen)
     * @param {string} req.body.adminPassword - Admin password (required, must meet password policy)
     * @param {Express.Response} res - Express response object
     * 
     * @returns {Object} Signup result
     * @returns {boolean} returns.ok - Whether signup was successful
     * @returns {string} returns.redirect - Redirect URL to tenant admin dashboard (e.g., "/t/tenant-slug/admin")
     * 
     * @throws {400} Bad Request - If required fields missing or password doesn't meet policy
     * @throws {409} Conflict - If tenant slug or admin username already exists
     * @throws {500} Internal Server Error - If database operations fail
     * 
     * @example
     * // Request body
     * {
     *   tenantName: "Mario's Store",
     *   tenantSlug: "marios-store", // Optional
     *   adminUsername: "admin",
     *   adminPassword: "SecureP@ssw0rd123"
     * }
     * 
     * // Response (success)
     * {
     *   ok: true,
     *   redirect: "/t/marios-store/admin"
     * }
     * 
     * // Response (password policy violation)
     * {
     *   error: "Password non conforme alla policy",
     *   details: ["La password deve contenere almeno 12 caratteri", ...],
     *   requirements: "La password deve contenere almeno 12 caratteri, inclusi: ..."
     * }
     */
    app.post('/api/signup', async (req, res) => {
        try {
            const { tenantName, tenantSlug, adminUsername, adminPassword } = req.body || {};
            if (!tenantName || !adminUsername || !adminPassword) {
                return res.status(400).json({ error: 'tenantName, adminUsername e adminPassword sono richiesti' });
            }
            const slug = toSlug(tenantSlug || tenantName);
            const dbConn = await getDb();

            // Check slug uniqueness
            const existing = await dbConn.get('SELECT id FROM tenants WHERE slug = ?', slug);
            if (existing) {
                return res.status(409).json({ error: 'Slug tenant già in uso' });
            }

            // Validate admin password against policy
            const passwordValidation = validatePassword(adminPassword);
            if (!passwordValidation.valid) {
                return res.status(400).json({ 
                    error: 'Password non conforme alla policy',
                    details: passwordValidation.errors,
                    requirements: getPolicyRequirements()
                });
            }
            
            // Create tenant
            const resultTenant = await dbConn.run('INSERT INTO tenants (slug, name) VALUES (?, ?)', slug, tenantName);
            const newTenantId = resultTenant.lastID;

            // Create default email template for new tenant
            const defaultTemplateHtml = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Il tuo coupon</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4;">
        <tr>
            <td align="center" style="padding: 20px 0;">
                <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                    <tr>
                        <td style="padding: 30px; text-align: center; background-color: #2d5a3d; border-radius: 8px 8px 0 0;">
                            <h1 style="color: #ffffff; margin: 0; font-size: 28px;">🎫 Il tuo Coupon</h1>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 30px;">
                            <p style="font-size: 16px; color: #333333; margin: 0 0 20px 0;">Ciao {{firstName}} {{lastName}},</p>
                            <p style="font-size: 16px; color: #333333; margin: 0 0 20px 0;">Ecco il tuo coupon personale che vale <strong style="color: #2d5a3d;">{{discountText}}</strong>!</p>
                            <div style="background-color: #f8f9fa; border: 2px dashed #2d5a3d; border-radius: 8px; padding: 20px; margin: 20px 0; text-align: center;">
                                <p style="font-size: 14px; color: #666666; margin: 0 0 10px 0;">Codice Coupon</p>
                                <p style="font-size: 32px; font-weight: bold; color: #2d5a3d; margin: 0; letter-spacing: 2px;">{{code}}</p>
                            </div>
                            <div style="text-align: center; margin: 30px 0; padding: 20px; background-color: #f8f9fa; border-radius: 8px;">
                                <p style="font-size: 14px; color: #666666; margin: 0 0 15px 0;">Scansiona il QR Code</p>
                                <img src="{{qrDataUrl}}" alt="QR Code" style="max-width: 200px; height: auto; border: 1px solid #ddd; border-radius: 8px; display: block; margin: 0 auto;">
                            </div>
                            <p style="font-size: 14px; color: #666666; margin: 20px 0 0 0;">Grazie per averci scelto!</p>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 20px 30px; background-color: #f8f9fa; border-radius: 0 0 8px 8px; text-align: center;">
                            <p style="font-size: 12px; color: #999999; margin: 0;">CouponGen - Sistema di Coupon Digitali</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;

            await dbConn.run(
                'INSERT INTO email_template (tenant_id, subject, html) VALUES (?, ?, ?)',
                newTenantId, 'Il tuo coupon', defaultTemplateHtml
            );

            // Create first admin user (auth)
            const existingAdmin = await dbConn.get('SELECT id FROM auth_users WHERE username = ? AND tenant_id = ?', adminUsername, newTenantId);
            if (existingAdmin) {
                return res.status(409).json({ error: 'Username già in uso per questo tenant' });
            }
            const adminPasswordHash = await hashPassword(adminPassword);
            await dbConn.run(
                'INSERT INTO auth_users (username, password_hash, user_type, is_active, tenant_id) VALUES (?, ?, ?, 1, ?)',
                adminUsername, adminPasswordHash, 'admin', newTenantId
            );

            // Login session
            await new Promise((resolve, reject) => req.session.regenerate(err => err ? reject(err) : resolve()));
            const superAdminUsername = process.env.SUPERADMIN_USERNAME || 'admin';
            const isSuperAdmin = adminUsername === superAdminUsername;
            req.session.user = {
                id: null,
                username: adminUsername,
                userType: 'admin',
                tenantId: newTenantId,
                tenantSlug: slug,
                isSuperAdmin
            };
            
            // Log tenant creation
            await logAction(req, 'create', `Nuovo tenant creato: ${tenantName}`, 'success', {
                tenantName: tenantName,
                tenantSlug: slug,
                adminUsername: adminUsername,
                tenantId: newTenantId
            });
            
            return res.json({ ok: true, redirect: `/t/${slug}/admin` });
        } catch (e) {
            logger.error({ err: e }, 'Signup error');
            res.status(500).json({ error: 'Errore durante la registrazione' });
        }
    });

    /**
     * POST /api/logout - Logout API endpoint
     * 
     * Destroys user session and clears session cookie.
     * Logs logout action before destroying session.
     * 
     * @route POST /api/logout
     * @public (no auth required, but logs action if session exists)
     * 
     * @param {ExpressRequest} req - Express request object
     * @param {ExpressRequest.session} [req.session] - Session object (if exists)
     * @param {Express.Response} res - Express response object
     * 
     * @returns {Object} Logout result
     * @returns {boolean} returns.success - Whether logout was successful
     * @returns {string} returns.message - Success message
     * 
     * @throws {500} Internal Server Error - If session destruction fails
     * 
     * @example
     * // Response
     * {
     *   success: true,
     *   message: "Logout effettuato con successo"
     * }
     */
    app.post('/api/logout', async (req, res) => {
        // Log logout action before destroying session
        if (req.session && req.session.user) {
            await logAction(req, 'logout', 'Logout effettuato', 'info', {
                username: req.session.user.username,
                userType: req.session.user.userType
            });
        }
        
        if (req.session) {
            req.session.destroy((err) => {
                if (err) {
                    logger.error({ err }, 'Logout error');
                    return res.status(500).json({ error: 'Errore durante il logout' });
                }
                // Clear session cookie (use configured cookie name, default: sessionId)
                const cookieName = process.env.SESSION_COOKIE_NAME || 'sessionId';
                res.clearCookie(cookieName);
                res.json({ success: true, message: 'Logout effettuato con successo' });
            });
        } else {
            res.json({ success: true, message: 'Logout effettuato con successo' });
        }
    });

    /**
     * GET /logout - Logout convenience route (legacy)
     * 
     * Destroys session and redirects to /access page.
     * Convenience route for logout links.
     * 
     * @route GET /logout
     * @public
     * 
     * @param {ExpressRequest} req - Express request object
     * @param {Express.Response} res - Express response object
     * @returns {void} Redirects to /access
     * 
     * @example
     * // Request: GET /logout
     * // Response: Redirect to /access
     */
    app.get('/logout', (req, res) => {
        const cookieName = process.env.SESSION_COOKIE_NAME || 'sessionId';
        if (req.session) {
            req.session.destroy(() => {
                res.clearCookie(cookieName);
                return res.redirect('/access');
            });
        } else {
            return res.redirect('/access');
        }
    });

    /**
     * GET /t/:tenantSlug/logout - Tenant-scoped logout route
     * 
     * Destroys session and redirects to /access page.
     * Tenant-scoped variant of logout route.
     * 
     * @route GET /t/:tenantSlug/logout
     * @middleware tenantLoader
     * @public
     * 
     * @param {ExpressRequest} req - Express request object
     * @param {ExpressRequest.params} req.params - URL parameters
     * @param {string} req.params.tenantSlug - Tenant slug from URL
     * @param {Express.Response} res - Express response object
     * @returns {void} Redirects to /access
     * 
     * @example
     * // Request: GET /t/my-tenant/logout
     * // Response: Redirect to /access
     */
    app.get('/t/:tenantSlug/logout', tenantLoader, (req, res) => {
        const cookieName = process.env.SESSION_COOKIE_NAME || 'sessionId';
        if (req.session) {
            req.session.destroy(() => {
                res.clearCookie(cookieName);
                return res.redirect('/access');
            });
        } else {
            return res.redirect('/access');
        }
    });
}

// Export helper functions for use in other routes
module.exports = { 
    setupAuthRoutes,
    toSlug,
    logAction,
    cleanupOldLogs,
    verifyPassword,
    hashPassword
};

