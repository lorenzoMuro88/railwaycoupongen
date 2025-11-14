'use strict';

const path = require('path');
const bcrypt = require('bcrypt');
const { getDb } = require('../utils/db');
const { checkLoginRateLimit, recordLoginFailure, recordLoginSuccess } = require('../middleware/rateLimit');
const logger = require('../utils/logger');
const { tenantLoader } = require('../middleware/tenant');

const DEFAULT_TENANT_SLUG = process.env.DEFAULT_TENANT_SLUG || 'default';

/**
 * Helper function to convert string to slug
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
 * Logging utility function
 */
async function logAction(req, actionType, actionDescription, level = 'info', details = null) {
    try {
        const db = await getDb();
        const user = req.session?.user;
        const tenant = req.tenant;
        
        await db.run(`
            INSERT INTO system_logs (
                user_id, username, user_type, tenant_id, tenant_name, tenant_slug,
                action_type, action_description, level, details, ip_address, user_agent
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            user?.id || null,
            user?.username || 'Sistema',
            user?.userType || 'system',
            tenant?.id || user?.tenantId || null,
            tenant?.name || null,
            tenant?.slug || user?.tenantSlug || null,
            actionType,
            actionDescription,
            level,
            details ? JSON.stringify(details) : null,
            req.ip || req.connection?.remoteAddress || null,
            req.get('User-Agent') || null
        ]);
    } catch (error) {
        logger.warn({ err: error }, 'Failed to log action to database');
        // Don't throw error to avoid breaking the main flow
    }
}

/**
 * Secure password hashing using bcrypt with backward compatibility for Base64 hashes
 */
async function verifyPassword(password, hash) {
    // If hash looks like bcrypt (starts with $2a$, $2b$, or $2y$), use bcrypt
    if (hash && (hash.startsWith('$2a$') || hash.startsWith('$2b$') || hash.startsWith('$2y$'))) {
        return await bcrypt.compare(password, hash);
    }
    // Legacy Base64 hashing for backward compatibility
    return Buffer.from(password).toString('base64') === hash;
}

async function hashPassword(password) {
    // Use bcrypt with cost factor 10 (good balance between security and performance)
    const saltRounds = 10;
    return await bcrypt.hash(password, saltRounds);
}

/**
 * Setup auth routes
 */
function setupAuthRoutes(app) {
    // Public pages
    app.get('/access', (req, res) => {
        res.sendFile(path.join(__dirname, '..', 'views', 'access.html'));
    });

    app.get('/signup', (req, res) => {
        res.sendFile(path.join(__dirname, '..', 'views', 'signup.html'));
    });

    app.get('/login', (req, res) => {
        // If already logged in, redirect to appropriate page
        if (req.session && req.session.user) {
            const base = req.session.user.tenantSlug ? `/t/${req.session.user.tenantSlug}` : '';
            if (req.session.user.userType === 'admin') return res.redirect(base + '/admin');
            if (req.session.user.userType === 'store') return res.redirect(base + '/store');
        }
        res.sendFile(path.join(__dirname, '..', 'views', 'login.html'));
    });

    // Login API endpoint
    app.post('/api/login', async (req, res) => {
        try {
            const { username, password, userType } = req.body;
            const ip = req.ip || req.connection?.remoteAddress || 'unknown';
            const rate = checkLoginRateLimit(ip);
            if (!rate.ok) {
                return res.status(429).json({ error: 'Troppi tentativi. Riprova più tardi.' });
            }
            
            if (!username || !password || !userType) {
                return res.status(400).json({ error: 'Username, password e tipo utente sono richiesti' });
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

    // Tenant provisioning: create tenant + first admin user, then login
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

    // Logout API endpoint
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
                res.clearCookie('connect.sid');
                res.json({ success: true, message: 'Logout effettuato con successo' });
            });
        } else {
            res.json({ success: true, message: 'Logout effettuato con successo' });
        }
    });

    // GET convenience routes that redirect to /access
    app.get('/logout', (req, res) => {
        if (req.session) {
            req.session.destroy(() => {
                res.clearCookie('connect.sid');
                return res.redirect('/access');
            });
        } else {
            return res.redirect('/access');
        }
    });

    app.get('/t/:tenantSlug/logout', tenantLoader, (req, res) => {
        if (req.session) {
            req.session.destroy(() => {
                res.clearCookie('connect.sid');
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
    verifyPassword,
    hashPassword
};

