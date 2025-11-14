'use strict';

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const QRCode = require('qrcode');
const nodemailer = require('nodemailer');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
// Mailgun SDK
const formData = require('form-data');
const Mailgun = require('mailgun.js');
// Logger
const logger = require('./utils/logger');
function generateId(length = 12) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const bytes = crypto.randomBytes(length);
    let out = '';
    for (let i = 0; i < length; i++) {
        out += alphabet[bytes[i] % alphabet.length];
    }
    return out;
}

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy for HTTPS detection (when behind Nginx/load balancer)
app.set('trust proxy', 1);
const DEFAULT_TENANT_SLUG = process.env.DEFAULT_TENANT_SLUG || 'default';
const DEFAULT_TENANT_NAME = process.env.DEFAULT_TENANT_NAME || 'Default Tenant';
const ENFORCE_TENANT_PREFIX = String(process.env.ENFORCE_TENANT_PREFIX || 'false') === 'true';
const csrf = require('csurf');

// CSRF protection setup (session-based for better compatibility with JavaScript POST requests)
// Session-based CSRF stores token in session instead of cookie, which works better with sameSite restrictions
const csrfProtection = csrf({
    cookie: false  // Use session-based CSRF instead of cookie-based
});

// Apply CSRF only to authenticated mutating routes
function csrfIfProtectedRoute(req, res, next) {
    const method = req.method.toUpperCase();
    // Skip CSRF for read-only requests
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();
    
    const url = req.path || '';
    
    // Exclude login endpoints from CSRF (client doesn't have token yet)
    // After login, they'll get token and subsequent requests will be protected
    const csrfExemptPaths = [
        '/api/login',
        '/api/superadmin/login',
        '/api/signup',
        '/submit',
        '/t/:tenantSlug/submit'
    ];
    
    // Check if this is an exempt path (exact match or pattern match)
    const isExempt = csrfExemptPaths.some(exempt => {
        if (exempt.includes(':')) {
            // Pattern match for tenant-scoped routes
            const exemptPattern = exempt.replace(/:\w+/g, '[^/]+');
            const regex = new RegExp('^' + exemptPattern.replace(/\//g, '\\/') + '$');
            return regex.test(url);
        }
        return url === exempt || url.startsWith(exempt + '/');
    });
    
    if (isExempt) {
        return next();
    }
    
    // Apply CSRF to protected endpoints
    const protectedPrefixes = [
        '/api/admin',
        '/api/store',
        '/api/superadmin'
    ];
    const isTenantScoped = url.startsWith('/t/') && url.includes('/api/');
    const isProtected = protectedPrefixes.some(p => url.startsWith(p));
    
    if (isProtected || isTenantScoped) {
        // Log CSRF token info for debugging
        const csrfTokenHeader = req.headers['x-csrf-token'];
        const hasSession = req.session && req.session.id;
        console.log(`[CSRF] ${req.method} ${url} - Token in header: ${csrfTokenHeader ? csrfTokenHeader.substring(0, 20) + '...' : 'missing'}, Session: ${hasSession ? 'yes' : 'no'}`);
        return csrfProtection(req, res, next);
    }
    
    return next();
}

app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: '15mb' }));
app.use(cookieParser());

// Middleware per gestire errori di parsing JSON
app.use((error, req, res, next) => {
    if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
        logger.warn({ err: error, message: error.message }, 'JSON parsing error in request body');
        return res.status(400).json({ success: false, message: 'JSON non valido' });
    }
    next();
});

// Serve uploads from configurable directory (served via protected endpoint, not public static)
const UPLOADS_BASE_DIR = process.env.UPLOADS_DIR
    ? path.resolve(process.env.UPLOADS_DIR)
    : path.join(__dirname, 'static', 'uploads');
if (!fs.existsSync(UPLOADS_BASE_DIR)) {
    fs.mkdirSync(UPLOADS_BASE_DIR, { recursive: true });
}
// Uploads are served via /api/uploads/:tenantSlug/:filename endpoint below

// Serve static files with cache control
const staticOptions = {
    setHeaders: (res, filePath) => {
        // Disable cache for CSS and JS in development to see changes immediately
        if (filePath.endsWith('.css') || filePath.endsWith('.js')) {
            res.setHeader('Cache-Control', 'no-cache, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
        }
    }
};
app.use('/static', express.static(path.join(__dirname, 'static'), staticOptions));

// Public signup page
app.get('/access', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'access.html'));
});

app.get('/signup', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'signup.html'));
});

// Super admin page will be defined after session middleware

// Request ID and basic structured logging
app.use((req, res, next) => {
    req.requestId = generateId(10);
    const startedAt = Date.now();
    res.on('finish', () => {
        const durationMs = Date.now() - startedAt;
        const tenantPart = req.tenant ? req.tenant.slug : (req.session?.user?.tenantSlug || '-');
        console.log(JSON.stringify({
            level: 'info',
            msg: 'request',
            requestId: req.requestId,
            method: req.method,
            path: req.originalUrl,
            status: res.statusCode,
            durationMs,
            tenant: tenantPart
        }));
    });
    next();
});

// Simple in-memory login rate limiter (per IP)
const loginAttempts = new Map(); // key: ip, value: { count, first, lockedUntil }
const LOGIN_WINDOW_MS = Number(process.env.LOGIN_WINDOW_MS || 10 * 60 * 1000); // 10 min
const LOGIN_MAX_ATTEMPTS = Number(process.env.LOGIN_MAX_ATTEMPTS || 10);
const LOGIN_LOCK_MS = Number(process.env.LOGIN_LOCK_MS || 30 * 60 * 1000); // 30 min
function checkLoginRateLimit(ip) {
    const now = Date.now();
    let entry = loginAttempts.get(ip);
    if (!entry) {
        entry = { count: 0, first: now, lockedUntil: 0 };
        loginAttempts.set(ip, entry);
    }
    if (entry.lockedUntil && now < entry.lockedUntil) {
        return { ok: false, retryAfterMs: entry.lockedUntil - now };
    }
    if (now - entry.first > LOGIN_WINDOW_MS) {
        entry.count = 0; entry.first = now; entry.lockedUntil = 0;
    }
    return { ok: true };
}
function recordLoginFailure(ip) {
    const now = Date.now();
    const entry = loginAttempts.get(ip) || { count: 0, first: now, lockedUntil: 0 };
    entry.count += 1;
    if (entry.count >= LOGIN_MAX_ATTEMPTS) {
        entry.lockedUntil = now + LOGIN_LOCK_MS;
    }
    loginAttempts.set(ip, entry);
}
function recordLoginSuccess(ip) {
    loginAttempts.delete(ip);
}

// Submit rate limiting (per IP + per Email)
const submitAttemptsByIp = new Map(); // key: ip, value: { count, first, lockedUntil }
const submitAttemptsByEmail = new Map(); // key: emailKey, value: { count, first, lockedUntil }

const SUBMIT_WINDOW_MS = Number(process.env.SUBMIT_WINDOW_MS || 10 * 60 * 1000); // 10 min
const SUBMIT_MAX_PER_IP = Number(process.env.SUBMIT_MAX_PER_IP || 20); // per window
const SUBMIT_LOCK_MS = Number(process.env.SUBMIT_LOCK_MS || 30 * 60 * 1000); // 30 min

const EMAIL_DAILY_WINDOW_MS = Number(process.env.EMAIL_DAILY_WINDOW_MS || 24 * 60 * 60 * 1000); // 24h
const EMAIL_MAX_PER_DAY = Number(process.env.EMAIL_MAX_PER_DAY || 3);
const EMAIL_LOCK_MS = Number(process.env.EMAIL_LOCK_MS || 24 * 60 * 60 * 1000);

function normalizeEmailForKey(email) {
    return String(email || '').trim().toLowerCase();
}

function getEmailKey(email, tenantId) {
    const base = normalizeEmailForKey(email);
    return typeof tenantId === 'number' ? `${tenantId}:${base}` : base;
}

function checkIpSubmitLimit(ip) {
    const now = Date.now();
    let entry = submitAttemptsByIp.get(ip);
    if (!entry) {
        entry = { count: 0, first: now, lockedUntil: 0 };
        submitAttemptsByIp.set(ip, entry);
    }
    if (entry.lockedUntil && now < entry.lockedUntil) {
        return { ok: false, retryAfterMs: entry.lockedUntil - now };
    }
    if (now - entry.first > SUBMIT_WINDOW_MS) {
        entry.count = 0; entry.first = now; entry.lockedUntil = 0;
    }
    return { ok: true };
}

function recordIpSubmit(ip) {
    const now = Date.now();
    const entry = submitAttemptsByIp.get(ip) || { count: 0, first: now, lockedUntil: 0 };
    entry.count += 1;
    if (entry.count >= SUBMIT_MAX_PER_IP) {
        entry.lockedUntil = now + SUBMIT_LOCK_MS;
    }
    submitAttemptsByIp.set(ip, entry);
}

function checkEmailDailyLimit(emailKey) {
    const now = Date.now();
    let entry = submitAttemptsByEmail.get(emailKey);
    if (!entry) {
        entry = { count: 0, first: now, lockedUntil: 0 };
        submitAttemptsByEmail.set(emailKey, entry);
    }
    if (entry.lockedUntil && now < entry.lockedUntil) {
        return { ok: false, retryAfterMs: entry.lockedUntil - now };
    }
    if (now - entry.first > EMAIL_DAILY_WINDOW_MS) {
        entry.count = 0; entry.first = now; entry.lockedUntil = 0;
    }
    if (entry.count >= EMAIL_MAX_PER_DAY) {
        return { ok: false, retryAfterMs: (entry.first + EMAIL_DAILY_WINDOW_MS) - now };
    }
    return { ok: true };
}

function recordEmailSubmit(emailKey) {
    const now = Date.now();
    const entry = submitAttemptsByEmail.get(emailKey) || { count: 0, first: now, lockedUntil: 0 };
    entry.count += 1;
    if (entry.count >= EMAIL_MAX_PER_DAY) {
        entry.lockedUntil = Math.max(entry.lockedUntil, entry.first + EMAIL_LOCK_MS);
    }
    submitAttemptsByEmail.set(emailKey, entry);
}

// Cleanup expired entries from rate limiter Maps to prevent memory leaks
function cleanupRateLimiters() {
    const now = Date.now();
    let cleaned = 0;
    
    // Clean login attempts: remove entries that are unlocked and past window
    for (const [ip, entry] of loginAttempts.entries()) {
        if (!entry.lockedUntil && (now - entry.first > LOGIN_WINDOW_MS * 2)) {
            loginAttempts.delete(ip);
            cleaned++;
        } else if (entry.lockedUntil && (now > entry.lockedUntil + LOGIN_LOCK_MS)) {
            // Remove entries that have been locked but lock expired
            loginAttempts.delete(ip);
            cleaned++;
        }
    }
    
    // Clean submit attempts by IP: remove entries past window
    for (const [ip, entry] of submitAttemptsByIp.entries()) {
        if (!entry.lockedUntil && (now - entry.first > SUBMIT_WINDOW_MS * 2)) {
            submitAttemptsByIp.delete(ip);
            cleaned++;
        } else if (entry.lockedUntil && (now > entry.lockedUntil + SUBMIT_LOCK_MS)) {
            submitAttemptsByIp.delete(ip);
            cleaned++;
        }
    }
    
    // Clean submit attempts by email: remove entries past daily window
    for (const [emailKey, entry] of submitAttemptsByEmail.entries()) {
        if (!entry.lockedUntil && (now - entry.first > EMAIL_DAILY_WINDOW_MS * 2)) {
            submitAttemptsByEmail.delete(emailKey);
            cleaned++;
        } else if (entry.lockedUntil && (now > entry.lockedUntil + EMAIL_LOCK_MS)) {
            submitAttemptsByEmail.delete(emailKey);
            cleaned++;
        }
    }
    
    if (cleaned > 0) {
        console.log(`[rate-limiter] Cleaned ${cleaned} expired entries`);
    }
}

// Run cleanup every 5 minutes to prevent memory leaks
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const cleanupInterval = setInterval(cleanupRateLimiters, CLEANUP_INTERVAL_MS);
// Cleanup on shutdown
process.on('SIGTERM', () => clearInterval(cleanupInterval));
process.on('SIGINT', () => clearInterval(cleanupInterval));

function checkSubmitRateLimit(req, res, next) {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const email = req.body?.email;
    const tenantId = req.tenant?.id ?? req.session?.user?.tenantId;

    // Per-IP windowed limit
    const ipCheck = checkIpSubmitLimit(ip);
    if (!ipCheck.ok) {
        return res.status(429).send('Troppi invii da questo IP. Riprova più tardi.');
    }

    // Per-email daily limit
    const emailKey = getEmailKey(email, tenantId);
    const emailCheck = checkEmailDailyLimit(emailKey);
    if (!emailCheck.ok) {
        return res.status(429).send('Hai raggiunto il numero massimo di richieste per questa email.');
    }

    // Record immediately to mitigate bursts; we can roll back later if needed
    recordIpSubmit(ip);
    recordEmailSubmit(emailKey);
    next();
}

// reCAPTCHA verification (Invisible v2 or v3)
const RECAPTCHA_ENABLED = String(process.env.RECAPTCHA_ENABLED || 'false') === 'true';
const RECAPTCHA_SECRET = process.env.RECAPTCHA_SECRET || '';
const RECAPTCHA_SITE_KEY = process.env.RECAPTCHA_SITE_KEY || '';

async function verifyRecaptchaToken(token, remoteIp) {
    if (!token) return { ok: false, reason: 'missing-token' };
    const params = new URLSearchParams();
    params.append('secret', RECAPTCHA_SECRET);
    params.append('response', token);
    if (remoteIp) params.append('remoteip', remoteIp);
    try {
        const resp = await fetch('https://www.google.com/recaptcha/api/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString()
        });
        const data = await resp.json();
        if (data.success) {
            return { ok: true };
        }
        return { ok: false, reason: data['error-codes']?.join(',') || 'verify-failed' };
    } catch (e) {
        logger.warn({ err: e }, 'reCAPTCHA verify error');
        return { ok: false, reason: 'verify-exception' };
    }
}

async function verifyRecaptchaIfEnabled(req, res, next) {
    if (!RECAPTCHA_ENABLED) return next();
    const token = req.body['g-recaptcha-response'] || req.body['recaptchaToken'];
    const ip = req.ip || req.connection?.remoteAddress || undefined;
    if (!RECAPTCHA_SECRET) {
        logger.warn('RECAPTCHA_ENABLED=true but RECAPTCHA_SECRET is empty');
        return res.status(500).send('Configurazione reCAPTCHA mancante');
    }
    const result = await verifyRecaptchaToken(token, ip);
    if (!result.ok) {
        return res.status(400).send('Verifica reCAPTCHA fallita');
    }
    next();
}

// Public config for frontend (exposes only safe keys)
app.get('/api/public-config', (req, res) => {
    res.json({
        recaptchaEnabled: RECAPTCHA_ENABLED,
        recaptchaSiteKey: RECAPTCHA_SITE_KEY || null
    });
});

// Tenant loader (read-only for M1): resolves :tenantSlug to req.tenant
async function tenantLoader(req, res, next) {
    try {
        const { tenantSlug } = req.params;
        console.log('[TENANT-LOADER] Loading tenant:', tenantSlug, 'for path:', req.path);
        const dbConn = await getDb();
        await ensureTenantEmailColumns(dbConn);
        await ensureFormCustomizationTenantId(dbConn);
        await ensureTenantScopedUniqueConstraints(dbConn);
        const tenant = await dbConn.get('SELECT id, slug, name, custom_domain, email_from_name, email_from_address, mailgun_domain, mailgun_region FROM tenants WHERE slug = ?', tenantSlug);
        if (!tenant) {
            console.log('[TENANT-LOADER] Tenant not found:', tenantSlug);
            return res.status(404).send('Tenant non trovato');
        }
        req.tenant = tenant;
        req.tenantSlug = tenant.slug;
        console.log('[TENANT-LOADER] Tenant loaded successfully:', tenant.slug);
        // Simple visibility in logs
        const logContext = logger.withRequest(req);
        logContext.debug({ tenant: tenant.slug }, 'Tenant loaded for request');
        next();
    } catch (e) {
        console.error('[TENANT-LOADER] Error:', e);
        const logContext = logger.withRequest(req);
        logContext.error({ err: e, tenantSlug: req.params.tenantSlug }, 'tenantLoader error');
        res.status(500).send('Errore tenant');
    }
}

// Require that the logged-in user's tenant matches the tenant in path
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

// Generic role guard using session userType
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

// Session configuration (in-memory store; Redis optional for scaling/multi-instance)
// Generate secure random session secret if not provided
const generateSecureSecret = () => {
    return crypto.randomBytes(64).toString('hex');
};

let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret || sessionSecret === 'your-secret-key-change-in-production' || sessionSecret === 'coupon-gen-secret-key-change-in-production') {
    sessionSecret = generateSecureSecret();
    logger.warn({
        generated: true,
        secretPreview: sessionSecret.substring(0, 16) + '...'
    }, 'SECURITY WARNING: SESSION_SECRET not set or using default value. A random secret has been generated for this session only. MUST set SESSION_SECRET in .env for production!');
}

let sessionOptions = {
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: 'auto', // Automatically detect HTTPS
        httpOnly: true,
        sameSite: process.env.NODE_ENV === 'production' ? 'lax' : 'lax',
        maxAge: 24 * 60 * 60 * 1000,
        path: '/'
    }
};
app.use(session(sessionOptions));

// CSRF token endpoint (must be after session middleware but before CSRF protection)
// This endpoint needs CSRF middleware to generate token, but is itself exempt from protection
app.get(['/api/csrf-token','/t/:tenantSlug/api/csrf-token'], (req, res, next) => {
    // Apply csrfProtection just for this route to generate token
    csrfProtection(req, res, () => {
        try {
            const token = req.csrfToken ? req.csrfToken() : null;
            const hasSession = req.session && req.session.id;
            console.log(`[CSRF] GET /api/csrf-token - Token generated: ${token ? token.substring(0, 20) + '...' : 'null'}, Session: ${hasSession ? 'yes' : 'no'}`);
            if (!token) {
                return res.status(500).json({ error: 'Impossibile generare token CSRF' });
            }
            res.json({ csrfToken: token });
        } catch (error) {
            const logContext = logger.withRequest(req);
            logContext.error({ err: error }, 'CSRF token generation error');
            res.status(500).json({ error: 'Errore generazione token CSRF' });
        }
    });
});

// Attach CSRF middleware for protected routes (mutating authenticated endpoints)
app.use(csrfIfProtectedRoute);

// Super admin page will be defined before /admin middleware

// Ensure data directory exists (configurable for PaaS like Railway)
const DATA_DIR = process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
}

// Database setup
let db; // populated in init()
async function getDb() {
    if (db) return db;
    db = await open({
        filename: path.join(DATA_DIR, 'coupons.db'),
        driver: sqlite3.Database
    });
    
    // Configure database timeouts and performance settings
    await db.exec(`
        PRAGMA busy_timeout = 30000;  -- 30 seconds timeout for locked database
        PRAGMA journal_mode = WAL;    -- Write-Ahead Logging for better concurrency
        PRAGMA synchronous = NORMAL;  -- Balance between safety and performance
        PRAGMA cache_size = 10000;    -- Increase cache size for better performance
        PRAGMA temp_store = MEMORY;   -- Store temp tables in memory
    `);
    // First, create tables without foreign keys to avoid migration issues
    await db.exec(`
        PRAGMA foreign_keys = OFF;
        CREATE TABLE IF NOT EXISTS tenants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            slug TEXT NOT NULL UNIQUE,
            name TEXT,
            email_from_name TEXT DEFAULT 'CouponGen',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL,
            first_name TEXT,
            last_name TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            tenant_id INTEGER
        );
        CREATE TABLE IF NOT EXISTS campaigns (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            campaign_code TEXT NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            is_active BOOLEAN DEFAULT 0,
            discount_type TEXT NOT NULL DEFAULT 'percent',
            discount_value TEXT NOT NULL,
            form_config TEXT DEFAULT '{"email": {"visible": true, "required": true}, "firstName": {"visible": true, "required": true}, "lastName": {"visible": true, "required": true}, "phone": {"visible": false, "required": false}, "address": {"visible": false, "required": false}, "allergies": {"visible": false, "required": false}, "customFields": []}', -- JSON config for form fields
            expiry_date DATETIME, -- Data limite di utilizzo della campagna
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            tenant_id INTEGER
        );
        CREATE TABLE IF NOT EXISTS coupons (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL UNIQUE,
            user_id INTEGER NOT NULL,
            campaign_id INTEGER,
            discount_type TEXT NOT NULL DEFAULT 'percent',
            discount_value TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            issued_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            redeemed_at DATETIME,
            tenant_id INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code);
        CREATE TABLE IF NOT EXISTS user_custom_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            field_name TEXT NOT NULL,
            field_value TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            tenant_id INTEGER,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_user_custom_data_user_id ON user_custom_data(user_id);
        CREATE INDEX IF NOT EXISTS idx_user_custom_data_field_name ON user_custom_data(field_name);
        CREATE TABLE IF NOT EXISTS system_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            user_id INTEGER,
            username TEXT,
            user_type TEXT,
            tenant_id INTEGER,
            tenant_name TEXT,
            tenant_slug TEXT,
            action_type TEXT NOT NULL,
            action_description TEXT,
            level TEXT DEFAULT 'info',
            details TEXT,
            ip_address TEXT,
            user_agent TEXT,
            FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE SET NULL,
            FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_system_logs_timestamp ON system_logs(timestamp);
        CREATE INDEX IF NOT EXISTS idx_system_logs_user_id ON system_logs(user_id);
        CREATE INDEX IF NOT EXISTS idx_system_logs_tenant_id ON system_logs(tenant_id);
        CREATE INDEX IF NOT EXISTS idx_system_logs_action_type ON system_logs(action_type);
        CREATE INDEX IF NOT EXISTS idx_system_logs_level ON system_logs(level);
    `);
    
    // Migrate existing database
    try {
        logger.info({ version: '2025-10-mt-a2' }, 'Starting database migration');
        
        // Simple versioned migrations table
        await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
        const currentVersion = '2025-10-mt-a2';
        const hasVersion = await db.get('SELECT 1 FROM schema_migrations WHERE version = ?', currentVersion);

        // STEP 1: Create all base tables FIRST (before any ALTER statements)
        logger.debug('Creating base tables');
        
        // Create auth_users table if it doesn't exist
        const authUsersTable = await db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='auth_users'");
        if (authUsersTable.length === 0) {
            logger.debug('Creating auth_users table');
            await db.exec(`
                CREATE TABLE auth_users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL UNIQUE,
                    password_hash TEXT NOT NULL,
                    user_type TEXT NOT NULL CHECK (user_type IN ('superadmin', 'admin', 'store')),
                    is_active BOOLEAN DEFAULT 1,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    last_login DATETIME,
                    tenant_id INTEGER,
                    first_name TEXT,
                    last_name TEXT,
                    email TEXT
                );
            `);
        }

        // Create form_customization table if it doesn't exist
        const formCustomizationTable = await db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='form_customization'");
        if (formCustomizationTable.length === 0) {
            logger.debug('Creating form_customization table');
            await db.exec(`
                CREATE TABLE form_customization (
                    id INTEGER PRIMARY KEY,
                    tenant_id INTEGER,
                    config_data TEXT NOT NULL,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                );
            `);
            await db.exec(`CREATE INDEX IF NOT EXISTS idx_form_customization_tenant_id ON form_customization(tenant_id)`);
        }

        // Create products table if it doesn't exist
        const productsTable = await db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='products'");
        if (productsTable.length === 0) {
            logger.debug('Creating products table');
            await db.exec(`
                CREATE TABLE products (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    value REAL NOT NULL,
                    margin_price REAL NOT NULL,
                    sku TEXT UNIQUE,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    tenant_id INTEGER
                );
            `);
        } else {
            // Ensure products has tenant_id
            const productCols = await db.all("PRAGMA table_info(products)");
            const hasTenantOnProducts = productCols.some(c => c.name === 'tenant_id');
            if (!hasTenantOnProducts) {
                logger.debug('Adding tenant_id column to products');
                await db.exec('ALTER TABLE products ADD COLUMN tenant_id INTEGER');
                // Backfill tenant_id for existing products:
                // 1) If a product is associated to campaigns, inherit the campaign tenant
                await db.exec(`
                    UPDATE products
                    SET tenant_id = (
                        SELECT c.tenant_id
                        FROM campaign_products cp
                        JOIN campaigns c ON c.id = cp.campaign_id
                        WHERE cp.product_id = products.id
                        LIMIT 1
                    )
                    WHERE tenant_id IS NULL
                `);
                // 2) Fallback: set remaining NULLs to defaultTenantId if available
                if (defaultTenantId) {
                    await db.run('UPDATE products SET tenant_id = ? WHERE tenant_id IS NULL', defaultTenantId);
                }
                logger.debug('Backfill tenant_id on products completed');
            }
            // Ensure a trigger exists to prevent NULL tenant_id inserts/updates
            const triggerRows = await db.all("SELECT name FROM sqlite_master WHERE type='trigger' AND name IN ('trg_products_tenant_ins','trg_products_tenant_upd')");
            const triggerNames = triggerRows.map(r => r.name);
            if (!triggerNames.includes('trg_products_tenant_ins')) {
                await db.exec(`
                    CREATE TRIGGER trg_products_tenant_ins
                    BEFORE INSERT ON products
                    FOR EACH ROW
                    WHEN NEW.tenant_id IS NULL
                    BEGIN
                        SELECT RAISE(ABORT, 'tenant_id required for products');
                    END;
                `);
            }
            if (!triggerNames.includes('trg_products_tenant_upd')) {
                await db.exec(`
                    CREATE TRIGGER trg_products_tenant_upd
                    BEFORE UPDATE ON products
                    FOR EACH ROW
                    WHEN NEW.tenant_id IS NULL
                    BEGIN
                        SELECT RAISE(ABORT, 'tenant_id required for products');
                    END;
                `);
            }
        }

        // Create campaign_products table if it doesn't exist
        const campaignProductsTable = await db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='campaign_products'");
        if (campaignProductsTable.length === 0) {
            logger.debug('Creating campaign_products table');
            await db.exec(`
                CREATE TABLE campaign_products (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    campaign_id INTEGER NOT NULL,
                    product_id INTEGER NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE,
                    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
                    UNIQUE(campaign_id, product_id)
                );
            `);
        }

        // STEP 2: Ensure default tenant exists
        const existingDefaultTenant = await db.get('SELECT id FROM tenants WHERE slug = ?', DEFAULT_TENANT_SLUG);
        let defaultTenantId = existingDefaultTenant ? existingDefaultTenant.id : null;
        if (!defaultTenantId) {
            await db.run('INSERT INTO tenants (slug, name) VALUES (?, ?)', DEFAULT_TENANT_SLUG, DEFAULT_TENANT_NAME);
            const row = await db.get('SELECT id FROM tenants WHERE slug = ?', DEFAULT_TENANT_SLUG);
            defaultTenantId = row.id;
            console.log('Created default tenant with slug:', DEFAULT_TENANT_SLUG);
        }
        
        // Check if new columns exist in coupons table
        const columns = await db.all("PRAGMA table_info(coupons)");
        const columnNames = columns.map(col => col.name);
        
        if (!columnNames.includes('campaign_id')) {
            logger.debug('Adding campaign_id column to coupons...');
            await db.exec('ALTER TABLE coupons ADD COLUMN campaign_id INTEGER');
        }
        
        if (!columnNames.includes('discount_type')) {
            logger.debug('Adding discount_type column to coupons...');
            await db.exec("ALTER TABLE coupons ADD COLUMN discount_type TEXT DEFAULT 'percent'");
        }
        
        if (!columnNames.includes('discount_value')) {
            logger.debug('Adding discount_value column to coupons...');
            await db.exec("ALTER TABLE coupons ADD COLUMN discount_value TEXT DEFAULT '10'");
        }
        
        // Migrate existing discount_percent to discount_value
        const hasOldColumn = columnNames.includes('discount_percent');
        if (hasOldColumn) {
            console.log('Migrating discount_percent to discount_value...');
            await db.exec('UPDATE coupons SET discount_value = CAST(discount_percent AS TEXT) WHERE discount_value = "10"');
            console.log('Removing old discount_percent column...');
            // SQLite doesn't support DROP COLUMN directly, so we need to recreate the table
            await db.exec(`
                CREATE TABLE coupons_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    code TEXT NOT NULL UNIQUE,
                    user_id INTEGER NOT NULL,
                    campaign_id INTEGER,
                    discount_type TEXT NOT NULL DEFAULT 'percent',
                    discount_value TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'active',
                    issued_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    redeemed_at DATETIME
                );
                INSERT INTO coupons_new SELECT id, code, user_id, campaign_id, discount_type, discount_value, status, issued_at, redeemed_at FROM coupons;
                DROP TABLE coupons;
                ALTER TABLE coupons_new RENAME TO coupons;
            `);
        }
        
        // Create campaign index after adding the column
        await db.exec('CREATE INDEX IF NOT EXISTS idx_coupons_campaign ON coupons(campaign_id)');
        if (!columnNames.includes('tenant_id')) {
            logger.debug('Adding tenant_id column to coupons...');
            await db.exec('ALTER TABLE coupons ADD COLUMN tenant_id INTEGER');
        }
        
        // Check if campaign_code column exists in campaigns table
        const campaignColumns = await db.all("PRAGMA table_info(campaigns)");
        const campaignColumnNames = campaignColumns.map(col => col.name);
        
        if (!campaignColumnNames.includes('campaign_code')) {
            logger.debug('Adding campaign_code column to campaigns...');
            await db.exec(`ALTER TABLE campaigns ADD COLUMN campaign_code TEXT`);
            
            // Generate campaign codes for existing campaigns
            const existingCampaigns = await db.all('SELECT id FROM campaigns WHERE campaign_code IS NULL');
            console.log(`Found ${existingCampaigns.length} campaigns without campaign_code`);
            for (const campaign of existingCampaigns) {
                const campaignCode = generateId(12);
                await db.run('UPDATE campaigns SET campaign_code = ? WHERE id = ?', campaignCode, campaign.id);
                console.log(`Generated campaign_code ${campaignCode} for campaign ${campaign.id}`);
            }
            
            // Don't create global unique index - will be created as tenant-scoped by ensureTenantScopedUniqueConstraints
            // This ensures tenant isolation for campaign codes
        } else {
            console.log('campaign_code column already exists');
            
            // Check if there are campaigns without campaign_code
            const campaignsWithoutCode = await db.all('SELECT id FROM campaigns WHERE campaign_code IS NULL');
            if (campaignsWithoutCode.length > 0) {
                console.log(`Found ${campaignsWithoutCode.length} campaigns without campaign_code, generating codes...`);
                for (const campaign of campaignsWithoutCode) {
                    const campaignCode = generateId(12).toUpperCase();
                    await db.run('UPDATE campaigns SET campaign_code = ? WHERE id = ?', campaignCode, campaign.id);
                    console.log(`Generated campaign_code ${campaignCode} for campaign ${campaign.id}`);
                }
            }
        }
        
        // Check if form_config column exists in campaigns table
        if (!campaignColumnNames.includes('form_config')) {
            logger.debug('Adding form_config column to campaigns...');
            await db.exec(`ALTER TABLE campaigns ADD COLUMN form_config TEXT DEFAULT '{"email": {"visible": true, "required": true}, "firstName": {"visible": true, "required": true}, "lastName": {"visible": true, "required": true}}'`);
            
            // Set default form config for existing campaigns
            const existingCampaigns = await db.all('SELECT id FROM campaigns WHERE form_config IS NULL');
            for (const campaign of existingCampaigns) {
                await db.run('UPDATE campaigns SET form_config = ? WHERE id = ?', '{"email": {"visible": true, "required": true}, "firstName": {"visible": true, "required": true}, "lastName": {"visible": true, "required": true}}', campaign.id);
            }
        } else {
            // Migrate existing simple config to new structure
            const existingCampaigns = await db.all('SELECT id, form_config FROM campaigns WHERE form_config IS NOT NULL');
            for (const campaign of existingCampaigns) {
                try {
                    const currentConfig = JSON.parse(campaign.form_config);
                    // Check if it's the old format (simple boolean values)
                    if (typeof currentConfig.email === 'boolean') {
                        const newConfig = {
                            email: { visible: true, required: true },
                            firstName: { visible: currentConfig.firstName || false, required: currentConfig.firstName || false },
                            lastName: { visible: currentConfig.lastName || false, required: currentConfig.lastName || false },
                            phone: { visible: false, required: false },
                            address: { visible: false, required: false },
                            allergies: { visible: false, required: false },
                            customFields: []
                        };
                        await db.run('UPDATE campaigns SET form_config = ? WHERE id = ?', JSON.stringify(newConfig), campaign.id);
                        console.log(`Migrated form config for campaign ${campaign.id}`);
                    }
                } catch (e) {
                    console.log(`Skipping migration for campaign ${campaign.id}: ${e.message}`);
                }
            }
        }
        if (!campaignColumnNames.includes('tenant_id')) {
            logger.debug('Adding tenant_id column to campaigns...');
            await db.exec('ALTER TABLE campaigns ADD COLUMN tenant_id INTEGER');
        }
        
        // Check if expiry_date column exists in campaigns table
        if (!campaignColumnNames.includes('expiry_date')) {
            logger.debug('Adding expiry_date column to campaigns...');
            await db.exec('ALTER TABLE campaigns ADD COLUMN expiry_date DATETIME');
        }
        
        // Check if new columns exist in users table
        const userColumns = await db.all("PRAGMA table_info(users)");
        const userColumnNames = userColumns.map(col => col.name);
        
        if (!userColumnNames.includes('phone')) {
            logger.debug('Adding phone column to users...');
            await db.exec("ALTER TABLE users ADD COLUMN phone TEXT");
        }
        if (!userColumnNames.includes('address')) {
            logger.debug('Adding address column to users...');
            await db.exec("ALTER TABLE users ADD COLUMN address TEXT");
        }
        if (!userColumnNames.includes('allergies')) {
            logger.debug('Adding allergies column to users...');
            await db.exec("ALTER TABLE users ADD COLUMN allergies TEXT");
        }
        if (!userColumnNames.includes('tenant_id')) {
            logger.debug('Adding tenant_id column to users...');
            await db.exec('ALTER TABLE users ADD COLUMN tenant_id INTEGER');
        }
        
        // Check if user_custom_data table exists
        const customDataTable = await db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='user_custom_data'");
        if (customDataTable.length === 0) {
            logger.debug('Creating user_custom_data table');
            await db.exec(`
                CREATE TABLE user_custom_data (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    field_name TEXT NOT NULL,
                    field_value TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    tenant_id INTEGER,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_user_custom_data_user_id ON user_custom_data(user_id);
                CREATE INDEX IF NOT EXISTS idx_user_custom_data_field_name ON user_custom_data(field_name);
            `);
        } else {
            // Table exists, check if it has tenant_id column and add it if missing
            const userCustomDataCols = await db.all("PRAGMA table_info(user_custom_data)");
            const userCustomDataColNames = userCustomDataCols.map(c => c.name);
            if (!userCustomDataColNames.includes('tenant_id')) {
                logger.debug('Adding tenant_id column to user_custom_data table...');
                await db.exec('ALTER TABLE user_custom_data ADD COLUMN tenant_id INTEGER');
                // Set default tenant_id for existing records
                if (defaultTenantId) {
                    await db.run('UPDATE user_custom_data SET tenant_id = ? WHERE tenant_id IS NULL', defaultTenantId);
                }
            }
        }

        // Ensure auth_users table exists BEFORE attempting to alter it
        const hasAuthUsersTable = await db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='auth_users'");
        if (hasAuthUsersTable.length === 0) {
            logger.debug('Creating auth_users table (missing before alteration step)');
            await db.exec(`
                CREATE TABLE auth_users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL UNIQUE,
                    password_hash TEXT NOT NULL,
                    user_type TEXT NOT NULL CHECK (user_type IN ('superadmin', 'admin', 'store')),
                    is_active BOOLEAN DEFAULT 1,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    last_login DATETIME
                );
            `);
        }

        // auth_users table already created with all columns in STEP 1
        // Backfill tenant_id for existing rows to default tenant
        await db.run('UPDATE users SET tenant_id = COALESCE(tenant_id, ?) WHERE tenant_id IS NULL', defaultTenantId);
        await db.run('UPDATE campaigns SET tenant_id = COALESCE(tenant_id, ?) WHERE tenant_id IS NULL', defaultTenantId);
        await db.run('UPDATE coupons SET tenant_id = COALESCE(tenant_id, ?) WHERE tenant_id IS NULL', defaultTenantId);
        
        // Check if user_custom_data has tenant_id column before updating
        const userCustomDataCols = await db.all("PRAGMA table_info(user_custom_data)");
        const userCustomDataColNames = userCustomDataCols.map(c => c.name);
        if (userCustomDataColNames.includes('tenant_id')) {
            await db.run('UPDATE user_custom_data SET tenant_id = COALESCE(tenant_id, ?) WHERE tenant_id IS NULL', defaultTenantId);
        }
        
        await db.run('UPDATE auth_users SET tenant_id = COALESCE(tenant_id, ?) WHERE tenant_id IS NULL', defaultTenantId);

        // Indexes and unique constraints (via unique indexes in SQLite)
        await db.exec('CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id)');
        await db.exec('CREATE INDEX IF NOT EXISTS idx_campaigns_tenant ON campaigns(tenant_id)');
        await db.exec('CREATE INDEX IF NOT EXISTS idx_coupons_tenant ON coupons(tenant_id)');
        if (userCustomDataColNames.includes('tenant_id')) {
            await db.exec('CREATE INDEX IF NOT EXISTS idx_ucd_tenant ON user_custom_data(tenant_id)');
        }
        await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS ux_users_tenant_email ON users(tenant_id, email)');
        await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS ux_coupons_tenant_code ON coupons(tenant_id, code)');
        
        // Create email_template index only if tenant_id column exists
        const emailTemplateCols = await db.all("PRAGMA table_info(email_template)");
        const emailTemplateColNames = emailTemplateCols.map(c => c.name);
        if (emailTemplateColNames.includes('tenant_id')) {
            await db.exec('CREATE INDEX IF NOT EXISTS idx_email_template_tenant ON email_template(tenant_id)');
        }

        if (!hasVersion) {
            // Add email_from_name column to tenants table if it doesn't exist
            const tenantColumns = await db.all("PRAGMA table_info(tenants)");
            const hasEmailFromName = tenantColumns.some(col => col.name === 'email_from_name');
            if (!hasEmailFromName) {
                logger.debug('Adding email_from_name column to tenants table...');
                await db.exec('ALTER TABLE tenants ADD COLUMN email_from_name TEXT DEFAULT "CouponGen"');
            }
            
            await db.run('INSERT INTO schema_migrations(version) VALUES (?)', currentVersion);
        }

        // Auto-migration: Add per-tenant email fields if missing (backward compatibility)
        const tenantColumnsAll = await db.all("PRAGMA table_info(tenants)");
        const tenantColumnNames = tenantColumnsAll.map(c => c.name);
        
        if (!tenantColumnNames.includes('email_from_address')) {
            logger.debug('Adding email_from_address column to tenants table...');
            await db.exec('ALTER TABLE tenants ADD COLUMN email_from_address TEXT');
        }
        if (!tenantColumnNames.includes('mailgun_domain')) {
            logger.debug('Adding mailgun_domain column to tenants table...');
            await db.exec('ALTER TABLE tenants ADD COLUMN mailgun_domain TEXT');
        }
        if (!tenantColumnNames.includes('mailgun_region')) {
            logger.debug('Adding mailgun_region column to tenants table...');
            await db.exec('ALTER TABLE tenants ADD COLUMN mailgun_region TEXT');
        }
        if (!tenantColumnNames.includes('custom_domain')) {
            logger.debug('Adding custom_domain column to tenants table...');
            await db.exec('ALTER TABLE tenants ADD COLUMN custom_domain TEXT');
        }

        // Email template table (multitenant)
        const emailTemplateTable = await db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='email_template'");
        if (emailTemplateTable.length === 0) {
            logger.debug('Creating email_template table');
            await db.exec(`
                CREATE TABLE email_template (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    tenant_id INTEGER NOT NULL,
                    subject TEXT NOT NULL,
                    html TEXT NOT NULL,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
                );
            `);
        } else {
            // Check if tenant_id column exists, if not add it
            const emailTemplateCols = await db.all("PRAGMA table_info(email_template)");
            const emailTemplateColNames = emailTemplateCols.map(c => c.name);
            if (!emailTemplateColNames.includes('tenant_id')) {
                logger.debug('Adding tenant_id column to email_template...');
                await db.exec('ALTER TABLE email_template ADD COLUMN tenant_id INTEGER');
                // Migrate existing template to default tenant
                await db.run('UPDATE email_template SET tenant_id = ? WHERE tenant_id IS NULL', defaultTenantId);
            }
        }

        // Create tenant_brand_settings table if it doesn't exist
        const brandSettingsTable = await db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='tenant_brand_settings'");
        if (brandSettingsTable.length === 0) {
            logger.debug('Creating tenant_brand_settings table');
            await db.exec(`
                CREATE TABLE tenant_brand_settings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    tenant_id INTEGER NOT NULL UNIQUE,
                    primary_color TEXT DEFAULT '#2d5a3d',
                    accent_color TEXT DEFAULT '#4a7c59',
                    light_color TEXT DEFAULT '#e8f5e8',
                    background_color TEXT DEFAULT '#faf8f3',
                    text_dark_color TEXT DEFAULT '#2c3e50',
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
                );
            `);
        }

        
        // Create default users if auth_users table is empty
        const userCount = await db.get('SELECT COUNT(*) as count FROM auth_users');
        if (userCount.count === 0) {
            logger.debug('Creating default users');
            
            // Generate secure random passwords if not provided in environment
            const generateSecurePassword = (length = 16) => {
                const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
                const bytes = crypto.randomBytes(length);
                let password = '';
                for (let i = 0; i < length; i++) {
                    password += charset[bytes[i] % charset.length];
                }
                // Ensure at least one uppercase, lowercase, digit, and special char
                if (!/[a-z]/.test(password)) password = password.slice(0, -1) + 'a';
                if (!/[A-Z]/.test(password)) password = password.slice(0, -1) + 'A';
                if (!/\d/.test(password)) password = password.slice(0, -1) + '1';
                if (!/[!@#$%^&*]/.test(password)) password = password.slice(0, -1) + '!';
                return password;
            };
            
            const defaultSuperAdminPassword = process.env.SUPERADMIN_PASSWORD || generateSecurePassword(20);
            const defaultStorePassword = process.env.STORE_PASSWORD || generateSecurePassword(20);
            
            // Security warning if using generated passwords
            if (!process.env.SUPERADMIN_PASSWORD || !process.env.STORE_PASSWORD) {
                logger.warn('SECURITY WARNING: SUPERADMIN_PASSWORD and/or STORE_PASSWORD not set in .env! Random secure passwords have been generated for initial setup. Set SUPERADMIN_PASSWORD and STORE_PASSWORD in .env file for production! Generated passwords are NOT logged for security reasons.');
            }
            
            // Secure password hashing using bcrypt
            const superAdminHash = await hashPassword(defaultSuperAdminPassword);
            const storeHash = await hashPassword(defaultStorePassword);
            
            await db.run(`
                INSERT INTO auth_users (username, password_hash, user_type, tenant_id) 
                VALUES ('admin', ?, 'superadmin', ?), ('store', ?, 'store', ?)
            `, superAdminHash, defaultTenantId, storeHash, defaultTenantId);
            
            logger.info({ 
                superAdmin: 'admin',
                store: 'store',
                passwordsFromEnv: !!(process.env.SUPERADMIN_PASSWORD && process.env.STORE_PASSWORD)
            }, 'Default users created');
            
            if (!process.env.SUPERADMIN_PASSWORD || !process.env.STORE_PASSWORD) {
                logger.warn('IMPORTANT: Configure SUPERADMIN_PASSWORD and STORE_PASSWORD in .env file! Contact system administrator to retrieve initial passwords if needed.');
            } else {
                logger.info('Passwords loaded from environment variables');
            }
        }
        
        // Re-enable foreign keys after migration
        await db.exec('PRAGMA foreign_keys = ON');
        
        // Ensure tenant-scoped unique constraints (remove global indexes, create tenant-scoped ones)
        await ensureTenantScopedUniqueConstraints(db);
        
        // Migration: Remove UNIQUE constraint from campaigns.name in table definition
        // SQLite doesn't support ALTER TABLE to remove UNIQUE constraints, so we need to recreate the table
        try {
            const tableInfo = await db.all("SELECT sql FROM sqlite_master WHERE type='table' AND name='campaigns'");
            const tableSql = tableInfo.length > 0 ? (tableInfo[0].sql || '') : '';
            logger.debug({ tableSql: tableSql.substring(0, 300) }, 'Checking campaigns table definition for UNIQUE constraint on name');
            
            // Check if there's a UNIQUE constraint on name
            // Look for patterns like "name TEXT NOT NULL UNIQUE" or "name TEXT UNIQUE" but not "name, tenant_id" UNIQUE
            const upperSql = tableSql.toUpperCase();
            
            // More specific check: look for "name TEXT NOT NULL UNIQUE" or "name TEXT UNIQUE" pattern
            // This pattern indicates a UNIQUE constraint directly on the name column
            const hasExplicitUniqueOnName = upperSql.match(/NAME\s+TEXT\s+(NOT\s+NULL\s+)?UNIQUE/) !== null;
            
            // Also check if there's a UNIQUE constraint on name that's not tenant-scoped
            // We look for the pattern where name has UNIQUE but it's not part of a composite index with tenant_id
            // The regex checks for "name" followed by "UNIQUE" without "tenant_id" in between
            const hasGlobalUniqueOnName = hasExplicitUniqueOnName || 
                                         (upperSql.includes('NAME') && 
                                          upperSql.includes('UNIQUE') &&
                                          !upperSql.match(/NAME.*TENANT_ID.*UNIQUE|UNIQUE.*TENANT_ID.*NAME/));
            
            const shouldMigrate = hasGlobalUniqueOnName;
            
            logger.info({ hasGlobalUniqueOnName, hasExplicitUniqueOnName, shouldMigrate, tableInfoLength: tableInfo.length, hasSql: !!tableInfo[0]?.sql, tableSql: tableSql.substring(0, 200) }, 'UNIQUE constraint check result');
            
            if (tableInfo.length > 0 && tableInfo[0].sql && shouldMigrate) {
                logger.info('Removing UNIQUE constraint from campaigns.name by recreating table');
                
                // Create new table without UNIQUE on name
                await db.exec(`
                    CREATE TABLE campaigns_new (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        campaign_code TEXT NOT NULL,
                        name TEXT NOT NULL,
                        description TEXT,
                        is_active BOOLEAN DEFAULT 0,
                        discount_type TEXT NOT NULL DEFAULT 'percent',
                        discount_value TEXT NOT NULL,
                        form_config TEXT DEFAULT '{"email": {"visible": true, "required": true}, "firstName": {"visible": true, "required": true}, "lastName": {"visible": true, "required": true}, "phone": {"visible": false, "required": false}, "address": {"visible": false, "required": false}, "allergies": {"visible": false, "required": false}, "customFields": []}',
                        expiry_date DATETIME,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        tenant_id INTEGER
                    )
                `);
                
                // Copy data from old table to new table
                await db.exec(`
                    INSERT INTO campaigns_new (id, campaign_code, name, description, is_active, discount_type, discount_value, form_config, expiry_date, created_at, tenant_id)
                    SELECT id, campaign_code, name, description, is_active, discount_type, discount_value, form_config, expiry_date, created_at, tenant_id
                    FROM campaigns
                `);
                
                // Drop old table
                await db.exec('DROP TABLE campaigns');
                
                // Rename new table
                await db.exec('ALTER TABLE campaigns_new RENAME TO campaigns');
                
                // Recreate indexes
                await db.exec('CREATE INDEX IF NOT EXISTS idx_campaigns_tenant ON campaigns(tenant_id)');
                await ensureTenantScopedUniqueConstraints(db);
                
                logger.info('Successfully removed UNIQUE constraint from campaigns.name');
            }
        } catch (e) {
            logger.error({ err: e }, 'Error removing UNIQUE constraint from campaigns.name');
            // Don't fail the migration if this fails - it might already be fixed
        }
        
        logger.info({ version: currentVersion }, 'Database migration completed successfully');
        
        // Create some initial sample logs for testing
        try {
            const sampleLogs = await db.all('SELECT COUNT(*) as count FROM system_logs');
            if (sampleLogs[0].count === 0) {
                logger.debug('Creating sample logs for testing');
                await db.run(`
                    INSERT INTO system_logs (username, user_type, action_type, action_description, level, details, timestamp) VALUES
                    ('Sistema', 'system', 'create', 'Sistema avviato', 'info', '{"message": "Sistema CouponGen avviato correttamente"}', datetime('now', '-1 hour')),
                    ('admin', 'superadmin', 'login', 'Login SuperAdmin effettuato', 'success', '{"username": "admin", "userType": "superadmin"}', datetime('now', '-30 minutes')),
                    ('Sistema', 'system', 'create', 'Database inizializzato', 'info', '{"tables": ["tenants", "users", "campaigns", "coupons", "system_logs"]}', datetime('now', '-15 minutes'))
                `);
                logger.debug('Sample logs created');
            }
        } catch (error) {
            logger.warn({ err: error }, 'Error creating sample logs');
        }
    } catch (migrationError) {
        logger.error({ err: migrationError, version: currentVersion }, 'Database migration error');
        // Re-enable foreign keys even if migration fails
        await db.exec('PRAGMA foreign_keys = ON');
    }
    return db;
}

function parseMailFrom(value) {
    if (!value) return { name: null, address: null };
    const trimmed = String(value).trim();
    if (!trimmed) return { name: null, address: null };
    const match = trimmed.match(/^(.*)<([^>]+)>\s*$/);
    if (match) {
        const name = match[1].trim().replace(/^"|"$/g, '');
        return {
            name: name || null,
            address: match[2].trim()
        };
    }
    return { name: null, address: trimmed };
}

async function ensureTenantEmailColumns(dbConn) {
    if (!dbConn) return;
    const columns = await dbConn.all("PRAGMA table_info(tenants)");
    const columnNames = new Set(columns.map(c => c.name));
    const ensureColumn = async (name, ddl) => {
        if (!columnNames.has(name)) {
            console.log(`[schema] Adding ${name} column to tenants table...`);
            await dbConn.exec(ddl);
            columnNames.add(name);
        }
    };

    await ensureColumn('custom_domain', 'ALTER TABLE tenants ADD COLUMN custom_domain TEXT');
    await ensureColumn('email_from_name', 'ALTER TABLE tenants ADD COLUMN email_from_name TEXT');
    await ensureColumn('email_from_address', 'ALTER TABLE tenants ADD COLUMN email_from_address TEXT');
    await ensureColumn('mailgun_domain', 'ALTER TABLE tenants ADD COLUMN mailgun_domain TEXT');
    await ensureColumn('mailgun_region', 'ALTER TABLE tenants ADD COLUMN mailgun_region TEXT');

    const defaultFromEnv = process.env.MAIL_FROM || process.env.MAILGUN_FROM || 'CouponGen <no-reply@send.coupongen.it>';
    const parsed = parseMailFrom(defaultFromEnv);

    if (columnNames.has('email_from_name')) {
        const fallbackName = parsed.name || DEFAULT_TENANT_NAME || 'CouponGen';
        await dbConn.run('UPDATE tenants SET email_from_name = COALESCE(email_from_name, ?)', fallbackName);
    }
    if (columnNames.has('email_from_address') && parsed.address) {
        await dbConn.run('UPDATE tenants SET email_from_address = COALESCE(email_from_address, ?)', parsed.address);
    }
    if (columnNames.has('mailgun_domain') && process.env.MAILGUN_DOMAIN) {
        await dbConn.run('UPDATE tenants SET mailgun_domain = COALESCE(mailgun_domain, ?)', process.env.MAILGUN_DOMAIN);
    }
    if (columnNames.has('mailgun_region') && process.env.MAILGUN_REGION) {
        await dbConn.run('UPDATE tenants SET mailgun_region = COALESCE(mailgun_region, ?)', process.env.MAILGUN_REGION);
    }
}

async function ensureFormCustomizationTenantId(dbConn) {
    if (!dbConn) return;
    try {
        const columns = await dbConn.all("PRAGMA table_info(form_customization)");
        const columnNames = new Set(columns.map(c => c.name));
        
        if (!columnNames.has('tenant_id')) {
            console.log('[schema] Adding tenant_id column to form_customization table...');
            await dbConn.exec('ALTER TABLE form_customization ADD COLUMN tenant_id INTEGER');
            await dbConn.exec('CREATE INDEX IF NOT EXISTS idx_form_customization_tenant_id ON form_customization(tenant_id)');
            
            // Migrate existing data: assign to default tenant if exists
            const defaultTenant = await dbConn.get('SELECT id FROM tenants WHERE slug = ?', DEFAULT_TENANT_SLUG);
            if (defaultTenant) {
                await dbConn.run('UPDATE form_customization SET tenant_id = ? WHERE tenant_id IS NULL', defaultTenant.id);
            }
        }
    } catch (e) {
        // Table might not exist yet, that's ok
        if (!e.message.includes('no such table')) {
            console.error('Error ensuring form_customization tenant_id:', e);
        }
    }
}

async function ensureTenantScopedUniqueConstraints(dbConn) {
    if (!dbConn) return;
    try {
        // Get all indexes with their SQL definitions to check for UNIQUE constraints
        const indexes = await dbConn.all("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='campaigns'");
        const indexNames = new Set(indexes.map(idx => idx.name));
        
        logger.debug({ indexes: indexes.map(idx => ({ name: idx.name, sql: idx.sql })) }, 'Current indexes on campaigns table');
        
        // Remove old global unique indexes if they exist
        // Check both by name and by SQL definition
        for (const idx of indexes) {
            const sql = (idx.sql || '').toUpperCase();
            const isUnique = sql.includes('UNIQUE');
            const isGlobal = !idx.name.includes('tenant') && !idx.name.includes('_tenant');
            
            // Remove global unique indexes on campaign_code
            if (idx.name === 'idx_campaigns_code' || (isUnique && isGlobal && sql.includes('CAMPAIGN_CODE'))) {
                logger.info(`Removing global unique index on campaign_code: ${idx.name}`);
                await dbConn.exec(`DROP INDEX IF EXISTS ${idx.name}`);
                indexNames.delete(idx.name);
            }
            
            // Remove global unique indexes on name
            if (isUnique && isGlobal && (sql.includes('NAME') || idx.name.includes('name'))) {
                logger.info(`Removing global unique index on name: ${idx.name} (SQL: ${idx.sql})`);
                await dbConn.exec(`DROP INDEX IF EXISTS ${idx.name}`);
                indexNames.delete(idx.name);
            }
        }
        
        // Also check for any UNIQUE constraint in table definition (though SQLite doesn't support dropping these easily)
        // We'll rely on indexes being tenant-scoped
        
        // Create tenant-scoped unique indexes
        if (!indexNames.has('idx_campaigns_code_tenant')) {
            logger.info('Creating tenant-scoped unique index on campaigns(campaign_code, tenant_id)');
            await dbConn.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_campaigns_code_tenant ON campaigns(campaign_code, tenant_id)');
        } else {
            logger.debug('Tenant-scoped unique index on campaign_code already exists');
        }
        
        // Remove unique constraint on name to allow duplicate names per tenant
        // Campaigns are identified by id and campaign_code, not by name
        if (indexNames.has('idx_campaigns_name_tenant')) {
            logger.info('Removing unique constraint on campaigns(name, tenant_id) to allow duplicate names');
            await dbConn.exec('DROP INDEX IF EXISTS idx_campaigns_name_tenant');
            indexNames.delete('idx_campaigns_name_tenant');
        }
        
        // Create non-unique index on name for performance (if it doesn't exist)
        if (!indexNames.has('idx_campaigns_name_tenant_nonunique')) {
            logger.info('Creating non-unique index on campaigns(name, tenant_id) for query performance');
            await dbConn.exec('CREATE INDEX IF NOT EXISTS idx_campaigns_name_tenant_nonunique ON campaigns(name, tenant_id)');
        }
        
        // Verify final state
        const finalIndexes = await dbConn.all("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='campaigns'");
        logger.debug({ finalIndexes: finalIndexes.map(idx => ({ name: idx.name, sql: idx.sql })) }, 'Final indexes on campaigns table');
    } catch (e) {
        logger.error({ err: e }, 'Error ensuring tenant-scoped unique constraints');
    }
}

// Helper: resolve tenantId for API requests even when not tenant-prefixed
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

// Email transport
function buildTransport() {
    // Prefer Mailgun when configured
    if ((process.env.MAIL_PROVIDER || '').toLowerCase() === 'mailgun' && process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN) {
        const mailgun = new Mailgun(formData);
        const mg = mailgun.client({
            username: 'api',
            key: process.env.MAILGUN_API_KEY,
            url: (process.env.MAILGUN_REGION || 'eu') === 'us' ? 'https://api.mailgun.net' : 'https://api.eu.mailgun.net',
            timeout: 30000  // 30 seconds timeout for Mailgun API calls
        });
        // Wrap Mailgun client in a Nodemailer-like interface used below
        return {
            async sendMail(message) {
                // Build Mailgun message
                const data = {
                    from: message.from || (process.env.MAILGUN_FROM || 'CouponGen <no-reply@send.coupongen.it>'),
                    to: message.to,
                    subject: message.subject || 'Il tuo coupon',
                    html: message.html,
                };
                // Attachments (QR inline)
                if (Array.isArray(message.attachments) && message.attachments.length > 0) {
                    // Separate inline and regular attachments
                    const regularAttachments = message.attachments.filter(a => !a.cid);
                    const inlineAttachments = message.attachments.filter(a => a.cid);
                    
                    if (regularAttachments.length > 0) {
                        data.attachment = regularAttachments.map(att => ({
                            filename: att.filename,
                            data: att.content,
                            knownLength: att.content?.length
                        }));
                    }
                    
                    if (inlineAttachments.length > 0) {
                        // Mailgun inline attachments: CID must match filename (without extension)
                        // For filename "coupon-qr.png", use cid:coupon-qr in HTML
                        data.inline = inlineAttachments.map(att => {
                            const filename = att.filename;
                            // Mailgun uses filename without extension as CID reference
                            // So "coupon-qr.png" becomes cid:coupon-qr
                            return {
                                filename: filename,
                                data: att.content,
                                contentType: 'image/png',
                                knownLength: att.content?.length
                            };
                        });
                    }
                }
                // Tracking options
                if (process.env.MAILGUN_TRACKING === 'false') {
                    data['o:tracking'] = 'no';
                    data['o:tracking-clicks'] = 'no';
                    data['o:tracking-opens'] = 'no';
                }
                if (process.env.MAILGUN_REPLY_TO) {
                    data['h:Reply-To'] = process.env.MAILGUN_REPLY_TO;
                }
                const domain = message.mailgunDomain || process.env.MAILGUN_DOMAIN;
                
                // Add timeout wrapper for Mailgun API call
                const timeoutPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Mailgun API timeout')), 30000)
                );
                
                try {
                    const result = await Promise.race([
                        mg.messages.create(domain, data),
                        timeoutPromise
                    ]);
                    logger.info({ messageId: result.id, domain, to: message.to }, 'Mailgun message sent successfully');
                    return { id: result.id };
                } catch (err) {
                    logger.error({
                        err,
                        message: err.message,
                        status: err.status,
                        details: err.details || err.body || 'No details',
                        domain: domain,
                        to: message.to
                    }, 'Mailgun API error');
                    throw err; // Re-throw per permettere gestione errori a monte
                }
            },
            options: { provider: 'mailgun' }
        };
    }
    // If using Ethereal (dev) or SMTP credentials
    if (process.env.SMTP_HOST) {
        return nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT || 587),
            secure: process.env.SMTP_SECURE === 'true',
            auth: process.env.SMTP_USER ? {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            } : undefined,
            // Add timeout configurations for SMTP
            connectionTimeout: 30000,  // 30 seconds to establish connection
            greetingTimeout: 30000,    // 30 seconds for SMTP greeting
            socketTimeout: 30000,      // 30 seconds for socket operations
            pool: true,                // Enable connection pooling
            maxConnections: 5,         // Max concurrent connections
            maxMessages: 100,          // Max messages per connection
            rateDelta: 20000,          // Rate limiting: 1 message per 20 seconds
            rateLimit: 5               // Max 5 messages per rateDelta
        });
    }
    // Fallback to JSON transport (logs emails to console)
    return nodemailer.createTransport({ jsonTransport: true });
}

const transporter = buildTransport();

// Startup visibility: log which email transport is active
try {
    const transportLabel =
        (transporter && transporter.options && transporter.options.provider)
            || (transporter && transporter.options && transporter.options.jsonTransport ? 'json' : null)
            || (transporter && transporter.options && transporter.options.host ? `smtp:${transporter.options.host}` : 'unknown');
    logger.info({ transport: transportLabel }, 'Email transport configured');
} catch (_) {}

// Utilities
function toSlug(input) {
    return String(input || '')
        .toLowerCase()
        .normalize('NFD').replace(/\p{Diacritic}/gu, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64) || 'tenant';
}

// Per-tenant email helpers
function buildTenantEmailFrom(tenant) {
    const displayName = (tenant && tenant.email_from_name) || 'CouponGen';
    if (tenant && tenant.email_from_address) {
        return `${displayName} <${tenant.email_from_address}>`;
    }
    // If tenant has Mailgun custom domain, use no-reply@ that domain
    if (tenant && tenant.mailgun_domain) {
        return `${displayName} <no-reply@${tenant.mailgun_domain.replace(/^mg\./, '')}>`;
    }
    // Fallback to global sender
    const globalFrom = process.env.MAIL_FROM || process.env.MAILGUN_FROM || 'CouponGen <no-reply@send.coupongen.it>';
    // Replace display name while preserving address
    const addrMatch = globalFrom.match(/<([^>]+)>/);
    const address = addrMatch ? addrMatch[1] : 'no-reply@send.coupongen.it';
    return `${displayName} <${address}>`;
}

function getTenantMailgunDomain(tenant) {
    if (tenant && tenant.mailgun_domain) return tenant.mailgun_domain;
    return process.env.MAILGUN_DOMAIN;
}

// Logging utility function
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

// Authentication middleware
function requireAuth(req, res, next) {
    if (req.session && req.session.user) {
        return next();
    } else {
        return res.redirect('/login');
    }
}

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

// Helper function to redirect legacy routes to tenant-aware routes
async function redirectToTenantAwareRoute(req, res, path) {
    try {
        if (!req.session || !req.session.user) {
            return res.status(403).send('Accesso negato. Tenant non valido.');
        }
        
        const dbConn = await getDb();
        let tenant;
        
        // SuperAdmin can access without tenantId - redirect to first available tenant or use default
        if (req.session.user.userType === 'superadmin' && !req.session.user.tenantId) {
            // Try to get first tenant or use default tenant slug
            tenant = await dbConn.get('SELECT slug FROM tenants ORDER BY id ASC LIMIT 1');
            if (!tenant) {
                // No tenants available, but SuperAdmin can still access - use default slug
                const DEFAULT_TENANT_SLUG = process.env.DEFAULT_TENANT_SLUG || 'default';
                const queryString = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
                return res.redirect(302, `/t/${DEFAULT_TENANT_SLUG}${path}${queryString}`);
            }
        } else {
            // Regular admin: must have tenantId
            if (!req.session.user.tenantId) {
                return res.status(403).send('Accesso negato. Tenant non valido.');
            }
            tenant = await dbConn.get('SELECT slug FROM tenants WHERE id = ?', req.session.user.tenantId);
        }
        
        if (!tenant || !tenant.slug) {
            return res.status(403).send('Accesso negato. Tenant non trovato.');
        }
        
        // Preserve query string if present
        const queryString = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
        // Use 302 redirect to ensure URL changes visibly in browser
        return res.redirect(302, `/t/${tenant.slug}${path}${queryString}`);
    } catch (error) {
        console.error(`Error redirecting ${req.path}:`, error);
        return res.status(500).send('Errore nel reindirizzamento.');
    }
}

// Super admin middleware
function requireSuperAdmin(req, res, next) {
    if (req.session && req.session.user && req.session.user.userType === 'superadmin') {
        return next();
    }
    return res.status(403).send('Accesso negato. Richiesto ruolo SuperAdmin.');
}

// Super admin page already defined above

function requireStore(req, res, next) {
    if (req.session && req.session.user && (req.session.user.userType === 'store' || req.session.user.userType === 'admin' || req.session.user.userType === 'superadmin')) {
        return next();
    } else {
        return res.status(403).send('Accesso negato. Richiesto ruolo Store.');
    }
}

// Secure password hashing using bcrypt with backward compatibility for Base64 hashes
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

// Helper function to check if a user is the first admin of their tenant
async function isFirstAdmin(dbConn, userId, tenantId) {
    const firstAdmin = await dbConn.get(
        'SELECT id FROM auth_users WHERE tenant_id = ? AND user_type = ? ORDER BY created_at ASC LIMIT 1',
        tenantId, 'admin'
    );
    return firstAdmin && firstAdmin.id === parseInt(userId);
}

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
                console.error('Error upgrading password hash:', upgradeError);
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
            logger.warn({ userId: user.id, username }, 'Session regeneration failed during login');
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
            logger.warn({ userId: user.id, username }, 'Failed to log login action to database');
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
        console.error('Signup error', e);
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
                console.error('Logout error:', err);
                return res.status(500).json({ error: 'Errore durante il logout' });
            }
            res.clearCookie('connect.sid');
            res.json({ success: true, message: 'Logout effettuato con successo' });
        });
    } else {
        res.json({ success: true, message: 'Logout effettuato con successo' });
    }
});

// Tenant-scoped logout API for convenience
app.post('/t/:tenantSlug/api/logout', tenantLoader, (req, res) => {
    if (req.session) {
        req.session.destroy((err) => {
            if (err) {
                console.error('Logout error:', err);
                return res.status(500).json({ error: 'Errore durante il logout' });
            }
            res.clearCookie('connect.sid');
            res.json({ success: true, message: 'Logout effettuato con successo' });
        });
    } else {
        res.json({ success: true, message: 'Logout effettuato con successo' });
    }
});

// Tenant info API - get current tenant information
app.get('/t/:tenantSlug/api/tenant-info', tenantLoader, requireSameTenantAsSession, (req, res) => {
    try {
        res.json({
            id: req.tenant.id,
            slug: req.tenant.slug,
            name: req.tenant.name
        });
    } catch (e) {
        console.error('Error getting tenant info:', e);
        res.status(500).json({ error: 'Errore server' });
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

// Login page
app.get('/login', (req, res) => {
    // If already logged in, redirect to appropriate page
    if (req.session && req.session.user) {
        const base = req.session.user.tenantSlug ? `/t/${req.session.user.tenantSlug}` : '';
        if (req.session.user.userType === 'admin') return res.redirect(base + '/admin');
        if (req.session.user.userType === 'store') return res.redirect(base + '/store');
    }
    res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

// Store login page
app.get('/store-login', (req, res) => {
    // If already logged in as store, redirect to store page
    if (req.session && req.session.user && req.session.user.userType === 'store') {
        const base = req.session.user.tenantSlug ? `/t/${req.session.user.tenantSlug}` : '';
        return res.redirect(base + '/store');
    }
    res.sendFile(path.join(__dirname, 'views', 'store-login.html'));
});

// Test email endpoint (admin protected)
app.get('/api/admin/test-email', requireAdmin, async (req, res) => {
    try {
        const to = req.query.to || process.env.MAIL_TEST_TO || 'test@example.com';
        
        // Load tenant (if any) to honor per-tenant sender/domain
        let tenant = null;
        if (req.session?.user?.tenantSlug) {
            try {
                const dbConn = await getDb();
                tenant = await dbConn.get('SELECT email_from_name, email_from_address, mailgun_domain, mailgun_region FROM tenants WHERE slug = ?', req.session.user.tenantSlug);
            } catch (e) {
                logger.warn({ err: e, tenantSlug: req.session?.user?.tenantSlug }, 'Error getting tenant for test email');
            }
        }

        const senderName = (tenant && tenant.email_from_name) || 'CouponGen';
        const html = `<p>Test email da ${senderName} - Mailgun integrazione da CouponGen.</p>`;
        const message = {
            from: buildTenantEmailFrom(tenant),
            to,
            subject: `Test Email - ${senderName}`,
            html,
            mailgunDomain: getTenantMailgunDomain(tenant)
        };
        const info = await transporter.sendMail(message);
        res.json({ ok: true, info });
    } catch (e) {
        const logContext = logger.withRequest(req);
        logContext.error({ err: e, to }, 'Test email error');
        res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
});

// Local-only: test coupon email with QR inline/allegato (no auth)
app.get('/api/test-coupon-email', async (req, res) => {
    try {
        if ((process.env.NODE_ENV || 'development') === 'production') {
            return res.status(403).json({ ok: false, error: 'Disabled in production' });
        }
        const to = req.query.to || process.env.MAIL_TEST_TO || 'test@example.com';
        const firstName = req.query.firstName || 'Lorenzo';
        const lastName = req.query.lastName || 'Muro';
        const couponCode = 'TEST' + Math.random().toString(36).slice(2, 8).toUpperCase();
        const discountText = 'uno sconto del 20%';
        const redemptionUrl = `${req.protocol}://${req.get('host')}/redeem/${couponCode}`;

        const qrDataUrl = await QRCode.toDataURL(redemptionUrl, { width: 300, margin: 2 });
        const qrPngBuffer = await QRCode.toBuffer(redemptionUrl, { width: 300, margin: 2, type: 'png' });

        // Basic sample template
        const templateHtml = `<p>Ciao {{firstName}} {{lastName}},</p>
            <p>Ecco il tuo coupon: <strong>{{code}}</strong> che vale {{discountText}}.</p>
            <p>Puoi usare questo link per la cassa: <a href="{{redemptionUrl}}">{{redemptionUrl}}</a></p>
            <div style="padding:16px; background:#f8f9fa; border-radius:10px; text-align:center;">
                <div style="font-weight:600; margin-bottom:8px;">Scansiona il QR Code</div>
                <img src="cid:coupon-qr" alt="QR Code" style="max-width: 220px; height: auto; border: 1px solid #e5e7eb; border-radius: 10px;" />
            </div>
            <p style="color:#666; font-size:12px;">Grazie per averci scelto</p>`;

        const html = templateHtml
            .replaceAll('{{firstName}}', firstName)
            .replaceAll('{{lastName}}', lastName)
            .replaceAll('{{code}}', couponCode)
            .replaceAll('{{discountText}}', discountText)
            .replaceAll('{{redemptionUrl}}', redemptionUrl)
            .replaceAll('{{qrDataUrl}}', 'cid:coupon-qr.png');

        const message = {
            from: process.env.MAIL_FROM || process.env.MAILGUN_FROM || 'CouponGen <no-reply@send.coupongen.it>',
            to,
            subject: 'Test Coupon – QR inline',
            html,
            attachments: [
                { filename: 'coupon-qr.png', content: qrPngBuffer, cid: 'coupon-qr.png' }
            ]
        };

        const info = await transporter.sendMail(message);
        res.json({ ok: true, info });
    } catch (e) {
        const logContext = logger.withRequest(req);
        logContext.error({ err: e }, 'Test coupon email error');
        res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
});

// Global: update email from name (for non-tenant mode)
app.put('/api/admin/email-from-name', requireAdmin, async (req, res) => {
    try {
        const { emailFromName } = req.body || {};
        if (!emailFromName || typeof emailFromName !== 'string' || emailFromName.trim().length === 0) {
            return res.status(400).json({ error: 'Nome mittente email richiesto' });
        }
        
        // Update the tenant's email_from_name if user has a tenant
        if (req.session && req.session.user && req.session.user.tenantSlug) {
            const dbConn = await getDb();
            await dbConn.run('UPDATE tenants SET email_from_name = ? WHERE slug = ?', emailFromName.trim(), req.session.user.tenantSlug);
            
            // Log the action
            await logAction(req, 'update', `Nome mittente email aggiornato: ${emailFromName.trim()}`, 'info');
        }
        
        res.json({ ok: true, emailFromName: emailFromName.trim() });
    } catch (e) {
        const logContext = logger.withRequest(req);
        logContext.error({ err: e }, 'Error updating email from name');
        res.status(500).json({ error: 'Errore server' });
    }
});

// Global: get current email from name (for non-tenant mode)
app.get('/api/admin/email-from-name', requireAdmin, async (req, res) => {
    try {
        let emailFromName = 'CouponGen';
        
        // Get the tenant's email_from_name if user has a tenant
        if (req.session && req.session.user && req.session.user.tenantSlug) {
            const dbConn = await getDb();
            const tenant = await dbConn.get('SELECT email_from_name FROM tenants WHERE slug = ?', req.session.user.tenantSlug);
            emailFromName = tenant?.email_from_name || 'CouponGen';
        }
        
        res.json({ emailFromName });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Tenant-scoped: test email with custom sender name
app.get('/t/:tenantSlug/api/admin/test-email', tenantLoader, requireSameTenantAsSession, requireRole('admin'), async (req, res) => {
    try {
        const to = req.query.to || process.env.MAIL_TEST_TO || 'test@example.com';
        
        // Get the custom sender name from the tenant
        const dbConn = await getDb();
        const tenant = await dbConn.get('SELECT email_from_name FROM tenants WHERE id = ?', req.tenant.id);
        const senderName = tenant?.email_from_name || 'CouponGen';
        
        const html = `<p>Test email da ${senderName} - Mailgun integrazione da CouponGen.</p>`;
        const message = {
            from: `${senderName} <no-reply@send.coupongen.it>`,
            to,
            subject: `Test Email - ${senderName}`,
            html
        };
        const info = await transporter.sendMail(message);
        res.json({ ok: true, info });
    } catch (e) {
        const logContext = logger.withRequest(req);
        logContext.error({ err: e, to }, 'Test email error');
        res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
});

// API per configurazione personalizzazione form
app.get('/api/admin/form-customization', requireAdmin, async (req, res) => {
    try {
        const dbConn = await getDb();
        await ensureFormCustomizationTenantId(dbConn);
        const tenantId = req.session.user.tenantId;
        if (!tenantId) {
            return res.status(400).json({ error: 'Tenant non valido' });
        }
        const config = await dbConn.get('SELECT * FROM form_customization WHERE tenant_id = ?', tenantId);
        if (config) {
            res.json(JSON.parse(config.config_data));
        } else {
            res.json({});
        }
    } catch (error) {
        console.error('Errore caricamento configurazione form:', error);
        res.status(500).json({ success: false, message: 'Errore durante il caricamento della configurazione' });
    }
});

// Email template APIs (admin) - multitenant
app.get('/api/admin/email-template', requireAdmin, async (req, res) => {
    try {
        const dbConn = await getDb();
        const tenantId = req.session.user.tenantId;
        const row = await dbConn.get('SELECT subject, html, updated_at FROM email_template WHERE tenant_id = ?', tenantId);
        if (!row) {
            return res.json({ subject: 'Il tuo coupon', html: '', updated_at: null });
        }
        res.json(row);
    } catch (e) {
        const logContext = logger.withRequest(req);
        logContext.error({ err: e }, 'Error getting email template');
        res.status(500).json({ error: 'Errore server' });
    }
});

app.post('/api/admin/email-template', requireAdmin, async (req, res) => {
    try {
        const { subject, html } = req.body || {};
        if (!subject || !html) {
            return res.status(400).json({ error: 'Subject e html sono richiesti' });
        }
        const dbConn = await getDb();
        const tenantId = req.session.user.tenantId;
        
        // Check if template exists for this tenant
        const existing = await dbConn.get('SELECT id FROM email_template WHERE tenant_id = ?', tenantId);
        
        if (existing) {
            // Update existing template
            await dbConn.run(
                'UPDATE email_template SET subject = ?, html = ?, updated_at = datetime("now") WHERE tenant_id = ?',
                subject, html, tenantId
            );
        } else {
            // Create new template for tenant
            await dbConn.run(
                'INSERT INTO email_template (tenant_id, subject, html, updated_at) VALUES (?, ?, ?, datetime("now"))',
                tenantId, subject, html
            );
        }
        
        res.json({ success: true });
    } catch (e) {
        console.error('Errore save email template:', e);
        res.status(500).json({ error: 'Errore server' });
    }
});

app.post('/api/admin/form-customization', requireAdmin, async (req, res) => {
    try {
        const dbConn = await getDb();
        await ensureFormCustomizationTenantId(dbConn);
        const tenantId = req.session.user.tenantId;
        if (!tenantId) {
            return res.status(400).json({ error: 'Tenant non valido' });
        }
        const configData = JSON.stringify(req.body);
        
        // Check if config exists for this tenant
        const existing = await dbConn.get('SELECT id FROM form_customization WHERE tenant_id = ?', tenantId);
        
        if (existing) {
            // Update existing configuration
            await dbConn.run(`
                UPDATE form_customization 
                SET config_data = ?, updated_at = datetime('now')
                WHERE tenant_id = ?
            `, configData, tenantId);
        } else {
            // Insert new configuration
            await dbConn.run(`
                INSERT INTO form_customization (tenant_id, config_data, updated_at) 
                VALUES (?, ?, datetime('now'))
            `, tenantId, configData);
        }
        
        res.json({ success: true, message: 'Configurazione salvata con successo!' });
    } catch (error) {
        console.error('Errore salvataggio configurazione form:', error);
        res.status(500).json({ success: false, message: 'Errore durante il salvataggio della configurazione' });
    }
});

// Simple image upload endpoint for admin (base64 data URL)
// Saves under static/uploads and returns a public URL
app.post('/api/admin/upload-image', requireAdmin, async (req, res) => {
    try {
        const { dataUrl } = req.body || {};
        if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
            return res.status(400).json({ error: 'dataUrl mancante o non valido' });
        }
        const match = dataUrl.match(/^data:(.*?);base64,(.*)$/);
        if (!match) return res.status(400).json({ error: 'Formato dataUrl non valido' });
        const mime = match[1];
        const base64 = match[2];
        // Whitelist mime types and size limit (~2MB)
        const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
        if (!allowed.includes(mime)) {
            return res.status(400).json({ error: 'Tipo file non consentito' });
        }
        const buffer = Buffer.from(base64, 'base64');
        if (buffer.length > (Number(process.env.UPLOAD_MAX_BYTES || 2 * 1024 * 1024))) {
            return res.status(400).json({ error: 'File troppo grande' });
        }
        const ext = mime.includes('png') ? 'png' : mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : mime.includes('webp') ? 'webp' : 'png';
        // Ensure uploads dir exists
        const tenantSlug = (req.session && req.session.user && req.session.user.tenantSlug) || DEFAULT_TENANT_SLUG;
        const uploadsDir = path.join(UPLOADS_BASE_DIR, tenantSlug);
        if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
        const filename = `header-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const filePath = path.join(uploadsDir, filename);
        fs.writeFileSync(filePath, buffer);
        // Use protected endpoint instead of public static
        const publicUrl = `/api/uploads/${tenantSlug}/${filename}`;
        res.json({ url: publicUrl });
    } catch (e) {
        console.error('Upload image error:', e);
        res.status(500).json({ error: 'Errore durante il caricamento immagine' });
    }
});

// Tenant-scoped admin upload
app.post('/t/:tenantSlug/api/admin/upload-image', tenantLoader, requireSameTenantAsSession, requireRole('admin'), async (req, res) => {
    try {
        const { dataUrl } = req.body || {};
        if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
            return res.status(400).json({ error: 'dataUrl mancante o non valido' });
        }
        const match = dataUrl.match(/^data:(.*?);base64,(.*)$/);
        if (!match) return res.status(400).json({ error: 'Formato dataUrl non valido' });
        const mime = match[1];
        const base64 = match[2];
        const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
        if (!allowed.includes(mime)) {
            return res.status(400).json({ error: 'Tipo file non consentito' });
        }
        const buffer = Buffer.from(base64, 'base64');
        if (buffer.length > (Number(process.env.UPLOAD_MAX_BYTES || 2 * 1024 * 1024))) {
            return res.status(400).json({ error: 'File troppo grande' });
        }
        const ext = mime.includes('png') ? 'png' : mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : mime.includes('webp') ? 'webp' : 'png';
        const uploadsDir = path.join(UPLOADS_BASE_DIR, req.tenant.slug);
        if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
        const filename = `header-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const filePath = path.join(uploadsDir, filename);
        fs.writeFileSync(filePath, buffer);
        // Use protected endpoint instead of public static
        const publicUrl = `/api/uploads/${req.tenant.slug}/${filename}`;
        res.json({ url: publicUrl });
    } catch (e) {
        console.error('Upload image error:', e);
        res.status(500).json({ error: 'Errore durante il caricamento immagine' });
    }
});

// Legacy redirect endpoint for backward compatibility with old /static/uploads URLs
app.get('/static/uploads/:tenantSlug/:filename', async (req, res) => {
    const { tenantSlug, filename } = req.params;
    // Redirect to protected endpoint
    res.redirect(301, `/api/uploads/${tenantSlug}/${filename}`);
});

// Protected upload serving endpoint (public but with tenant validation)
// Serves uploads with security checks: tenant validation and directory traversal prevention
app.get('/api/uploads/:tenantSlug/:filename', async (req, res) => {
    try {
        const { tenantSlug, filename } = req.params;
        
        // Validate tenant slug format (alphanumeric, dash, underscore)
        if (!/^[a-zA-Z0-9_-]+$/.test(tenantSlug)) {
            return res.status(400).json({ error: 'Tenant slug non valido' });
        }
        
        // Validate filename format and prevent directory traversal
        if (!/^[a-zA-Z0-9._-]+$/.test(filename) || filename.includes('..') || filename.startsWith('/')) {
            return res.status(400).json({ error: 'Nome file non valido' });
        }
        
        // Verify tenant exists
        const db = await getDb();
        const tenant = await db.get('SELECT id, slug FROM tenants WHERE slug = ?', tenantSlug);
        if (!tenant) {
            return res.status(404).json({ error: 'Tenant non trovato' });
        }
        
        // Build safe file path
        const filePath = path.join(UPLOADS_BASE_DIR, tenantSlug, filename);
        
        // Additional security: ensure file path is within uploads directory (prevent path traversal)
        const resolvedPath = path.resolve(filePath);
        const resolvedBase = path.resolve(UPLOADS_BASE_DIR);
        if (!resolvedPath.startsWith(resolvedBase)) {
            return res.status(403).json({ error: 'Accesso negato' });
        }
        
        // Check if file exists
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File non trovato' });
        }
        
        // Determine content type from extension
        const ext = path.extname(filename).toLowerCase();
        const mimeTypes = {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.webp': 'image/webp'
        };
        const contentType = mimeTypes[ext] || 'application/octet-stream';
        
        // Set headers for caching (1 day for images)
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=86400'); // 1 day
        res.setHeader('X-Content-Type-Options', 'nosniff');
        
        // Serve file
        res.sendFile(resolvedPath);
    } catch (error) {
        console.error('Error serving upload:', error);
        res.status(500).json({ error: 'Errore durante il servizio del file' });
    }
});

// Tenant-scoped version (same logic)
app.get('/t/:tenantSlug/api/uploads/:filename', tenantLoader, async (req, res) => {
    try {
        const { filename } = req.params;
        const tenantSlug = req.tenant?.slug || req.params.tenantSlug;
        
        // Validate filename format and prevent directory traversal
        if (!/^[a-zA-Z0-9._-]+$/.test(filename) || filename.includes('..') || filename.startsWith('/')) {
            return res.status(400).json({ error: 'Nome file non valido' });
        }
        
        // Build safe file path
        const filePath = path.join(UPLOADS_BASE_DIR, tenantSlug, filename);
        
        // Additional security: ensure file path is within uploads directory
        const resolvedPath = path.resolve(filePath);
        const resolvedBase = path.resolve(UPLOADS_BASE_DIR);
        if (!resolvedPath.startsWith(resolvedBase)) {
            return res.status(403).json({ error: 'Accesso negato' });
        }
        
        // Check if file exists
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File non trovato' });
        }
        
        // Determine content type from extension
        const ext = path.extname(filename).toLowerCase();
        const mimeTypes = {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.webp': 'image/webp'
        };
        const contentType = mimeTypes[ext] || 'application/octet-stream';
        
        // Set headers for caching (1 day for images)
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=86400'); // 1 day
        res.setHeader('X-Content-Type-Options', 'nosniff');
        
        // Serve file
        res.sendFile(resolvedPath);
    } catch (error) {
        console.error('Error serving upload:', error);
        res.status(500).json({ error: 'Errore durante il servizio del file' });
    }
});

// Tenant-scoped: API per configurazione form (pubblica)
app.get('/t/:tenantSlug/api/form-customization', tenantLoader, async (req, res) => {
    try {
        const dbConn = await getDb();
        await ensureFormCustomizationTenantId(dbConn);
        const tenantId = req.tenant.id;
        const config = await dbConn.get('SELECT * FROM form_customization WHERE tenant_id = ?', tenantId);
        if (config) {
            res.json(JSON.parse(config.config_data));
        } else {
            res.json({});
        }
    } catch (error) {
        console.error('Errore caricamento configurazione form:', error);
        res.json({});
    }
});

// Legacy: API per configurazione form (pubblica) - uses default tenant
app.get('/api/form-customization', async (req, res) => {
    try {
        const dbConn = await getDb();
        await ensureFormCustomizationTenantId(dbConn);
        // Use default tenant for legacy endpoint
        const defaultTenant = await dbConn.get('SELECT id FROM tenants WHERE slug = ?', DEFAULT_TENANT_SLUG);
        if (!defaultTenant) {
            return res.json({});
        }
        const config = await dbConn.get('SELECT * FROM form_customization WHERE tenant_id = ?', defaultTenant.id);
        if (config) {
            res.json(JSON.parse(config.config_data));
        } else {
            res.json({});
        }
    } catch (error) {
        console.error('Errore caricamento configurazione form:', error);
        res.json({});
    }
});

// Endpoint pubblico per salvare la configurazione del form (per la pagina di personalizzazione)
// DEPRECATED: This endpoint should not be used directly. Use tenant-scoped endpoint instead.
// Kept for backward compatibility but requires authentication or tenant context
app.post('/api/form-customization', requireAdmin, async (req, res) => {
    try {
        // Verifica che il body sia un oggetto valido
        if (!req.body || typeof req.body !== 'object') {
            console.error('Body non valido o vuoto');
            return res.status(400).json({ success: false, message: 'Body della richiesta non valido' });
        }
        
        const dbConn = await getDb();
        await ensureFormCustomizationTenantId(dbConn);
        const tenantId = req.session.user.tenantId;
        if (!tenantId) {
            return res.status(400).json({ error: 'Tenant non valido' });
        }
        
        const configData = JSON.stringify(req.body);
        console.log('Config data da salvare:', configData);
        
        // Check if config exists for this tenant
        const existing = await dbConn.get('SELECT id FROM form_customization WHERE tenant_id = ?', tenantId);
        
        if (existing) {
            // Update existing configuration
            await dbConn.run(`
                UPDATE form_customization 
                SET config_data = ?, updated_at = datetime('now')
                WHERE tenant_id = ?
            `, configData, tenantId);
        } else {
            // Insert new configuration
            await dbConn.run(`
                INSERT INTO form_customization (tenant_id, config_data, updated_at) 
                VALUES (?, ?, datetime('now'))
            `, tenantId, configData);
        }
        
        console.log('Configurazione salvata con successo (pubblico)');
        res.json({ success: true, message: 'Configurazione salvata con successo!' });
    } catch (error) {
        console.error('Errore salvataggio configurazione form:', error);
        res.status(500).json({ success: false, message: 'Errore durante il salvataggio della configurazione' });
    }
});

// Views
// Public form - support for campaign parameter
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});
// Tenant-prefixed read-only equivalents (M1)
app.get('/t/:tenantSlug', tenantLoader, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'index.html'));
});

app.get('/thanks', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'thanks.html'));
});
app.get('/t/:tenantSlug/thanks', tenantLoader, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'thanks.html'));
});

// DEPRECATED ENDPOINT REMOVED: /submit
// This legacy endpoint has been removed. Use /t/:tenantSlug/submit instead for proper tenant isolation.
// If you need backward compatibility, redirect to tenant-scoped endpoint:
app.post('/submit', (req, res) => {
    logger.warn({ path: req.path, ip: req.ip }, 'Deprecated endpoint /submit accessed - redirecting to tenant-scoped endpoint');
    // Try to infer tenant from referer or default
    const referer = req.get('referer') || '';
    const tenantMatch = referer.match(/\/t\/([^\/]+)/);
    const tenantSlug = tenantMatch ? tenantMatch[1] : (req.session?.user?.tenantSlug || DEFAULT_TENANT_SLUG);
    // Use 307 redirect to preserve POST method and body
    res.redirect(307, `/t/${tenantSlug}/submit`);
});

// Tenant-scoped form submission (RECOMMENDED)
app.post('/t/:tenantSlug/submit', tenantLoader, checkSubmitRateLimit, verifyRecaptchaIfEnabled, async (req, res) => {
    try {
        const { email, firstName, lastName, campaign_id, ...customFields } = req.body;
        if (!email) {
            return res.status(400).send('Email richiesta');
        }
        const couponCode = generateId(12);

        const dbConn = await getDb();
        
        let discountType = 'percent';
        let discountValue = process.env.DEFAULT_DISCOUNT_PERCENT || '10';
        let campaignId = null;
        let specificCampaign = null;
        
        // Check if specific campaign is requested
        if (campaign_id) {
            // Resolve campaign by code (use tenant from campaign to scope user/coupon)
            specificCampaign = await dbConn.get('SELECT * FROM campaigns WHERE campaign_code = ?', campaign_id);
            if (specificCampaign) {
                // Check if campaign is active and not expired
                if (!specificCampaign.is_active) {
                    return res.status(400).send('Questo coupon non esiste o è scaduto');
                }
                
                // Check if campaign has expired
                if (specificCampaign.expiry_date && new Date(specificCampaign.expiry_date) < new Date()) {
                    // Auto-deactivate expired campaign
                    await dbConn.run('UPDATE campaigns SET is_active = 0 WHERE id = ?', specificCampaign.id);
                    return res.status(400).send('Questo coupon non esiste o è scaduto');
                }
                
                discountType = specificCampaign.discount_type;
                discountValue = specificCampaign.discount_value;
                campaignId = specificCampaign.id;
            } else {
                return res.status(400).send('Questo coupon non esiste o è scaduto');
            }
        } else {
            return res.status(400).send('Questo coupon non esiste o è scaduto');
        }

        // Users MUST be tenant-scoped by campaign tenant
        const user = await dbConn.get('SELECT * FROM users WHERE email = ? AND tenant_id = ?', email, specificCampaign.tenant_id);
        let userId;
        if (user) {
            userId = user.id;
        } else {
            const result = await dbConn.run(
                'INSERT INTO users (email, first_name, last_name, tenant_id) VALUES (?, ?, ?, ?)',
                email, firstName || null, lastName || null, specificCampaign.tenant_id
            );
            userId = result.lastID;
        }

        // Save custom fields
        const formConfig = JSON.parse(specificCampaign.form_config);
        if (formConfig.customFields && formConfig.customFields.length > 0) {
            for (const customField of formConfig.customFields) {
                const fieldValue = customFields[customField.id];
                if (fieldValue !== undefined && fieldValue !== '') {
                    await dbConn.run(
                        'INSERT INTO user_custom_data (user_id, field_name, field_value, tenant_id) VALUES (?, ?, ?, ?)',
                        userId, customField.id, fieldValue, specificCampaign.tenant_id
                    );
                }
            }
        }

        await dbConn.run(
            'INSERT INTO coupons (code, user_id, campaign_id, discount_type, discount_value, status, tenant_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
            couponCode, userId, campaignId, discountType, discountValue, 'active', specificCampaign.tenant_id
        );

        // Redemption URL per staff cassa; il QR deve puntare a questa pagina
        const redemptionUrl = `${req.protocol}://${req.get('host')}/redeem/${couponCode}`;
        // Generate QR both as DataURL (for web preview) and as PNG buffer for email inline attachment
        const qrDataUrl = await QRCode.toDataURL(redemptionUrl, { width: 300, margin: 2 });
        const qrPngBuffer = await QRCode.toBuffer(redemptionUrl, { width: 300, margin: 2, type: 'png' });

        const discountText = discountType === 'percent' ? `uno sconto del ${discountValue}%` : 
                            discountType === 'fixed' ? `uno sconto di &euro;${discountValue}` : discountValue;
        // Load email template (multitenant)
        let templateSubject = process.env.MAIL_SUBJECT || 'Il tuo coupon';
        let templateHtml = '';
        try {
            const tenantId = specificCampaign.tenant_id || req.tenant?.id || req.session?.user?.tenantId;
            if (tenantId) {
                const t = await dbConn.get('SELECT subject, html FROM email_template WHERE tenant_id = ?', tenantId);
                if (t) { templateSubject = t.subject || templateSubject; templateHtml = t.html || templateHtml; }
            }
        } catch (e) { /* ignore, fallback below */ }

        // Fallback template if DB empty
        if (!templateHtml) {
            templateHtml = `<p>Ciao {{firstName}} {{lastName}},</p>
            <p>Ecco il tuo coupon: <strong>{{code}}</strong> che vale {{discountText}}.</p>
            <p>Mostra questo codice in negozio. Puoi anche usare questo link per la cassa: <a href="{{redemptionUrl}}">{{redemptionUrl}}</a></p>
            <p><img src="cid:coupon-qr" alt="QR Code" style="max-width: 200px; height: auto;" /></p>
            <p>Grazie!</p>`;
        }

        // Replace {{qrDataUrl}} with cid:coupon-qr for inline attachment (before other replacements)
        // Mailgun uses filename without extension as CID reference
        const htmlTemplate = templateHtml.replaceAll('{{qrDataUrl}}', 'cid:coupon-qr.png');
        
        const html = htmlTemplate
            .replaceAll('{{firstName}}', firstName || '')
            .replaceAll('{{lastName}}', lastName || '')
            .replaceAll('{{code}}', couponCode)
            .replaceAll('{{discountText}}', discountText)
            .replaceAll('{{redemptionUrl}}', redemptionUrl);

        const message = {
            from: buildTenantEmailFrom(req.tenant),
            to: email,
            subject: templateSubject,
            html,
            // Only one inline attachment referenced via CID
            attachments: [
                { filename: 'coupon-qr.png', content: qrPngBuffer, cid: 'coupon-qr.png' }
            ],
            mailgunDomain: getTenantMailgunDomain(req.tenant)
        };

        try {
            const info = await transporter.sendMail(message);
            if (transporter.options.jsonTransport) {
                logger.debug({ message: info.message }, 'Email simulated (dev mode)');
            } else {
                logger.info({ messageId: info.id, to: email }, 'Coupon email sent successfully');
            }
        } catch (emailErr) {
            logger.error({
                err: emailErr,
                message: emailErr?.message || 'Unknown error',
                status: emailErr?.status,
                details: emailErr?.details || emailErr?.body,
                to: email
            }, 'Error sending coupon email');
            // Continue without failing the request
        }

        res.redirect('/thanks');
    } catch (err) {
        const logContext = logger.withRequest(req);
        logContext.error({ err, stack: err.stack }, 'Error in legacy submit endpoint');
        res.status(500).send('Errore durante la creazione del coupon');
    }
});

// Tenant-scoped form submission (M3) - already defined above at line 2414

// Legacy protected areas (kept for now)
app.use('/store', requireAuth);
app.use('/api/store', requireStore);
app.use('/admin', requireAuth);
app.use('/api/admin', requireAdmin);

// Super admin login page
app.get('/superadmin-login', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'superadmin-login.html'));
});

// Super admin page (defined after /admin middleware to avoid conflicts)
app.get('/superadmin', (req, res) => {
    // Check if user is logged in and is superadmin
    if (!req.session || !req.session.user) {
        return res.redirect('/superadmin-login');
    }
    if (req.session.user.userType !== 'superadmin') {
        return res.status(403).send('Accesso negato. Richiesto ruolo SuperAdmin.');
    }
    res.sendFile(path.join(__dirname, 'views', 'superadmin.html'));
});

app.get('/superadmin/logs', (req, res) => {
    // Check if user is logged in and is superadmin
    if (!req.session || !req.session.user) {
        return res.redirect('/superadmin-login');
    }
    if (req.session.user.userType !== 'superadmin') {
        return res.status(403).send('Accesso negato. Richiesto ruolo SuperAdmin.');
    }
    res.sendFile(path.join(__dirname, 'views', 'logs.html'));
});

// Tenant-aware auth-users routes (moved to after campaigns route - see line 3232)

// Tenant-scoped protected areas (soft-enforce in M2)
app.use('/t/:tenantSlug/admin', tenantLoader, requireSameTenantAsSession, requireRole('admin'));
app.use('/t/:tenantSlug/api/admin', tenantLoader, requireSameTenantAsSession, requireRole('admin'));
app.use('/t/:tenantSlug/store', tenantLoader, requireSameTenantAsSession, requireRole('store'));
app.use('/t/:tenantSlug/api/store', tenantLoader, requireSameTenantAsSession, requireRole('store'));

app.get('/store', requireStore, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'store.html'));
});
app.get('/t/:tenantSlug/store', tenantLoader, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'store.html'));
});

// Lookup coupon status (for store UI)
app.get('/api/coupons/:code', async (req, res) => {
    try {
        const dbConn = await getDb();
        const coupon = await dbConn.get(`
            SELECT c.*, camp.name AS campaignName 
            FROM coupons c 
            LEFT JOIN campaigns camp ON camp.id = c.campaign_id 
            WHERE c.code = ?
        `, req.params.code);
        if (!coupon) return res.status(404).json({ error: 'Non trovato' });
        res.json({ 
            code: coupon.code, 
            status: coupon.status, 
            discountType: coupon.discount_type,
            discountValue: coupon.discount_value,
            campaignName: coupon.campaignName
        });
    } catch (e) {
        res.status(500).json({ error: 'Errore server' });
    }
});
app.get('/t/:tenantSlug/api/coupons/:code', tenantLoader, async (req, res) => {
    try {
        const dbConn = await getDb();
        const coupon = await dbConn.get(`
            SELECT c.*, camp.name AS campaignName 
            FROM coupons c 
            LEFT JOIN campaigns camp ON camp.id = c.campaign_id 
            WHERE c.code = ? AND c.tenant_id = ?
        `, req.params.code, req.tenant.id);
        if (!coupon) return res.status(404).json({ error: 'Non trovato' });
        res.json({ 
            code: coupon.code, 
            status: coupon.status, 
            discountType: coupon.discount_type,
            discountValue: coupon.discount_value,
            campaignName: coupon.campaignName
        });
    } catch (e) {
        res.status(500).json({ error: 'Errore server' });
    }
});

// Store: get active coupons with user info
app.get('/api/store/coupons/active', async (req, res) => {
    try {
        const dbConn = await getDb();
        const coupons = await dbConn.all(`
            SELECT c.code, c.discount_type AS discountType, c.discount_value AS discountValue, c.issued_at AS issuedAt,
                   u.first_name AS firstName, u.last_name AS lastName, u.email, camp.name AS campaignName
            FROM coupons c
            JOIN users u ON u.id = c.user_id
            LEFT JOIN campaigns camp ON camp.id = c.campaign_id
            WHERE c.status = 'active'
            ORDER BY c.issued_at DESC
        `);
        res.json(coupons);
    } catch (e) {
        const logContext = logger.withRequest(req);
        logContext.error({ err: e }, 'Error fetching active coupons (legacy)');
        res.status(500).json({ error: 'Errore server' });
    }
});
app.get('/t/:tenantSlug/api/store/coupons/active', tenantLoader, async (req, res) => {
    try {
        const dbConn = await getDb();
        const coupons = await dbConn.all(`
            SELECT c.code, c.discount_type AS discountType, c.discount_value AS discountValue, c.issued_at AS issuedAt,
                   u.first_name AS firstName, u.last_name AS lastName, u.email, camp.name AS campaignName
            FROM coupons c
            JOIN users u ON u.id = c.user_id
            LEFT JOIN campaigns camp ON camp.id = c.campaign_id
            WHERE c.status = 'active' AND c.tenant_id = ?
            ORDER BY c.issued_at DESC
        `, req.tenant.id);
        res.json(coupons);
    } catch (e) {
        const logContext = logger.withRequest(req);
        logContext.error({ err: e, tenant: req.tenant.slug }, 'Error fetching active coupons');
        res.status(500).json({ error: 'Errore server' });
    }
});

// Store: get redeemed coupons with user info
app.get('/api/store/coupons/redeemed', async (req, res) => {
    try {
        const dbConn = await getDb();
        const coupons = await dbConn.all(`
            SELECT c.code, c.discount_type AS discountType, c.discount_value AS discountValue, c.issued_at AS issuedAt, c.redeemed_at AS redeemedAt,
                   u.first_name AS firstName, u.last_name AS lastName, u.email, camp.name AS campaignName
            FROM coupons c
            JOIN users u ON u.id = c.user_id
            LEFT JOIN campaigns camp ON camp.id = c.campaign_id
            WHERE c.status = 'redeemed'
            ORDER BY c.redeemed_at DESC
        `);
        res.json(coupons);
    } catch (e) {
        const logContext = logger.withRequest(req);
        logContext.error({ err: e }, 'Error fetching redeemed coupons');
        res.status(500).json({ error: 'Errore server' });
    }
});
app.get('/t/:tenantSlug/api/store/coupons/redeemed', tenantLoader, async (req, res) => {
    try {
        const dbConn = await getDb();
        const coupons = await dbConn.all(`
            SELECT c.code, c.discount_type AS discountType, c.discount_value AS discountValue, c.issued_at AS issuedAt, c.redeemed_at AS redeemedAt,
                   u.first_name AS firstName, u.last_name AS lastName, u.email, camp.name AS campaignName
            FROM coupons c
            JOIN users u ON u.id = c.user_id
            LEFT JOIN campaigns camp ON camp.id = c.campaign_id
            WHERE c.status = 'redeemed' AND c.tenant_id = ?
            ORDER BY c.redeemed_at DESC
        `, req.tenant.id);
        res.json(coupons);
    } catch (e) {
        const logContext = logger.withRequest(req);
        logContext.error({ err: e }, 'Error fetching redeemed coupons');
        res.status(500).json({ error: 'Errore server' });
    }
});

// Store: search coupons by code (partial) or last name
app.get('/api/store/coupons/search', async (req, res) => {
    try {
        const { q } = req.query;
        if (!q || q.trim().length < 2) {
            return res.json([]);
        }
        
        const dbConn = await getDb();
        const searchTerm = `%${q.trim().toUpperCase()}%`;
        
        const coupons = await dbConn.all(`
            SELECT c.code, c.discount_type AS discountType, c.discount_value AS discountValue, c.status, c.issued_at AS issuedAt, c.redeemed_at AS redeemedAt,
                   u.first_name AS firstName, u.last_name AS lastName, u.email, camp.name AS campaignName
            FROM coupons c
            JOIN users u ON u.id = c.user_id
            LEFT JOIN campaigns camp ON camp.id = c.campaign_id
            WHERE c.code LIKE ? OR UPPER(u.last_name) LIKE ?
            ORDER BY c.issued_at DESC
            LIMIT 50
        `, searchTerm, searchTerm);
        
        res.json(coupons);
    } catch (e) {
        const logContext = logger.withRequest(req);
        logContext.error({ err: e }, 'Error fetching redeemed coupons');
        res.status(500).json({ error: 'Errore server' });
    }
});
app.get('/t/:tenantSlug/api/store/coupons/search', tenantLoader, async (req, res) => {
    try {
        const { q } = req.query;
        if (!q || q.trim().length < 2) {
            return res.json([]);
        }
        const dbConn = await getDb();
        const searchTerm = `%${q.trim().toUpperCase()}%`;
        const coupons = await dbConn.all(`
            SELECT c.code, c.discount_type AS discountType, c.discount_value AS discountValue, c.status, c.issued_at AS issuedAt, c.redeemed_at AS redeemedAt,
                   u.first_name AS firstName, u.last_name AS lastName, u.email, camp.name AS campaignName
            FROM coupons c
            JOIN users u ON u.id = c.user_id
            LEFT JOIN campaigns camp ON camp.id = c.campaign_id
            WHERE (c.code LIKE ? OR UPPER(u.last_name) LIKE ?) AND c.tenant_id = ?
            ORDER BY c.issued_at DESC
            LIMIT 50
        `, searchTerm, searchTerm, req.tenant.id);
        res.json(coupons);
    } catch (e) {
        const logContext = logger.withRequest(req);
        logContext.error({ err: e }, 'Error fetching redeemed coupons');
        res.status(500).json({ error: 'Errore server' });
    }
});

// Admin: search coupons by code (partial) or last name
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
        logContext.error({ err: e }, 'Error fetching redeemed coupons');
        res.status(500).json({ error: 'Errore server' });
    }
});

// Legacy endpoint /api/coupons/:code/redeem (tenant-aware for backward compatibility)
// Tries to infer tenant from session/referer, falls back to global search if not found
app.post('/api/coupons/:code/redeem', async (req, res) => {
    try {
        const dbConn = await getDb();
        const tenantId = await getTenantIdForApi(req);
        
        let coupon;
        if (tenantId) {
            // Try tenant-scoped search first
            coupon = await dbConn.get('SELECT * FROM coupons WHERE code = ? AND tenant_id = ?', req.params.code, tenantId);
        }
        
        // If not found with tenant, try global search (legacy behavior)
        if (!coupon) {
            coupon = await dbConn.get('SELECT * FROM coupons WHERE code = ?', req.params.code);
        }
        
        if (!coupon) return res.status(404).json({ error: 'Non trovato' });
        if (coupon.status !== 'active') return res.status(400).json({ error: 'Coupon non attivo' });
        
        await dbConn.run('UPDATE coupons SET status = ?, redeemed_at = CURRENT_TIMESTAMP WHERE id = ?', 'redeemed', coupon.id);
        res.json({ ok: true, code: coupon.code, status: 'redeemed' });
    } catch (e) {
        console.error('Error in legacy /api/coupons/:code/redeem:', e);
        res.status(500).json({ error: 'Errore server' });
    }
});
app.post('/t/:tenantSlug/api/coupons/:code/redeem', tenantLoader, async (req, res) => {
    try {
        const dbConn = await getDb();
        const coupon = await dbConn.get('SELECT * FROM coupons WHERE code = ? AND tenant_id = ?', req.params.code, req.tenant.id);
        if (!coupon) return res.status(404).json({ error: 'Non trovato' });
        if (coupon.status !== 'active') return res.status(400).json({ error: 'Coupon non attivo' });
        await dbConn.run('UPDATE coupons SET status = ?, redeemed_at = CURRENT_TIMESTAMP WHERE id = ?', 'redeemed', coupon.id);
        res.json({ ok: true, code: coupon.code, status: 'redeemed' });
    } catch (e) {
        res.status(500).json({ error: 'Errore server' });
    }
});

// Admin: list coupons (JSON). Protected via Basic Auth under /api/admin
// Note: Authentication is already applied above

// Campaigns management
app.get('/api/admin/campaigns', requireAdmin, async (req, res) => {
    try {
        const dbConn = await getDb();
        const tenantId = await getTenantIdForApi(req);
        if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
        
        const campaigns = await dbConn.all('SELECT * FROM campaigns WHERE tenant_id = ? ORDER BY created_at DESC', tenantId);
        
        // Auto-deactivate expired campaigns
        const now = new Date();
        for (const campaign of campaigns) {
            if (campaign.expiry_date && new Date(campaign.expiry_date) < now && campaign.is_active) {
                await dbConn.run('UPDATE campaigns SET is_active = 0 WHERE id = ? AND tenant_id = ?', campaign.id, tenantId);
                campaign.is_active = 0; // Update local object for response
            }
        }
        
        res.json(campaigns);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Errore server' });
    }
});
app.get('/t/:tenantSlug/api/admin/campaigns', tenantLoader, requireSameTenantAsSession, requireRole('admin'), async (req, res) => {
    try {
        const dbConn = await getDb();
        const campaigns = await dbConn.all('SELECT * FROM campaigns WHERE tenant_id = ? ORDER BY created_at DESC', req.tenant.id);
        
        // Auto-deactivate expired campaigns
        const now = new Date();
        for (const campaign of campaigns) {
            if (campaign.expiry_date && new Date(campaign.expiry_date) < now && campaign.is_active) {
                await dbConn.run('UPDATE campaigns SET is_active = 0 WHERE id = ?', campaign.id);
                campaign.is_active = 0; // Update local object for response
            }
        }
        
        res.json(campaigns);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Tenant-aware auth-users routes (moved here after campaigns to fix routing)
app.get('/t/:tenantSlug/api/admin/auth-users', tenantLoader, requireSameTenantAsSession, requireRole('admin'), async (req, res) => {
    try {
        console.log('[AUTH-USERS] Tenant-aware GET endpoint called', { path: req.path, tenantSlug: req.params.tenantSlug, tenant: req.tenant?.slug });
        const sess = req.session && req.session.user;
        if (!sess || (sess.userType !== 'admin' && sess.userType !== 'superadmin')) {
            console.log('[AUTH-USERS] Access denied - no session or wrong user type');
            return res.status(403).json({ error: 'Accesso negato' });
        }
        const dbConn = await getDb();
        
        // Use tenant from path (superadmin can access any tenant)
        const tenantId = req.tenant.id;
        console.log('[AUTH-USERS] Processing request for tenant:', tenantId);
        
        // Superadmin can see all users if accessing without tenant restriction, but here we're tenant-scoped
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
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Errore server' });
    }
});

app.post('/t/:tenantSlug/api/admin/auth-users', tenantLoader, requireSameTenantAsSession, requireRole('admin'), async (req, res) => {
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
            tenantId = await getTenantIdForApi(req);
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
        console.error(e);
        res.status(500).json({ error: 'Errore server' });
    }
});

app.put('/t/:tenantSlug/api/admin/auth-users/:id', tenantLoader, requireSameTenantAsSession, requireRole('admin'), async (req, res) => {
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
            const tenantId = await getTenantIdForApi(req);
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
        console.error(e);
        res.status(500).json({ error: 'Errore server' });
    }
});

app.delete('/t/:tenantSlug/api/admin/auth-users/:id', tenantLoader, requireSameTenantAsSession, requireRole('admin'), async (req, res) => {
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
            const tenantId = await getTenantIdForApi(req);
            if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
            user = await dbConn.get('SELECT * FROM auth_users WHERE id = ? AND tenant_id = ?', req.params.id, tenantId);
        }
        
        if (!user) return res.status(404).json({ error: 'Utente non trovato' });
        if (user.user_type === 'superadmin') return res.status(400).json({ error: 'Operazione non consentita' });
        // Solo il Superadmin può eliminare utenti con ruolo admin
        if (user.user_type === 'admin' && sess.userType !== 'superadmin') {
            return res.status(403).json({ error: 'Solo il Superadmin può eliminare utenti admin' });
        }
        
        if (user.id === (sess.authUserId || sess.id)) return res.status(400).json({ error: 'Non puoi eliminare il tuo utente' });
        await dbConn.run('DELETE FROM auth_users WHERE id = ?', req.params.id);
        res.json({ ok: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Tenant-scoped: create campaign
app.post('/t/:tenantSlug/api/admin/campaigns', tenantLoader, requireSameTenantAsSession, requireRole('admin'), async (req, res) => {
    try {
        const { name, description, discount_type, discount_value, expiry_date } = req.body || {};
        if (!name || !discount_type || !discount_value) {
            return res.status(400).json({ error: 'Nome, tipo sconto e valore richiesti' });
        }
        if (!['percent', 'fixed', 'text'].includes(String(discount_type))) {
            return res.status(400).json({ error: 'Tipo sconto non valido' });
        }
        if (discount_type !== 'text' && isNaN(Number(discount_value))) {
            return res.status(400).json({ error: 'Valore sconto non valido' });
        }
        const dbConn = await getDb();
        const campaignCode = generateId(12);
        const defaultFormConfig = JSON.stringify({ 
            email: { visible: true, required: true }, 
            firstName: { visible: true, required: true }, 
            lastName: { visible: true, required: true },
            phone: { visible: false, required: false },
            address: { visible: false, required: false },
            allergies: { visible: false, required: false },
            customFields: []
        });
        const result = await dbConn.run(
            'INSERT INTO campaigns (campaign_code, name, description, discount_type, discount_value, form_config, tenant_id, is_active, expiry_date) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)',
            campaignCode, name, description || null, discount_type, discount_value, defaultFormConfig, req.tenant.id, expiry_date || null
        );
        res.json({ id: result.lastID, campaign_code: campaignCode, name, description, discount_type, discount_value });
    } catch (e) {
        const logContext = logger.withRequest(req);
        // Only check for campaign_code uniqueness constraint, not name
        if (e && e.code === 'SQLITE_CONSTRAINT' && e.message && e.message.includes('campaign_code')) {
            logContext.warn({ err: e, campaignCode, tenant: req.tenant.slug }, 'Campaign code already exists for tenant');
            return res.status(409).json({ error: 'Codice campagna già esistente per questo tenant' });
        }
        logContext.error({ err: e, campaignName: name, tenant: req.tenant.slug }, 'Error creating campaign');
        res.status(500).json({ error: 'Errore server' });
    }
});

// Tenant-scoped: update campaign
app.put('/t/:tenantSlug/api/admin/campaigns/:id', tenantLoader, requireSameTenantAsSession, requireRole('admin'), async (req, res) => {
    try {
        const { name, description, discount_type, discount_value, expiry_date } = req.body || {};
        const fields = [];
        const params = [];
        if (typeof name === 'string') { fields.push('name = ?'); params.push(name); }
        if (typeof description === 'string') { fields.push('description = ?'); params.push(description); }
        if (typeof discount_type === 'string') { fields.push('discount_type = ?'); params.push(discount_type); }
        if (typeof discount_value === 'string') { fields.push('discount_value = ?'); params.push(discount_value); }
        if (typeof expiry_date === 'string' || expiry_date === null) { fields.push('expiry_date = ?'); params.push(expiry_date || null); }
        if (fields.length === 0) return res.status(400).json({ error: 'Nessun campo da aggiornare' });
        const dbConn = await getDb();
        params.push(req.params.id, req.tenant.id);
        await dbConn.run(`UPDATE campaigns SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ?`, params);
        const updated = await dbConn.get('SELECT * FROM campaigns WHERE id = ? AND tenant_id = ?', req.params.id, req.tenant.id);
        res.json(updated);
    } catch (e) {
        console.error('update campaign (tenant) error', e);
        // Only check for campaign_code uniqueness constraint, not name
        if (e && e.code === 'SQLITE_CONSTRAINT' && e.message && e.message.includes('campaign_code')) {
            return res.status(409).json({ error: 'Codice campagna già esistente' });
        }
        res.status(500).json({ error: 'Errore server' });
    }
});

// Tenant-scoped: activate/deactivate campaign
app.put('/t/:tenantSlug/api/admin/campaigns/:id/activate', tenantLoader, requireSameTenantAsSession, requireRole('admin'), async (req, res) => {
    try {
        const dbConn = await getDb();
        await dbConn.run('UPDATE campaigns SET is_active = 1 WHERE id = ? AND tenant_id = ?', req.params.id, req.tenant.id);
        res.json({ ok: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Errore server' });
    }
});
app.put('/t/:tenantSlug/api/admin/campaigns/:id/deactivate', tenantLoader, requireSameTenantAsSession, requireRole('admin'), async (req, res) => {
    try {
        const dbConn = await getDb();
        await dbConn.run('UPDATE campaigns SET is_active = 0 WHERE id = ? AND tenant_id = ?', req.params.id, req.tenant.id);
        res.json({ ok: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Tenant-scoped: update email from name
app.put('/t/:tenantSlug/api/admin/email-from-name', tenantLoader, requireSameTenantAsSession, requireRole('admin'), async (req, res) => {
    try {
        const { emailFromName } = req.body || {};
        if (!emailFromName || typeof emailFromName !== 'string' || emailFromName.trim().length === 0) {
            return res.status(400).json({ error: 'Nome mittente email richiesto' });
        }
        
        const dbConn = await getDb();
        await dbConn.run('UPDATE tenants SET email_from_name = ? WHERE id = ?', emailFromName.trim(), req.tenant.id);
        
        // Log the action
        await logAction(req, 'update', `Nome mittente email aggiornato: ${emailFromName.trim()}`, 'info');
        
        res.json({ ok: true, emailFromName: emailFromName.trim() });
    } catch (e) {
        const logContext = logger.withRequest(req);
        logContext.error({ err: e }, 'Error updating email from name');
        res.status(500).json({ error: 'Errore server' });
    }
});

// Tenant-scoped: get current email from name
app.get('/t/:tenantSlug/api/admin/email-from-name', tenantLoader, requireSameTenantAsSession, requireRole('admin'), async (req, res) => {
    try {
        const dbConn = await getDb();
        const tenant = await dbConn.get('SELECT email_from_name FROM tenants WHERE id = ?', req.tenant.id);
        res.json({ emailFromName: tenant?.email_from_name || 'CouponGen' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Tenant-scoped: get campaign form config
app.get('/t/:tenantSlug/api/admin/campaigns/:id/form-config', tenantLoader, requireSameTenantAsSession, requireRole('admin'), async (req, res) => {
    try {
        const dbConn = await getDb();
        const campaign = await dbConn.get('SELECT form_config FROM campaigns WHERE id = ? AND tenant_id = ?', req.params.id, req.tenant.id);
        if (!campaign) {
            return res.status(404).json({ error: 'Campagna non trovata' });
        }
        const formConfig = JSON.parse(campaign.form_config || '{"email": {"visible": true, "required": true}, "firstName": {"visible": true, "required": true}, "lastName": {"visible": true, "required": true}}');
        res.json(formConfig);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Tenant-scoped: update campaign form config
app.put('/t/:tenantSlug/api/admin/campaigns/:id/form-config', tenantLoader, requireSameTenantAsSession, requireRole('admin'), async (req, res) => {
    try {
        const dbConn = await getDb();
        const { formConfig } = req.body;
        if (!formConfig || typeof formConfig !== 'object') {
            return res.status(400).json({ error: 'Configurazione form non valida' });
        }
        
        const result = await dbConn.run('UPDATE campaigns SET form_config = ? WHERE id = ? AND tenant_id = ?', JSON.stringify(formConfig), req.params.id, req.tenant.id);
        if (result.changes === 0) return res.status(404).json({ error: 'Campagna non trovata' });
        res.json({ ok: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Duplicate routes removed - see routes above (before app.use middleware)

// Tenant-scoped: get campaign by code (for form parameter)
app.get('/t/:tenantSlug/api/campaigns/:code', tenantLoader, async (req, res) => {
    try {
        const dbConn = await getDb();
        const campaign = await dbConn.get('SELECT * FROM campaigns WHERE campaign_code = ? AND tenant_id = ?', req.params.code, req.tenant.id);
        if (!campaign) {
            return res.status(404).json({ error: 'Campagna non trovata' });
        }
        // Check if campaign is active and not expired
        if (!campaign.is_active) {
            return res.status(404).json({ error: 'Campagna non trovata' });
        }
        
        // Check if campaign has expired
        if (campaign.expiry_date && new Date(campaign.expiry_date) < new Date()) {
            // Auto-deactivate expired campaign
            await dbConn.run('UPDATE campaigns SET is_active = 0 WHERE id = ?', campaign.id);
            return res.status(404).json({ error: 'Campagna scaduta' });
        }
        
        // Parse form config
        const formConfig = JSON.parse(campaign.form_config || '{"email": {"visible": true, "required": true}, "firstName": {"visible": true, "required": true}, "lastName": {"visible": true, "required": true}}');
        campaign.form_config = formConfig;
        
        res.json(campaign);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Legacy endpoint /api/campaigns/:code - Still supported for backward compatibility
// Automatically determines tenant from session or referer
app.get('/api/campaigns/:code', async (req, res) => {
    try {
        const dbConn = await getDb();
        const tenantId = await getTenantIdForApi(req);
        
        if (!tenantId) {
            // Try to get default tenant or first tenant
            const defaultTenant = await dbConn.get('SELECT id FROM tenants WHERE slug = ?', DEFAULT_TENANT_SLUG);
            const tenant = defaultTenant || await dbConn.get('SELECT id FROM tenants ORDER BY id ASC LIMIT 1');
            
            if (!tenant) {
                return res.status(404).json({ error: 'Tenant non trovato' });
            }
            
            const campaign = await dbConn.get('SELECT * FROM campaigns WHERE campaign_code = ? AND tenant_id = ?', req.params.code, tenant.id);
            if (!campaign) {
                return res.status(404).json({ error: 'Campagna non trovata' });
            }
            
            // Check if campaign is active and not expired
            if (!campaign.is_active) {
                return res.status(404).json({ error: 'Campagna non trovata' });
            }
            
            // Check if campaign has expired
            if (campaign.expiry_date && new Date(campaign.expiry_date) < new Date()) {
                // Auto-deactivate expired campaign
                await dbConn.run('UPDATE campaigns SET is_active = 0 WHERE id = ?', campaign.id);
                return res.status(404).json({ error: 'Campagna scaduta' });
            }
            
            // Parse form config
            const formConfig = JSON.parse(campaign.form_config || '{"email": {"visible": true, "required": true}, "firstName": {"visible": true, "required": true}, "lastName": {"visible": true, "required": true}}');
            campaign.form_config = formConfig;
            
            return res.json(campaign);
        }
        
        // Use tenantId from session/referer
        const campaign = await dbConn.get('SELECT * FROM campaigns WHERE campaign_code = ? AND tenant_id = ?', req.params.code, tenantId);
        if (!campaign) {
            return res.status(404).json({ error: 'Campagna non trovata' });
        }
        
        // Check if campaign is active and not expired
        if (!campaign.is_active) {
            return res.status(404).json({ error: 'Campagna non trovata' });
        }
        
        // Check if campaign has expired
        if (campaign.expiry_date && new Date(campaign.expiry_date) < new Date()) {
            // Auto-deactivate expired campaign
            await dbConn.run('UPDATE campaigns SET is_active = 0 WHERE id = ?', campaign.id);
            return res.status(404).json({ error: 'Campagna scaduta' });
        }
        
        // Parse form config
        const formConfig = JSON.parse(campaign.form_config || '{"email": {"visible": true, "required": true}, "firstName": {"visible": true, "required": true}, "lastName": {"visible": true, "required": true}}');
        campaign.form_config = formConfig;
        
        res.json(campaign);
    } catch (e) {
        console.error('Error fetching campaign (legacy endpoint):', e);
        res.status(500).json({ error: 'Errore server' });
    }
});

app.post('/api/admin/campaigns', requireAdmin, async (req, res) => {
    let tenantId = null;
    try {
        const { name, description, discount_type, discount_value, expiry_date } = req.body;
        if (typeof name !== 'string' || !name.trim()) {
            return res.status(400).json({ error: 'Nome non valido' });
        }
        if (!['percent', 'fixed', 'text'].includes(String(discount_type))) {
            return res.status(400).json({ error: 'Tipo sconto non valido' });
        }
        if (discount_type !== 'text' && isNaN(Number(discount_value))) {
            return res.status(400).json({ error: 'Valore sconto non valido' });
        }
        
        if (!name || !discount_type || !discount_value) {
            return res.status(400).json({ error: 'Nome, tipo sconto e valore richiesti' });
        }
        
        const dbConn = await getDb();
        tenantId = await getTenantIdForApi(req);
        if (!tenantId) {
            const logContext = logger.withRequest(req);
            logContext.warn({ name, discount_type }, 'Campaign creation failed: invalid tenant');
            return res.status(400).json({ error: 'Tenant non valido' });
        }
        
        const campaignCode = generateId(12).toUpperCase();
        const defaultFormConfig = JSON.stringify({ 
            email: { visible: true, required: true }, 
            firstName: { visible: true, required: true }, 
            lastName: { visible: true, required: true },
            phone: { visible: false, required: false },
            address: { visible: false, required: false },
            allergies: { visible: false, required: false },
            customFields: []
        });
        const result = await dbConn.run(
            'INSERT INTO campaigns (campaign_code, name, description, discount_type, discount_value, form_config, tenant_id, is_active, expiry_date) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)',
            campaignCode, name, description || null, discount_type, discount_value, defaultFormConfig, tenantId, expiry_date || null
        );
        res.json({ id: result.lastID, campaign_code: campaignCode, name, description, discount_type, discount_value });
    } catch (e) {
        const logContext = logger.withRequest(req);
        logContext.error({ err: e, name: req.body?.name, tenantId, stack: e.stack }, 'Error creating campaign');
        console.error('Error creating campaign:', e);
        // Only check for campaign_code uniqueness constraint, not name
        if (e.code === 'SQLITE_CONSTRAINT' && e.message && e.message.includes('campaign_code')) {
            return res.status(409).json({ error: 'Codice campagna già esistente per questo tenant' });
        }
        // Check if it's a database connection error
        if (e.code === 'SQLITE_BUSY' || e.code === 'SQLITE_LOCKED') {
            return res.status(503).json({ error: 'Database temporaneamente occupato, riprova tra qualche istante' });
        }
        res.status(500).json({ error: 'Errore server' });
    }
});

// Update campaign
app.put('/api/admin/campaigns/:id', requireAdmin, async (req, res) => {
    try {
        const { name, description, discount_type, discount_value, expiry_date } = req.body || {};
        const fields = [];
        const params = [];
        if (typeof name === 'string') { fields.push('name = ?'); params.push(name); }
        if (typeof description === 'string') { fields.push('description = ?'); params.push(description); }
        if (typeof discount_type === 'string') { fields.push('discount_type = ?'); params.push(discount_type); }
        if (typeof discount_value === 'string') { fields.push('discount_value = ?'); params.push(discount_value); }
        if (typeof expiry_date === 'string' || expiry_date === null) { fields.push('expiry_date = ?'); params.push(expiry_date || null); }
        if (fields.length === 0) return res.status(400).json({ error: 'Nessun campo da aggiornare' });
        const dbConn = await getDb();
        const tenantId = await getTenantIdForApi(req);
        if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
        params.push(req.params.id, tenantId);
        await dbConn.run(`UPDATE campaigns SET ${fields.join(', ')} WHERE id = ? AND tenant_id = ?`, params);
        const updated = await dbConn.get('SELECT * FROM campaigns WHERE id = ? AND tenant_id = ?', req.params.id, tenantId);
        if (!updated) return res.status(404).json({ error: 'Campagna non trovata' });
        res.json(updated);
    } catch (e) {
        console.error('update campaign error', e);
        // Only check for campaign_code uniqueness constraint, not name
        if (e && e.code === 'SQLITE_CONSTRAINT' && e.message && e.message.includes('campaign_code')) {
            return res.status(409).json({ error: 'Codice campagna già esistente' });
        }
        res.status(500).json({ error: 'Errore server' });
    }
});

app.put('/api/admin/campaigns/:id/activate', requireAdmin, async (req, res) => {
    try {
        const dbConn = await getDb();
        const tenantId = await getTenantIdForApi(req);
        if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
        // Simply activate the selected campaign (no need to deactivate others)
        const result = await dbConn.run('UPDATE campaigns SET is_active = 1 WHERE id = ? AND tenant_id = ?', req.params.id, tenantId);
        if (result.changes === 0) return res.status(404).json({ error: 'Campagna non trovata' });
        res.json({ ok: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Errore server' });
    }
});

app.put('/api/admin/campaigns/:id/deactivate', requireAdmin, async (req, res) => {
    try {
        const dbConn = await getDb();
        const tenantId = await getTenantIdForApi(req);
        if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
        // Deactivate the specific campaign
        const result = await dbConn.run('UPDATE campaigns SET is_active = 0 WHERE id = ? AND tenant_id = ?', req.params.id, tenantId);
        if (result.changes === 0) return res.status(404).json({ error: 'Campagna non trovata' });
        res.json({ ok: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Errore server' });
    }
});

app.delete('/api/admin/campaigns/:id', requireAdmin, async (req, res) => {
    try {
        const dbConn = await getDb();
        const tenantId = await getTenantIdForApi(req);
        if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
        const result = await dbConn.run('DELETE FROM campaigns WHERE id = ? AND tenant_id = ?', req.params.id, tenantId);
        if (result.changes === 0) return res.status(404).json({ error: 'Campagna non trovata' });
        res.json({ ok: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Form configuration APIs
app.get('/api/admin/campaigns/:id/form-config', requireAdmin, async (req, res) => {
    try {
        const dbConn = await getDb();
        const tenantId = await getTenantIdForApi(req);
        if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
        const campaign = await dbConn.get('SELECT form_config FROM campaigns WHERE id = ? AND tenant_id = ?', req.params.id, tenantId);
        if (!campaign) {
            return res.status(404).json({ error: 'Campagna non trovata' });
        }
        const formConfig = JSON.parse(campaign.form_config || '{"email": {"visible": true, "required": true}, "firstName": {"visible": true, "required": true}, "lastName": {"visible": true, "required": true}}');
        res.json(formConfig);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Errore server' });
    }
});

app.put('/api/admin/campaigns/:id/form-config', requireAdmin, async (req, res) => {
    try {
        const dbConn = await getDb();
        const tenantId = await getTenantIdForApi(req);
        if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
        
        const { formConfig } = req.body;
        if (!formConfig || typeof formConfig !== 'object') {
            return res.status(400).json({ error: 'Configurazione form non valida' });
        }
        
        const result = await dbConn.run('UPDATE campaigns SET form_config = ? WHERE id = ? AND tenant_id = ?', JSON.stringify(formConfig), req.params.id, tenantId);
        if (result.changes === 0) return res.status(404).json({ error: 'Campagna non trovata' });
        res.json({ ok: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Errore server' });
    }
});

// API per recuperare tutte le campagne (restituisce id e name per gestire nomi duplicati)
app.get('/api/admin/campaigns-list', requireAdmin, async (req, res) => {
    try {
        const dbConn = await getDb();
        const tenantId = await getTenantIdForApi(req);
        if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
        const campaigns = await dbConn.all(`
            SELECT id, name, campaign_code
            FROM campaigns 
            WHERE name IS NOT NULL AND name != '' AND tenant_id = ?
            ORDER BY name, created_at DESC
        `, tenantId);
        // Return array of objects with id and name for better identification
        res.json(campaigns.map(c => ({ id: c.id, name: c.name, code: c.campaign_code })));
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Database utenti API
app.get('/api/admin/users', requireAdmin, async (req, res) => {
    try {
        const { search, campaigns } = req.query;
        const dbConn = await getDb();
        const tenantId = await getTenantIdForApi(req);
        if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
        
        let query = `
            SELECT 
                u.id,
                u.email,
                u.first_name,
                u.last_name,
                GROUP_CONCAT(DISTINCT c.name) as campaigns,
                COUNT(DISTINCT co.id) as total_coupons,
                MIN(u.created_at) as first_coupon_date,
                MAX(u.created_at) as last_coupon_date
            FROM users u
            LEFT JOIN coupons co ON u.id = co.user_id AND co.tenant_id = u.tenant_id
            LEFT JOIN campaigns c ON co.campaign_id = c.id AND c.tenant_id = u.tenant_id
        `;
        
        const params = [tenantId];
        const conditions = ['u.tenant_id = ?'];
        
        if (search && search.trim()) {
            conditions.push(`u.last_name LIKE ?`);
            params.push(`%${search.trim()}%`);
        }
        
        if (campaigns && campaigns.trim()) {
            const campaignList = campaigns.split(',').map(c => c.trim()).filter(c => c);
            if (campaignList.length > 0) {
                const placeholders = campaignList.map(() => '?').join(',');
                conditions.push(`c.name IN (${placeholders})`);
                params.push(...campaignList);
            }
        }
        
        if (conditions.length > 0) {
            query += ` WHERE ${conditions.join(' AND ')}`;
        }
        
        query += `
            GROUP BY u.id
            ORDER BY last_coupon_date DESC
        `;
        
        const users = await dbConn.all(query, params);
        
        // Fetch custom fields for each user
        for (let user of users) {
            const customFields = await dbConn.all(
                'SELECT field_name, field_value FROM user_custom_data WHERE user_id = ? AND tenant_id = ?',
                user.id, tenantId
            );
            user.customFields = customFields.reduce((acc, field) => {
                acc[field.field_name] = field.field_value;
                return acc;
            }, {});
        }
        
        res.json(users);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Export users as CSV for current tenant
app.get('/api/admin/users/export.csv', requireAdmin, async (req, res) => {
    try {
        const dbConn = await getDb();
        const tenantId = await getTenantIdForApi(req);
        if (!tenantId) return res.status(400).send('Tenant non valido');

        let query = `
            SELECT 
                u.id,
                u.email,
                u.first_name,
                u.last_name,
                GROUP_CONCAT(DISTINCT c.name) as campaigns,
                COUNT(DISTINCT co.id) as total_coupons,
                MIN(u.created_at) as first_coupon_date,
                MAX(u.created_at) as last_coupon_date
            FROM users u
            LEFT JOIN coupons co ON u.id = co.user_id AND co.tenant_id = u.tenant_id
            LEFT JOIN campaigns c ON co.campaign_id = c.id AND c.tenant_id = u.tenant_id
            WHERE u.tenant_id = ?
            GROUP BY u.id
            ORDER BY last_coupon_date DESC
        `;

        const users = await dbConn.all(query, tenantId);

        // Collect custom fields and union of field names
        const allCustomFieldNames = new Set();
        for (let user of users) {
            const customFields = await dbConn.all(
                'SELECT field_name, field_value FROM user_custom_data WHERE user_id = ? AND tenant_id = ?',
                user.id, tenantId
            );
            const mapped = customFields.reduce((acc, field) => {
                acc[field.field_name] = field.field_value;
                allCustomFieldNames.add(field.field_name);
                return acc;
            }, {});
            user.customFields = mapped;
        }

        // Prepare CSV
        const customFieldColumns = Array.from(allCustomFieldNames).sort();
        const headers = [
            'email',
            'first_name',
            'last_name',
            'campaigns',
            'total_coupons',
            'first_coupon_date',
            'last_coupon_date',
            ...customFieldColumns
        ];

        const escapeCsv = (value) => {
            if (value === null || value === undefined) return '';
            const str = String(value);
            if (/[",\n]/.test(str)) {
                return '"' + str.replace(/"/g, '""') + '"';
            }
            return str;
        };

        const rows = [];
        rows.push(headers.join(','));
        for (const u of users) {
            const baseCols = [
                u.email || '',
                u.first_name || '',
                u.last_name || '',
                (u.campaigns || ''),
                u.total_coupons || 0,
                u.first_coupon_date || '',
                u.last_coupon_date || ''
            ];
            const customCols = customFieldColumns.map(name => (u.customFields && u.customFields[name]) ? u.customFields[name] : '');
            const line = [...baseCols, ...customCols].map(escapeCsv).join(',');
            rows.push(line);
        }

        const csvContent = '\uFEFF' + rows.join('\n'); // BOM for Excel
        const timestamp = new Date().toISOString().replace(/[:T]/g, '-').split('.')[0];
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="utenti-${timestamp}.csv"`);
        return res.send(csvContent);
    } catch (e) {
        console.error(e);
        res.status(500).send('Errore server');
    }
});

// Get user coupons
app.get('/api/admin/users/:id/coupons', requireAdmin, async (req, res) => {
    try {
        const dbConn = await getDb();
        const tenantId = await getTenantIdForApi(req);
        if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
        
        // Check if user exists
        const user = await dbConn.get('SELECT * FROM users WHERE id = ? AND tenant_id = ?', req.params.id, tenantId);
        if (!user) {
            return res.status(404).json({ error: 'Utente non trovato' });
        }
        
        // Get user coupons with campaign info
        const coupons = await dbConn.all(`
            SELECT 
                c.id,
                c.code,
                c.status,
                c.discount_type,
                c.discount_value,
                c.issued_at,
                c.redeemed_at,
                camp.name as campaign_name
            FROM coupons c
            LEFT JOIN campaigns camp ON camp.id = c.campaign_id
            WHERE c.user_id = ? AND c.tenant_id = ?
            ORDER BY c.issued_at DESC
        `, req.params.id, tenantId);
        
        res.json(coupons);
    } catch (e) {
        const logContext = logger.withRequest(req);
        logContext.error({ err: e }, 'Error fetching redeemed coupons');
        res.status(500).json({ error: 'Errore server' });
    }
});

// Delete specific coupon
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
        console.error(e);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Delete user
app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
    try {
        const dbConn = await getDb();
        const tenantId = await getTenantIdForApi(req);
        if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
        
        // Check if user exists
        const user = await dbConn.get('SELECT * FROM users WHERE id = ? AND tenant_id = ?', req.params.id, tenantId);
        if (!user) {
            return res.status(404).json({ error: 'Utente non trovato' });
        }
        
        // Check if user has active coupons
        const activeCouponCount = await dbConn.get('SELECT COUNT(*) as count FROM coupons WHERE user_id = ? AND status = "active" AND tenant_id = ?', req.params.id, tenantId);
        if (activeCouponCount.count > 0) {
            return res.status(400).json({ 
                error: 'Impossibile eliminare l\'utente: ha dei coupon attivi. Elimina prima i coupon attivi o cambia il loro stato.' 
            });
        }
        
        // Delete user (custom fields will be deleted automatically due to CASCADE)
        await dbConn.run('DELETE FROM users WHERE id = ? AND tenant_id = ?', req.params.id, tenantId);
        
        res.json({ success: true, message: 'Utente eliminato con successo' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Get single user by ID
app.get('/api/admin/users/:id', requireAdmin, async (req, res) => {
    try {
        const dbConn = await getDb();
        const tenantId = await getTenantIdForApi(req);
        if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
        const user = await dbConn.get('SELECT * FROM users WHERE id = ? AND tenant_id = ?', req.params.id, tenantId);
        if (!user) {
            return res.status(404).json({ error: 'Utente non trovato' });
        }
        
        // Fetch custom fields
        const customFields = await dbConn.all(
            'SELECT field_name, field_value FROM user_custom_data WHERE user_id = ? AND tenant_id = ?',
            user.id, tenantId
        );
        user.customFields = customFields.reduce((acc, field) => {
            acc[field.field_name] = field.field_value;
            return acc;
        }, {});
        
        res.json(user);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Update user
app.put('/api/admin/users/:id', requireAdmin, async (req, res) => {
    try {
        const { email, first_name, last_name, customFields } = req.body;
        const dbConn = await getDb();
        const tenantId = await getTenantIdForApi(req);
        if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
        
        // Check if user exists
        const existingUser = await dbConn.get('SELECT * FROM users WHERE id = ? AND tenant_id = ?', req.params.id, tenantId);
        if (!existingUser) {
            return res.status(404).json({ error: 'Utente non trovato' });
        }
        
        // Check if email is already taken by another user
        if (email && email !== existingUser.email) {
            const emailExists = await dbConn.get('SELECT id FROM users WHERE email = ? AND id != ? AND tenant_id = ?', email, req.params.id, tenantId);
            if (emailExists) {
                return res.status(400).json({ error: 'Email già utilizzata da un altro utente' });
            }
        }
        
        // Update user basic info
        await dbConn.run(
            'UPDATE users SET email = ?, first_name = ?, last_name = ? WHERE id = ? AND tenant_id = ?',
            email, first_name, last_name, req.params.id, tenantId
        );
        
        // Update custom fields
        if (customFields && typeof customFields === 'object') {
            // Delete existing custom fields
            await dbConn.run('DELETE FROM user_custom_data WHERE user_id = ? AND tenant_id = ?', req.params.id, tenantId);
            
            // Insert new custom fields
            for (const [fieldName, fieldValue] of Object.entries(customFields)) {
                if (fieldValue !== undefined && fieldValue !== '') {
                    await dbConn.run(
                        'INSERT INTO user_custom_data (user_id, field_name, field_value, tenant_id) VALUES (?, ?, ?, ?)',
                        req.params.id, fieldName, fieldValue, tenantId
                    );
                }
            }
        }
        
        res.json({ success: true, message: 'Utente aggiornato con successo' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Errore server' });
    }
});

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
        console.error(e);
        res.status(500).json({ error: 'Errore server' });
    }
});

// API to manage custom fields for a campaign
app.get('/api/admin/campaigns/:id/custom-fields', requireAdmin, async (req, res) => {
    try {
        const dbConn = await getDb();
        const tenantId = await getTenantIdForApi(req);
        if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
        const campaign = await dbConn.get('SELECT form_config FROM campaigns WHERE id = ? AND tenant_id = ?', req.params.id, tenantId);
        if (!campaign) {
            return res.status(404).json({ error: 'Campagna non trovata' });
        }
        
        const formConfig = JSON.parse(campaign.form_config);
        res.json(formConfig.customFields || []);
    } catch (error) {
        console.error('Error fetching custom fields:', error);
        res.status(500).json({ error: 'Errore nel recupero dei campi custom' });
    }
});

app.put('/api/admin/campaigns/:id/custom-fields', requireAdmin, async (req, res) => {
    try {
        const { customFields } = req.body;
        const dbConn = await getDb();
        const tenantId = await getTenantIdForApi(req);
        if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
        
        // Controlla il limite di 5 campi custom
        if (customFields && customFields.length > 5) {
            return res.status(400).json({ error: 'Limite massimo di 5 campi custom per campagna' });
        }
        
        // Get current form config
        const campaign = await dbConn.get('SELECT form_config FROM campaigns WHERE id = ? AND tenant_id = ?', req.params.id, tenantId);
        if (!campaign) {
            return res.status(404).json({ error: 'Campagna non trovata' });
        }
        
        const formConfig = JSON.parse(campaign.form_config);
        formConfig.customFields = customFields || [];
        
        // Update campaign
        const result = await dbConn.run('UPDATE campaigns SET form_config = ? WHERE id = ? AND tenant_id = ?', JSON.stringify(formConfig), req.params.id, tenantId);
        if (result.changes === 0) return res.status(404).json({ error: 'Campagna non trovata' });
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating custom fields:', error);
        res.status(500).json({ error: 'Errore nell\'aggiornamento dei campi custom' });
    }
});

// Products API
app.get('/api/admin/products', requireAdmin, async (req, res) => {
    try {
        const dbConn = await getDb();
        const tenantId = await getTenantIdForApi(req);
        if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
        const products = await dbConn.all('SELECT * FROM products WHERE tenant_id = ? ORDER BY created_at DESC', tenantId);
        res.json(products);
    } catch (error) {
        console.error('Error fetching products:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/admin/products', requireAdmin, async (req, res) => {
    try {
        const { name, value, margin_price, sku } = req.body;
        if (typeof name !== 'string' || !name.trim()) {
            return res.status(400).json({ error: 'Nome non valido' });
        }
        if (isNaN(parseFloat(value)) || isNaN(parseFloat(margin_price))) {
            return res.status(400).json({ error: 'Valori numerici non validi' });
        }
        
        if (!name || !value || !margin_price) {
            return res.status(400).json({ error: 'Name, value and margin_price are required' });
        }
        
        const dbConn = await getDb();
        const tenantId = await getTenantIdForApi(req);
        if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
        const result = await dbConn.run(
            'INSERT INTO products (name, value, margin_price, sku, tenant_id) VALUES (?, ?, ?, ?, ?)',
            [name, parseFloat(value), parseFloat(margin_price), sku || null, tenantId]
        );
        
        res.json({ id: result.lastID, success: true });
    } catch (error) {
        console.error('Error creating product:', error);
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            res.status(400).json({ error: 'SKU already exists' });
        } else {
            res.status(500).json({ error: 'Internal server error' });
        }
    }
});

app.put('/api/admin/products/:id', requireAdmin, async (req, res) => {
    try {
        const { name, value, margin_price, sku } = req.body;
        if (typeof name !== 'string' || !name.trim()) {
            return res.status(400).json({ error: 'Nome non valido' });
        }
        if (isNaN(parseFloat(value)) || isNaN(parseFloat(margin_price))) {
            return res.status(400).json({ error: 'Valori numerici non validi' });
        }
        const dbConn = await getDb();
        const tenantId = await getTenantIdForApi(req);
        if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
        const result = await dbConn.run(
            'UPDATE products SET name = ?, value = ?, margin_price = ?, sku = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?',
            [name, parseFloat(value), parseFloat(margin_price), sku || null, req.params.id, tenantId]
        );
        if (result.changes === 0) return res.status(404).json({ error: 'Prodotto non trovato' });
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating product:', error);
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            res.status(400).json({ error: 'SKU already exists' });
        } else {
            res.status(500).json({ error: 'Internal server error' });
        }
    }
});

app.delete('/api/admin/products/:id', requireAdmin, async (req, res) => {
    try {
        const dbConn = await getDb();
        const tenantId = await getTenantIdForApi(req);
        if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
        const result = await dbConn.run('DELETE FROM products WHERE id = ? AND tenant_id = ?', req.params.id, tenantId);
        if (result.changes === 0) return res.status(404).json({ error: 'Prodotto non trovato' });
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting product:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Tenant-aware Products API (these routes are handled by the middleware at line 2784)
app.get('/t/:tenantSlug/api/admin/products', tenantLoader, requireSameTenantAsSession, requireRole('admin'), async (req, res) => {
    try {
        const dbConn = await getDb();
        const products = await dbConn.all('SELECT * FROM products WHERE tenant_id = ? ORDER BY created_at DESC', req.tenant.id);
        res.json(products);
    } catch (error) {
        console.error('Error fetching products:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/t/:tenantSlug/api/admin/products', tenantLoader, requireSameTenantAsSession, requireRole('admin'), async (req, res) => {
    try {
        const { name, value, margin_price, sku } = req.body;
        if (typeof name !== 'string' || !name.trim()) {
            return res.status(400).json({ error: 'Nome non valido' });
        }
        if (isNaN(parseFloat(value)) || isNaN(parseFloat(margin_price))) {
            return res.status(400).json({ error: 'Valori numerici non validi' });
        }
        
        if (!name || !value || !margin_price) {
            return res.status(400).json({ error: 'Name, value and margin_price are required' });
        }
        
        const dbConn = await getDb();
        const result = await dbConn.run(
            'INSERT INTO products (name, value, margin_price, sku, tenant_id) VALUES (?, ?, ?, ?, ?)',
            [name, parseFloat(value), parseFloat(margin_price), sku || null, req.tenant.id]
        );
        
        res.json({ id: result.lastID, success: true });
    } catch (error) {
        console.error('Error creating product:', error);
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            res.status(400).json({ error: 'SKU already exists' });
        } else {
            res.status(500).json({ error: 'Internal server error' });
        }
    }
});

app.put('/t/:tenantSlug/api/admin/products/:id', tenantLoader, requireSameTenantAsSession, requireRole('admin'), async (req, res) => {
    try {
        const { name, value, margin_price, sku } = req.body;
        if (typeof name !== 'string' || !name.trim()) {
            return res.status(400).json({ error: 'Nome non valido' });
        }
        if (isNaN(parseFloat(value)) || isNaN(parseFloat(margin_price))) {
            return res.status(400).json({ error: 'Valori numerici non validi' });
        }
        const dbConn = await getDb();
        const result = await dbConn.run(
            'UPDATE products SET name = ?, value = ?, margin_price = ?, sku = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?',
            [name, parseFloat(value), parseFloat(margin_price), sku || null, req.params.id, req.tenant.id]
        );
        if (result.changes === 0) return res.status(404).json({ error: 'Prodotto non trovato' });
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating product:', error);
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            res.status(400).json({ error: 'SKU already exists' });
        } else {
            res.status(500).json({ error: 'Internal server error' });
        }
    }
});

app.delete('/t/:tenantSlug/api/admin/products/:id', tenantLoader, requireSameTenantAsSession, requireRole('admin'), async (req, res) => {
    try {
        const dbConn = await getDb();
        const result = await dbConn.run('DELETE FROM products WHERE id = ? AND tenant_id = ?', req.params.id, req.tenant.id);
        if (result.changes === 0) return res.status(404).json({ error: 'Prodotto non trovato' });
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting product:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Campaign Products API
app.get('/api/admin/campaigns/:id/products', requireAdmin, async (req, res) => {
    try {
        const dbConn = await getDb();
        const tenantId = await getTenantIdForApi(req);
        if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
        const products = await dbConn.all(`
            SELECT p.*, cp.created_at as assigned_at
            FROM products p
            INNER JOIN campaign_products cp ON p.id = cp.product_id
            INNER JOIN campaigns c ON c.id = cp.campaign_id
            WHERE cp.campaign_id = ? AND c.tenant_id = ? AND p.tenant_id = ?
            ORDER BY p.name
        `, req.params.id, tenantId, tenantId);
        res.json(products);
    } catch (error) {
        console.error('Error fetching campaign products:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/admin/campaigns/:id/products', requireAdmin, async (req, res) => {
    try {
        const { product_ids } = req.body;
        const dbConn = await getDb();
        const tenantId = await getTenantIdForApi(req);
        if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });

        // Verify campaign belongs to tenant
        const campaign = await dbConn.get('SELECT id FROM campaigns WHERE id = ? AND tenant_id = ?', req.params.id, tenantId);
        if (!campaign) return res.status(404).json({ error: 'Campagna non trovata' });

        // Remove existing associations
        await dbConn.run('DELETE FROM campaign_products WHERE campaign_id = ?', req.params.id);
        
        // Add new associations (only products in same tenant)
        if (product_ids && product_ids.length > 0) {
            for (const product_id of product_ids) {
                const prod = await dbConn.get('SELECT id FROM products WHERE id = ? AND tenant_id = ?', product_id, tenantId);
                if (prod) {
                    await dbConn.run(
                        'INSERT OR IGNORE INTO campaign_products (campaign_id, product_id) VALUES (?, ?)',
                        [req.params.id, product_id]
                    );
                }
            }
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating campaign products:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Admin page
app.get('/admin', requireAdmin, async (req, res) => {
    await redirectToTenantAwareRoute(req, res, '/admin');
});
app.get('/t/:tenantSlug/admin', tenantLoader, requireSameTenantAsSession, requireRole('admin'), (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'admin.html'));
});

app.get('/formsetup', requireAdmin, async (req, res) => {
    await redirectToTenantAwareRoute(req, res, '/formsetup');
});
app.get('/t/:tenantSlug/formsetup', tenantLoader, requireSameTenantAsSession, requireRole('admin'), (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'formsetup.html'));
});

app.get('/custom-fields', requireAdmin, async (req, res) => {
    await redirectToTenantAwareRoute(req, res, '/custom-fields');
});
app.get('/t/:tenantSlug/custom-fields', tenantLoader, requireSameTenantAsSession, requireRole('admin'), (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'custom-fields.html'));
});

// New canonical route for aesthetic personalization
app.get('/form-design', requireAdmin, async (req, res) => {
    await redirectToTenantAwareRoute(req, res, '/form-design');
});
app.get('/t/:tenantSlug/form-design', tenantLoader, requireSameTenantAsSession, requireRole('admin'), (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'form-design.html'));
});

// Legacy/Direct file URL redirects to canonical route
// Legacy redirects
app.get('/admin/form-setup', (req, res) => res.redirect('/form-design'));
app.get('/form-setup', (req, res) => res.redirect('/form-design'));
app.get('/views/form-setup.html', (req, res) => res.redirect('/form-design'));

// Legacy → tenant-prefixed redirects (controlled by flag)
if (ENFORCE_TENANT_PREFIX) {
    app.use((req, res, next) => {
        // Only redirect for known top-level pages
        const known = ['/admin', '/store', '/form-design', '/formsetup', '/custom-fields', '/admin/email-template', '/db-utenti', '/utenti', '/prodotti', '/analytics', '/thanks'];
        const pathOnly = req.path;
        if (known.includes(pathOnly) || pathOnly.startsWith('/redeem/')) {
            return res.redirect(302, `/t/${DEFAULT_TENANT_SLUG}${req.originalUrl}`);
        }
        return next();
    });
}

app.get('/admin/email-template', requireAdmin, async (req, res) => {
    await redirectToTenantAwareRoute(req, res, '/admin/email-template');
});
// Tenant-scoped email template APIs
app.get('/t/:tenantSlug/api/admin/email-template', tenantLoader, requireSameTenantAsSession, requireRole('admin'), async (req, res) => {
    try {
        const dbConn = await getDb();
        const tenantId = req.tenant.id;
        const row = await dbConn.get('SELECT subject, html, updated_at FROM email_template WHERE tenant_id = ?', tenantId);
        if (!row) {
            return res.json({ subject: 'Il tuo coupon', html: '', updated_at: null });
        }
        res.json(row);
    } catch (e) {
        console.error('Errore get email template (tenant):', e);
        res.status(500).json({ error: 'Errore server' });
    }
});

app.post('/t/:tenantSlug/api/admin/email-template', tenantLoader, requireSameTenantAsSession, requireRole('admin'), async (req, res) => {
    try {
        const { subject, html } = req.body || {};
        if (!subject || !html) {
            return res.status(400).json({ error: 'Subject e html sono richiesti' });
        }
        const dbConn = await getDb();
        const tenantId = req.tenant.id;
        
        // Check if template exists for this tenant
        const existing = await dbConn.get('SELECT id FROM email_template WHERE tenant_id = ?', tenantId);
        
        if (existing) {
            // Update existing template
            await dbConn.run(
                'UPDATE email_template SET subject = ?, html = ?, updated_at = datetime("now") WHERE tenant_id = ?',
                subject, html, tenantId
            );
        } else {
            // Create new template for tenant
            await dbConn.run(
                'INSERT INTO email_template (tenant_id, subject, html, updated_at) VALUES (?, ?, ?, datetime("now"))',
                tenantId, subject, html
            );
        }
        
        res.json({ success: true });
    } catch (e) {
        console.error('Errore save email template (tenant):', e);
        res.status(500).json({ error: 'Errore server' });
    }
});

app.get('/t/:tenantSlug/admin/email-template', tenantLoader, requireSameTenantAsSession, requireRole('admin'), (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'email-template.html'));
});

// Tenant-aware routes for auth-users are defined later (after line 4834)

app.get('/db-utenti', requireAdmin, async (req, res) => {
    await redirectToTenantAwareRoute(req, res, '/db-utenti');
});
app.get('/t/:tenantSlug/db-utenti', tenantLoader, requireSameTenantAsSession, requireRole('admin'), (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'db-utenti.html'));
});

// Utenti (gestione auth_users admin/store)
app.get('/utenti', requireAdmin, async (req, res) => {
    await redirectToTenantAwareRoute(req, res, '/utenti');
});
app.get('/t/:tenantSlug/utenti', tenantLoader, requireSameTenantAsSession, requireRole('admin'), (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'utenti.html'));
});

app.get('/prodotti', requireAdmin, async (req, res) => {
    await redirectToTenantAwareRoute(req, res, '/prodotti');
});
app.get('/t/:tenantSlug/prodotti', tenantLoader, requireSameTenantAsSession, requireRole('admin'), (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'prodotti.html'));
});

// Analytics page
app.get('/analytics', requireAdmin, async (req, res) => {
    await redirectToTenantAwareRoute(req, res, '/analytics');
});
app.get('/t/:tenantSlug/analytics', tenantLoader, requireSameTenantAsSession, requireRole('admin'), (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'analytics.html'));
});

// (moved 404 handler to the very end, before app.listen)

// Admin analytics: summary
app.get('/api/admin/analytics/summary', requireAdmin, async (req, res) => {
    try {
        const dbConn = await getDb();
        const tenantId = await getTenantIdForApi(req);
        if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
        
        const { start, end, campaignId, status } = req.query;

        const where = ['tenant_id = ?'];
        const params = [tenantId];
        if (campaignId) { where.push('campaign_id = ?'); params.push(campaignId); }
        if (start) { where.push('date(issued_at) >= date(?)'); params.push(start); }
        if (end) { where.push('date(issued_at) <= date(?)'); params.push(end); }
        if (status) { where.push('status = ?'); params.push(status); }
        const whereSql = 'WHERE ' + where.join(' AND ');

        const coupons = await dbConn.all(
            `SELECT discount_type AS discountType, discount_value AS discountValue, status, campaign_id AS campaignId, issued_at AS issuedAt, redeemed_at AS redeemedAt FROM coupons ${whereSql}`,
            params
        );
        const campaigns = await dbConn.all('SELECT id FROM campaigns WHERE tenant_id = ?', tenantId);

        // Build avg value/margin per campaign from associated products
        const rows = await dbConn.all(`
            SELECT cp.campaign_id AS campaignId, AVG(p.value) AS avgValue, AVG(p.margin_price) AS avgMargin
            FROM campaign_products cp
            JOIN products p ON p.id = cp.product_id
            GROUP BY cp.campaign_id
        `);
        const campaignAverages = new Map(rows.map(r => [r.campaignId, { avgValue: r.avgValue || 0, avgMargin: r.avgMargin || 0 }]));

        let totalIssued = coupons.length;
        let totalRedeemed = coupons.filter(c => c.status === 'redeemed').length;
        let estDiscountIssued = 0;
        let estDiscountRedeemed = 0;
        let estMarginGross = 0; // sum of avg margins for redeemed

        for (const c of coupons) {
            const avg = campaignAverages.get(c.campaignId) || { avgValue: 0, avgMargin: 0 };
            const base = Math.max(0, avg.avgValue || 0);
            const disc = c.discountType === 'percent' ? (base * (Number(c.discountValue) || 0) / 100) :
                         c.discountType === 'fixed' ? (Number(c.discountValue) || 0) : 0;
            estDiscountIssued += disc;
            if (c.status === 'redeemed') {
                estDiscountRedeemed += disc;
                estMarginGross += Math.max(0, avg.avgMargin || 0);
            }
        }

        res.json({
            totalCampaigns: campaigns.length,
            totalCouponsIssued: totalIssued,
            totalCouponsRedeemed: totalRedeemed,
            redemptionRate: totalIssued ? (totalRedeemed / totalIssued) : 0,
            estimatedDiscountIssued: estDiscountIssued,
            estimatedDiscountRedeemed: estDiscountRedeemed,
            estimatedGrossMarginOnRedeemed: estMarginGross,
            estimatedNetMarginAfterDiscount: Math.max(0, estMarginGross - estDiscountRedeemed)
        });
    } catch (e) {
        console.error('analytics/summary error', e);
        res.status(500).json({ error: 'Errore analytics' });
    }
});

// Admin analytics: per-campaign
app.get('/api/admin/analytics/campaigns', requireAdmin, async (req, res) => {
    try {
        const dbConn = await getDb();
        const tenantId = await getTenantIdForApi(req);
        if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
        
        const { start, end, campaignId, status } = req.query;
        const campaigns = await dbConn.all('SELECT id, name FROM campaigns WHERE tenant_id = ? ORDER BY created_at DESC', tenantId);

        const where = ['c.tenant_id = ?'];
        const params = [tenantId];
        if (campaignId) { where.push('c.campaign_id = ?'); params.push(campaignId); }
        if (start) { where.push('date(c.issued_at) >= date(?)'); params.push(start); }
        if (end) { where.push('date(c.issued_at) <= date(?)'); params.push(end); }
        if (status) { where.push('c.status = ?'); params.push(status); }
        const whereSql = 'WHERE ' + where.join(' AND ');

        const coupons = await dbConn.all(
            `SELECT c.campaign_id AS campaignId, c.discount_type AS discountType, c.discount_value AS discountValue, c.status FROM coupons c ${whereSql}`,
            params
        );
        const avgs = await dbConn.all(`
            SELECT cp.campaign_id AS campaignId, AVG(p.value) AS avgValue, AVG(p.margin_price) AS avgMargin
            FROM campaign_products cp
            JOIN products p ON p.id = cp.product_id AND p.tenant_id = ?
            JOIN campaigns c ON c.id = cp.campaign_id AND c.tenant_id = ?
            WHERE c.tenant_id = ?
            GROUP BY cp.campaign_id
        `, tenantId, tenantId, tenantId);
        const avgMap = new Map(avgs.map(r => [r.campaignId, { avgValue: r.avgValue || 0, avgMargin: r.avgMargin || 0 }]));

        const byCamp = new Map();
        for (const camp of campaigns) {
            byCamp.set(camp.id, { id: camp.id, name: camp.name, issued: 0, redeemed: 0, estDiscountIssued: 0, estDiscountRedeemed: 0, estGrossMarginRedeemed: 0 });
        }
        for (const c of coupons) {
            const bucket = byCamp.get(c.campaignId);
            if (!bucket) continue;
            const avg = avgMap.get(c.campaignId) || { avgValue: 0, avgMargin: 0 };
            const base = Math.max(0, avg.avgValue || 0);
            const disc = c.discountType === 'percent' ? (base * (Number(c.discountValue) || 0) / 100) :
                         c.discountType === 'fixed' ? (Number(c.discountValue) || 0) : 0;
            bucket.issued += 1;
            bucket.estDiscountIssued += disc;
            if (c.status === 'redeemed') {
                bucket.redeemed += 1;
                bucket.estDiscountRedeemed += disc;
                bucket.estGrossMarginRedeemed += Math.max(0, avg.avgMargin || 0);
            }
        }
        const result = Array.from(byCamp.values()).map(b => ({
            ...b,
            redemptionRate: b.issued ? (b.redeemed / b.issued) : 0,
            estNetMarginAfterDiscount: Math.max(0, b.estGrossMarginRedeemed - b.estDiscountRedeemed)
        }));
        res.json(result);
    } catch (e) {
        console.error('analytics/campaigns error', e);
        res.status(500).json({ error: 'Errore analytics' });
    }
});

// Admin analytics: temporal data for charts
app.get('/api/admin/analytics/temporal', requireAdmin, async (req, res) => {
    try {
        const dbConn = await getDb();
        const tenantId = await getTenantIdForApi(req);
        if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
        
        const { start, end, campaignId, status, groupBy = 'day' } = req.query;

        const where = ['c.tenant_id = ?'];
        const params = [tenantId];
        if (campaignId) { where.push('c.campaign_id = ?'); params.push(campaignId); }
        if (start) { where.push('date(c.issued_at) >= date(?)'); params.push(start); }
        if (end) { where.push('date(c.issued_at) <= date(?)'); params.push(end); }
        if (status) { where.push('c.status = ?'); params.push(status); }
        const whereSql = 'WHERE ' + where.join(' AND ');

        // Get temporal aggregation
        const dateFormat = groupBy === 'week' ? "strftime('%Y-W%W', c.issued_at)" : "date(c.issued_at)";
        const temporalData = await dbConn.all(`
            SELECT 
                ${dateFormat} as period,
                COUNT(*) as issued,
                SUM(CASE WHEN c.status = 'redeemed' THEN 1 ELSE 0 END) as redeemed,
                SUM(CASE WHEN c.status = 'redeemed' THEN 
                    CASE 
                        WHEN c.discount_type = 'percent' THEN (SELECT AVG(p.value) FROM campaign_products cp JOIN products p ON p.id = cp.product_id AND p.tenant_id = ? JOIN campaigns camp ON camp.id = cp.campaign_id AND camp.tenant_id = ? WHERE cp.campaign_id = c.campaign_id AND camp.tenant_id = ?) * (c.discount_value / 100.0)
                        WHEN c.discount_type = 'fixed' THEN c.discount_value
                        ELSE 0
                    END
                ELSE 0 END) as discount_applied,
                SUM(CASE WHEN c.status = 'redeemed' THEN 
                    (SELECT AVG(p.margin_price) FROM campaign_products cp JOIN products p ON p.id = cp.product_id AND p.tenant_id = ? JOIN campaigns camp ON camp.id = cp.campaign_id AND camp.tenant_id = ? WHERE cp.campaign_id = c.campaign_id AND camp.tenant_id = ?)
                ELSE 0 END) as gross_margin
            FROM coupons c
            ${whereSql}
            GROUP BY ${dateFormat}
            ORDER BY ${groupBy === 'week' ? "strftime('%Y', c.issued_at), strftime('%W', c.issued_at)" : "date(c.issued_at)"}
        `, tenantId, tenantId, tenantId, tenantId, tenantId, tenantId, ...params);

        res.json(temporalData);
    } catch (e) {
        console.error('analytics/temporal error', e);
        res.status(500).json({ error: 'Errore analytics temporali' });
    }
});

// Admin analytics: export CSV
app.get('/api/admin/analytics/export', requireAdmin, async (req, res) => {
    try {
        const dbConn = await getDb();
        const tenantId = await getTenantIdForApi(req);
        if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
        
        const { start, end, campaignId, status, format = 'csv' } = req.query;

        const where = ['c.tenant_id = ?'];
        const params = [tenantId];
        if (campaignId) { where.push('c.campaign_id = ?'); params.push(campaignId); }
        if (start) { where.push('date(c.issued_at) >= date(?)'); params.push(start); }
        if (end) { where.push('date(c.issued_at) <= date(?)'); params.push(end); }
        if (status) { where.push('c.status = ?'); params.push(status); }
        const whereSql = 'WHERE ' + where.join(' AND ');

        const data = await dbConn.all(`
            SELECT 
                c.code,
                c.status,
                c.issued_at as issued_at,
                c.redeemed_at as redeemed_at,
                camp.name as campaign_name,
                u.first_name,
                u.last_name,
                u.email,
                c.discount_type,
                c.discount_value,
                (SELECT AVG(p.value) FROM campaign_products cp JOIN products p ON p.id = cp.product_id AND p.tenant_id = ? JOIN campaigns camp2 ON camp2.id = cp.campaign_id AND camp2.tenant_id = ? WHERE cp.campaign_id = c.campaign_id AND camp2.tenant_id = ?) as avg_product_value,
                (SELECT AVG(p.margin_price) FROM campaign_products cp JOIN products p ON p.id = cp.product_id AND p.tenant_id = ? JOIN campaigns camp2 ON camp2.id = cp.campaign_id AND camp2.tenant_id = ? WHERE cp.campaign_id = c.campaign_id AND camp2.tenant_id = ?) as avg_margin
            FROM coupons c
            LEFT JOIN campaigns camp ON camp.id = c.campaign_id AND camp.tenant_id = c.tenant_id
            LEFT JOIN users u ON u.id = c.user_id AND u.tenant_id = c.tenant_id
            ${whereSql}
            ORDER BY c.issued_at DESC
        `, tenantId, tenantId, tenantId, tenantId, tenantId, tenantId, ...params);

        if (format === 'csv') {
            const headers = ['Code', 'Status', 'Issued At', 'Redeemed At', 'Campaign', 'First Name', 'Last Name', 'Email', 'Discount Type', 'Discount Value', 'Avg Product Value', 'Avg Margin'];
            const csvContent = [
                headers.join(','),
                ...data.map(row => [
                    row.code,
                    row.status,
                    row.issued_at,
                    row.redeemed_at || '',
                    `"${(row.campaign_name || '').replace(/"/g, '""')}"`,
                    `"${(row.first_name || '').replace(/"/g, '""')}"`,
                    `"${(row.last_name || '').replace(/"/g, '""')}"`,
                    `"${(row.email || '').replace(/"/g, '""')}"`,
                    row.discount_type,
                    row.discount_value,
                    row.avg_product_value || 0,
                    row.avg_margin || 0
                ].join(','))
            ].join('\n');

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename="analytics-export.csv"');
            res.send(csvContent);
        } else {
            res.json(data);
        }
    } catch (e) {
        console.error('analytics/export error', e);
        res.status(500).json({ error: 'Errore export' });
    }
});

// Admin auth users management (admin/store users) - tenant scoped by session
app.get('/api/admin/auth-users', requireAdmin, async (req, res) => {
    try {
        const sess = req.session && req.session.user;
        if (!sess || (sess.userType !== 'admin' && sess.userType !== 'superadmin')) return res.status(403).json({ error: 'Accesso negato' });
        const dbConn = await getDb();
        
        // Resolve tenant from path/referrer/session
        const tenantId = await getTenantIdForApi(req);
        
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
        console.error(e);
        res.status(500).json({ error: 'Errore server' });
    }
});

app.post('/api/admin/auth-users', requireAdmin, async (req, res) => {
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
            tenantId = await getTenantIdForApi(req);
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
        console.error(e);
        res.status(500).json({ error: 'Errore server' });
    }
});

app.put('/api/admin/auth-users/:id', requireAdmin, async (req, res) => {
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
            const tenantId = await getTenantIdForApi(req);
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
        console.error(e);
        res.status(500).json({ error: 'Errore server' });
    }
});

app.delete('/api/admin/auth-users/:id', requireAdmin, async (req, res) => {
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
            const tenantId = await getTenantIdForApi(req);
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
        console.error(e);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Duplicate routes removed - see routes above (after email-from-name)

// Account management routes (for current user)
app.get('/account', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'account.html'));
});

app.get('/t/:tenantSlug/account', tenantLoader, requireSameTenantAsSession, requireRole('admin'), (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'account.html'));
});

// Get current user profile
app.get('/api/account/profile', async (req, res) => {
    try {
        const sess = req.session && req.session.user;
        if (!sess) return res.status(401).json({ error: 'Non autenticato' });
        
        const dbConn = await getDb();
        const user = await dbConn.get(
            'SELECT id, username, user_type, is_active, created_at, last_login, first_name, last_name, email FROM auth_users WHERE id = ?',
            sess.authUserId || sess.id
        );
        
        if (!user) {
            return res.status(404).json({ error: 'Utente non trovato' });
        }
        
        res.json({
            id: user.id,
            username: user.username,
            userType: user.user_type,
            isActive: user.is_active,
            createdAt: user.created_at,
            lastLogin: user.last_login,
            firstName: user.first_name,
            lastName: user.last_name,
            email: user.email
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Update current user profile
app.put('/api/account/profile', async (req, res) => {
    try {
        const sess = req.session && req.session.user;
        if (!sess) return res.status(401).json({ error: 'Non autenticato' });
        
        const { firstName, lastName } = req.body;
        const dbConn = await getDb();
        
        // Update user profile (excluding email for security)
        await dbConn.run(
            'UPDATE auth_users SET first_name = ?, last_name = ? WHERE id = ?',
            firstName || null, lastName || null, sess.authUserId || sess.id
        );
        
        res.json({ success: true, message: 'Profilo aggiornato con successo' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Change current user password
app.put('/api/account/password', async (req, res) => {
    try {
        const sess = req.session && req.session.user;
        if (!sess) return res.status(401).json({ error: 'Non autenticato' });
        
        const { currentPassword, newPassword } = req.body;
        
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'Password attuale e nuova password sono richieste' });
        }
        
        // Validate new password strength
        if (newPassword.length < 8) {
            return res.status(400).json({ error: 'La nuova password deve essere di almeno 8 caratteri' });
        }
        
        if (!/[A-Z]/.test(newPassword)) {
            return res.status(400).json({ error: 'La nuova password deve contenere almeno una lettera maiuscola' });
        }
        
        if (!/[a-z]/.test(newPassword)) {
            return res.status(400).json({ error: 'La nuova password deve contenere almeno una lettera minuscola' });
        }
        
        if (!/\d/.test(newPassword)) {
            return res.status(400).json({ error: 'La nuova password deve contenere almeno un numero' });
        }
        
        const dbConn = await getDb();
        
        // Get current user and verify current password
        const user = await dbConn.get(
            'SELECT password_hash FROM auth_users WHERE id = ?',
            sess.authUserId || sess.id
        );
        
        if (!user) {
            return res.status(404).json({ error: 'Utente non trovato' });
        }
        
        const isCurrentPasswordValid = await verifyPassword(currentPassword, user.password_hash);
        if (!isCurrentPasswordValid) {
            return res.status(400).json({ error: 'Password attuale non corretta' });
        }
        
        // Update password
        const newPasswordHash = await hashPassword(newPassword);
        await dbConn.run(
            'UPDATE auth_users SET password_hash = ? WHERE id = ?',
            newPasswordHash, sess.authUserId || sess.id
        );
        
        res.json({ success: true, message: 'Password cambiata con successo' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Protected redemption page (QR link opens this for cashier)
app.use('/redeem', requireAuth);

app.get('/redeem/:code', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'redeem.html'));
});

// Tenant-prefixed redemption page (for multi-tenant routing)
app.use('/t/:tenantSlug/redeem', tenantLoader, requireAuth);

app.get('/t/:tenantSlug/redeem/:code', tenantLoader, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'redeem.html'));
});

// Health endpoints
app.get('/health', (req, res) => res.json({ ok: true }));
app.get('/healthz', async (req, res) => {
    try {
        const dbConn = await getDb();
        const row = await dbConn.get('SELECT 1 as ok');
        if (row && row.ok === 1) return res.json({ ok: true });
        return res.status(500).json({ ok: false });
    } catch (e) {
        return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
});

// Super admin API endpoints
app.get('/api/superadmin/stats', requireSuperAdmin, async (req, res) => {
    try {
        if (req.session.user.userType !== 'superadmin') {
            return res.status(403).json({ error: 'Accesso negato' });
        }
        
        const db = await getDb();
        
        const [totalTenants, totalUsers, totalCampaigns, totalCoupons] = await Promise.all([
            db.get('SELECT COUNT(*) as count FROM tenants'),
            db.get('SELECT COUNT(*) as count FROM auth_users'),
            db.get('SELECT COUNT(*) as count FROM campaigns'),
            db.get('SELECT COUNT(*) as count FROM coupons')
        ]);
        
        res.json({
            totalTenants: totalTenants.count,
            totalUsers: totalUsers.count,
            totalCampaigns: totalCampaigns.count,
            totalCoupons: totalCoupons.count
        });
    } catch (error) {
        console.error('Error fetching super admin stats:', error);
        res.status(500).json({ error: 'Errore interno del server' });
    }
});

app.get('/api/superadmin/tenants', requireSuperAdmin, async (req, res) => {
    try {
        if (req.session.user.userType !== 'superadmin') {
            return res.status(403).json({ error: 'Accesso negato' });
        }
        
        const db = await getDb();
        const tenants = await db.all(`
            SELECT t.*, 
                   COUNT(au.id) as user_count
            FROM tenants t
            LEFT JOIN auth_users au ON t.id = au.tenant_id
            GROUP BY t.id
            ORDER BY t.created_at DESC
        `);
        
        res.json(tenants);
    } catch (error) {
        console.error('Error fetching tenants:', error);
        res.status(500).json({ error: 'Errore interno del server' });
    }
});

// Superadmin: dry-run resolve email settings for a tenant (no send)
app.get('/api/superadmin/tenants/:id/email/resolve', requireSuperAdmin, async (req, res) => {
    try {
        const tenantId = Number(req.params.id);
        if (!Number.isFinite(tenantId)) return res.status(400).json({ error: 'ID tenant non valido' });
        const dbConn = await getDb();
        const tenant = await dbConn.get('SELECT email_from_name, email_from_address, mailgun_domain, mailgun_region FROM tenants WHERE id = ?', tenantId);
        if (!tenant) return res.status(404).json({ error: 'Tenant non trovato' });
        const from = buildTenantEmailFrom(tenant);
        const domain = getTenantMailgunDomain(tenant);
        res.json({ from, domain });
    } catch (e) {
        console.error('Error resolving tenant email settings:', e);
        res.status(500).json({ error: 'Errore interno del server' });
    }
});

// Superadmin: send test email for a tenant using its settings
app.post('/api/superadmin/tenants/:id/test-email', requireSuperAdmin, async (req, res) => {
    try {
        const tenantId = Number(req.params.id);
        if (!Number.isFinite(tenantId)) return res.status(400).json({ error: 'ID tenant non valido' });
        const to = (req.body?.to || req.query?.to || process.env.MAIL_TEST_TO || 'test@example.com');
        const dbConn = await getDb();
        const tenant = await dbConn.get('SELECT email_from_name, email_from_address, mailgun_domain, mailgun_region, name FROM tenants WHERE id = ?', tenantId);
        if (!tenant) return res.status(404).json({ error: 'Tenant non trovato' });

        const senderName = tenant.email_from_name || (tenant.name || 'CouponGen');
        const message = {
            from: buildTenantEmailFrom(tenant),
            to,
            subject: `Test Email - ${senderName}`,
            html: `<p>Test email da ${senderName} (tenant ${tenantId}).</p>`,
            mailgunDomain: getTenantMailgunDomain(tenant)
        };
        const info = await transporter.sendMail(message);
        res.json({ ok: true, info, from: message.from, domain: message.mailgunDomain });
    } catch (e) {
        console.error('Superadmin test email error:', e);
        res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
});

// Superadmin: get email sender settings for a tenant
app.get('/api/superadmin/tenants/:id/email', requireSuperAdmin, async (req, res) => {
    try {
        if (!req.session?.user || req.session.user.userType !== 'superadmin') {
            return res.status(403).json({ error: 'Accesso negato' });
        }
        const tenantId = Number(req.params.id);
        if (!Number.isFinite(tenantId)) return res.status(400).json({ error: 'ID tenant non valido' });
        const dbConn = await getDb();
        const row = await dbConn.get('SELECT email_from_name, email_from_address, mailgun_domain, mailgun_region, custom_domain FROM tenants WHERE id = ?', tenantId);
        if (!row) return res.status(404).json({ error: 'Tenant non trovato' });
        res.json(row);
    } catch (e) {
        console.error('Error fetching tenant email settings:', e);
        res.status(500).json({ error: 'Errore interno del server' });
    }
});

// Superadmin: update email sender settings for a tenant
app.put('/api/superadmin/tenants/:id/email', requireSuperAdmin, async (req, res) => {
    try {
        if (!req.session?.user || req.session.user.userType !== 'superadmin') {
            return res.status(403).json({ error: 'Accesso negato' });
        }
        const tenantId = Number(req.params.id);
        if (!Number.isFinite(tenantId)) return res.status(400).json({ error: 'ID tenant non valido' });
        const { email_from_name, email_from_address, mailgun_domain, mailgun_region, custom_domain } = req.body || {};
        // Basic normalization
        const name = (email_from_name || '').toString().trim();
        const addr = (email_from_address || '').toString().trim();
        const mgDomain = (mailgun_domain || '').toString().trim();
        const mgRegion = (mailgun_region || '').toString().trim();
        const hostDomain = (custom_domain || '').toString().trim();
        const dbConn = await getDb();
        await dbConn.run(
            `UPDATE tenants SET 
                email_from_name = COALESCE(?, email_from_name),
                email_from_address = COALESCE(NULLIF(?, ''), email_from_address),
                mailgun_domain = COALESCE(NULLIF(?, ''), mailgun_domain),
                mailgun_region = COALESCE(NULLIF(?, ''), mailgun_region),
                custom_domain = COALESCE(NULLIF(?, ''), custom_domain),
                updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [ name || null, addr || null, mgDomain || null, mgRegion || null, hostDomain || null, tenantId ]
        );
        await logAction(req, 'update', `Email settings aggiornati per tenant ${tenantId}`);
        res.json({ success: true });
    } catch (e) {
        console.error('Error updating tenant email settings:', e);
        res.status(500).json({ error: 'Errore interno del server' });
    }
});

// Superadmin: get brand settings for a tenant
app.get('/api/superadmin/tenants/:id/brand', requireSuperAdmin, async (req, res) => {
    try {
        if (!req.session?.user || req.session.user.userType !== 'superadmin') {
            return res.status(403).json({ error: 'Accesso negato' });
        }
        const tenantId = Number(req.params.id);
        if (!Number.isFinite(tenantId)) return res.status(400).json({ error: 'ID tenant non valido' });
        const dbConn = await getDb();
        const row = await dbConn.get('SELECT * FROM tenant_brand_settings WHERE tenant_id = ?', tenantId);
        if (!row) return res.json({});
        res.json({
            primary_color: row.primary_color,
            accent_color: row.accent_color,
            light_color: row.light_color,
            background_color: row.background_color,
            text_dark_color: row.text_dark_color
        });
    } catch (e) {
        console.error('Error fetching brand settings:', e);
        res.status(500).json({ error: 'Errore interno del server' });
    }
});

// Superadmin: upsert brand settings (create or full update)
app.post('/api/superadmin/tenants/:id/brand', requireSuperAdmin, async (req, res) => {
    try {
        if (!req.session?.user || req.session.user.userType !== 'superadmin') {
            return res.status(403).json({ error: 'Accesso negato' });
        }
        const tenantId = Number(req.params.id);
        if (!Number.isFinite(tenantId)) return res.status(400).json({ error: 'ID tenant non valido' });
        const {
            primary_color = '#2d5a3d',
            accent_color = '#4a7c59',
            light_color = '#e8f5e8',
            background_color = '#faf8f3',
            text_dark_color = '#2c3e50'
        } = req.body || {};
        const dbConn = await getDb();
        await dbConn.run(
            `INSERT INTO tenant_brand_settings (tenant_id, primary_color, accent_color, light_color, background_color, text_dark_color, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
             ON CONFLICT(tenant_id) DO UPDATE SET 
               primary_color = excluded.primary_color,
               accent_color = excluded.accent_color,
               light_color = excluded.light_color,
               background_color = excluded.background_color,
               text_dark_color = excluded.text_dark_color,
               updated_at = datetime('now')`,
            tenantId, primary_color, accent_color, light_color, background_color, text_dark_color
        );
        await logAction(req, 'update', `Brand settings aggiornati per tenant ${tenantId}`, 'success', { tenantId });
        res.json({ success: true });
    } catch (e) {
        console.error('Error upserting brand settings:', e);
        res.status(500).json({ error: 'Errore interno del server' });
    }
});

// Superadmin: partial update brand settings
app.put('/api/superadmin/tenants/:id/brand', requireSuperAdmin, async (req, res) => {
    try {
        if (!req.session?.user || req.session.user.userType !== 'superadmin') {
            return res.status(403).json({ error: 'Accesso negato' });
        }
        const tenantId = Number(req.params.id);
        if (!Number.isFinite(tenantId)) return res.status(400).json({ error: 'ID tenant non valido' });
        const dbConn = await getDb();
        const existing = await dbConn.get('SELECT * FROM tenant_brand_settings WHERE tenant_id = ?', tenantId);
        const current = existing || {
            primary_color: '#2d5a3d',
            accent_color: '#4a7c59',
            light_color: '#e8f5e8',
            background_color: '#faf8f3',
            text_dark_color: '#2c3e50'
        };
        const updated = {
            primary_color: req.body?.primary_color ?? current.primary_color,
            accent_color: req.body?.accent_color ?? current.accent_color,
            light_color: req.body?.light_color ?? current.light_color,
            background_color: req.body?.background_color ?? current.background_color,
            text_dark_color: req.body?.text_dark_color ?? current.text_dark_color
        };
        await dbConn.run(
            `INSERT INTO tenant_brand_settings (tenant_id, primary_color, accent_color, light_color, background_color, text_dark_color, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
             ON CONFLICT(tenant_id) DO UPDATE SET 
               primary_color = excluded.primary_color,
               accent_color = excluded.accent_color,
               light_color = excluded.light_color,
               background_color = excluded.background_color,
               text_dark_color = excluded.text_dark_color,
               updated_at = datetime('now')`,
            tenantId, updated.primary_color, updated.accent_color, updated.light_color, updated.background_color, updated.text_dark_color
        );
        await logAction(req, 'update', `Brand settings aggiornati (parziali) per tenant ${tenantId}`, 'success', { tenantId });
        res.json({ success: true });
    } catch (e) {
        console.error('Error partial updating brand settings:', e);
        res.status(500).json({ error: 'Errore interno del server' });
    }
});

// Tenant-scoped: public read brand settings
app.get('/t/:tenantSlug/api/brand-settings', tenantLoader, async (req, res) => {
    try {
        const dbConn = await getDb();
        const row = await dbConn.get('SELECT * FROM tenant_brand_settings WHERE tenant_id = ?', req.tenant.id);
        if (!row) return res.json({});
        res.json({
            primary_color: row.primary_color,
            accent_color: row.accent_color,
            light_color: row.light_color,
            background_color: row.background_color,
            text_dark_color: row.text_dark_color
        });
    } catch (e) {
        console.error('Error fetching tenant brand settings (public):', e);
        res.json({});
    }
});
// Super admin: create new tenant
app.post('/api/superadmin/tenants', requireSuperAdmin, async (req, res) => {
    try {
        if (req.session.user.userType !== 'superadmin') {
            return res.status(403).json({ error: 'Accesso negato' });
        }
        
        const { tenantName, tenantSlug, adminUsername, adminPassword, emailFromName } = req.body || {};
        
        // Validation
        if (!tenantName || !adminUsername || !adminPassword) {
            return res.status(400).json({ error: 'tenantName, adminUsername e adminPassword sono richiesti' });
        }
        
        const db = await getDb();
        await ensureTenantEmailColumns(db);
        const slug = toSlug(tenantSlug || tenantName);
        
        // Check slug uniqueness
        const existing = await db.get('SELECT id FROM tenants WHERE slug = ?', slug);
        if (existing) {
            return res.status(409).json({ error: 'Slug tenant già in uso' });
        }
        
        // Check admin username uniqueness (globalmente o per tenant)
        const existingAdmin = await db.get('SELECT id FROM auth_users WHERE username = ?', adminUsername);
        if (existingAdmin) {
            return res.status(409).json({ error: 'Username già in uso' });
        }
        
        // Create tenant
        // Defaults for new tenants: use global Mailgun settings as baseline
        const defaultFromEnv = (process.env.MAIL_FROM || process.env.MAILGUN_FROM || 'CouponGen <no-reply@send.coupongen.it>');
        const nameFromEnv = defaultFromEnv.replace(/\s*<[^>]+>\s*$/, '') || 'CouponGen';
        const defaultMailgunDomain = process.env.MAILGUN_DOMAIN || null;
        const defaultMailgunRegion = process.env.MAILGUN_REGION || null;

        const resultTenant = await db.run(
            'INSERT INTO tenants (slug, name, email_from_name, mailgun_domain, mailgun_region) VALUES (?, ?, ?, ?, ?)', 
            slug, 
            tenantName,
            emailFromName || nameFromEnv,
            defaultMailgunDomain,
            defaultMailgunRegion
        );
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
        
        await db.run(
            'INSERT INTO email_template (tenant_id, subject, html) VALUES (?, ?, ?)',
            newTenantId, 
            'Il tuo coupon', 
            defaultTemplateHtml
        );
        
        // Create first admin user
        const adminPasswordHash = await hashPassword(adminPassword);
        await db.run(
            'INSERT INTO auth_users (username, password_hash, user_type, is_active, tenant_id) VALUES (?, ?, ?, 1, ?)',
            adminUsername, 
            adminPasswordHash, 
            'admin', 
            newTenantId
        );
        
        // Log tenant creation
        await logAction(req, 'create', `Nuovo tenant creato dal Super Admin: ${tenantName}`, 'success', {
            tenantName: tenantName,
            tenantSlug: slug,
            adminUsername: adminUsername,
            tenantId: newTenantId,
            createdBy: req.session.user.username
        });
        
        // Return created tenant info
        const createdTenant = await db.get('SELECT * FROM tenants WHERE id = ?', newTenantId);
        res.json({ 
            success: true, 
            tenant: {
                id: createdTenant.id,
                name: createdTenant.name,
                slug: createdTenant.slug,
                created_at: createdTenant.created_at
            },
            message: `Tenant "${tenantName}" creato con successo`
        });
    } catch (error) {
        console.error('Error creating tenant:', error);
        res.status(500).json({ error: 'Errore durante la creazione del tenant' });
    }
});

app.post('/api/superadmin/login', async (req, res) => {
    try {
        const { username, password } = req.body || {};
        
        if (!username || !password) {
            return res.status(400).json({ error: 'Username e password sono richiesti' });
        }
        
        const db = await getDb();
        
        // Find user by username
        const user = await db.get('SELECT * FROM auth_users WHERE username = ? AND user_type = ?', username, 'superadmin');
        
        if (!user) {
            return res.status(401).json({ error: 'Credenziali non valide' });
        }
        
        // Check if user is active
        if (!user.is_active) {
            return res.status(401).json({ error: 'Account disattivato' });
        }
        
        // Verify password (with backward compatibility for Base64)
        const isValid = await verifyPassword(password, user.password_hash);
        if (!isValid) {
            return res.status(401).json({ error: 'Credenziali non valide' });
        }
        
        // If using legacy Base64 hash, upgrade to bcrypt on successful login
        if (!user.password_hash.startsWith('$2a$') && !user.password_hash.startsWith('$2b$') && !user.password_hash.startsWith('$2y$')) {
            try {
                const newHash = await hashPassword(password);
                await db.run('UPDATE auth_users SET password_hash = ? WHERE id = ?', newHash, user.id);
            } catch (upgradeError) {
                console.error('Error upgrading password hash:', upgradeError);
                // Continue with login even if upgrade fails
            }
        }
        
        // User is already verified as superadmin by the query above
        
        // Create session
        await new Promise((resolve, reject) => req.session.regenerate(err => err ? reject(err) : resolve()));
        
        req.session.user = {
            id: user.id,
            username: user.username,
            userType: user.user_type,
            tenantId: user.tenant_id,
            isSuperAdmin: true
        };
        
        // Update last login
        await db.run('UPDATE auth_users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', user.id);
        
        // Log successful superadmin login
        await logAction(req, 'login', 'Login SuperAdmin effettuato', 'success', {
            username: user.username,
            userType: user.user_type
        });
        
        res.json({ success: true, message: 'Login effettuato con successo' });
    } catch (error) {
        console.error('Superadmin login error:', error);
        res.status(500).json({ error: 'Errore interno del server' });
    }
});

app.get('/api/superadmin/admin-users', requireSuperAdmin, async (req, res) => {
    try {
        if (req.session.user.userType !== 'superadmin') {
            return res.status(403).json({ error: 'Accesso negato' });
        }
        
        const db = await getDb();
        
        // Get all admin users (not superadmin) with their tenant information
        const adminUsers = await db.all(`
            SELECT 
                au.id,
                au.username,
                au.user_type,
                au.is_active,
                au.created_at,
                au.last_login,
                t.name as tenant_name,
                t.slug as tenant_slug,
                t.id as tenant_id
            FROM auth_users au
            LEFT JOIN tenants t ON au.tenant_id = t.id
            WHERE au.user_type = 'admin'
            ORDER BY au.created_at DESC
        `);
        
        res.json(adminUsers);
    } catch (error) {
        console.error('Error fetching admin users:', error);
        res.status(500).json({ error: 'Errore interno del server' });
    }
});

// Superadmin: update admin/store users across tenants
app.put('/api/superadmin/admin-users/:id', requireSuperAdmin, async (req, res) => {
    try {
        const sess = req.session && req.session.user;
        if (!sess || sess.userType !== 'superadmin') {
            return res.status(403).json({ error: 'Accesso negato' });
        }
        const { username, password, user_type, is_active } = req.body || {};
        const role = user_type ? String(user_type).toLowerCase() : undefined;
        if (role && !['admin', 'store'].includes(role)) {
            return res.status(400).json({ error: 'Ruolo non valido' });
        }
        const db = await getDb();
        const target = await db.get('SELECT * FROM auth_users WHERE id = ?', req.params.id);
        if (!target) return res.status(404).json({ error: 'Utente non trovato' });
        if (target.user_type === 'superadmin') return res.status(400).json({ error: 'Operazione non consentita' });

        const fields = [];
        const params = [];
        if (typeof username !== 'undefined' && username !== target.username) {
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
            const newHash = await hashPassword(password);
            params.push(newHash);
        }
        if (fields.length === 0) return res.json({ ok: true });
        params.push(req.params.id);
        await db.run(`UPDATE auth_users SET ${fields.join(', ')} WHERE id = ?`, ...params);
        return res.json({ ok: true });
    } catch (e) {
        if (String(e && e.message || '').includes('UNIQUE')) {
            return res.status(400).json({ error: 'Username già esistente' });
        }
        console.error(e);
        return res.status(500).json({ error: 'Errore server' });
    }
});

// Superadmin: delete admin/store users across tenants
app.delete('/api/superadmin/admin-users/:id', requireSuperAdmin, async (req, res) => {
    try {
        const sess = req.session && req.session.user;
        if (!sess || sess.userType !== 'superadmin') {
            return res.status(403).json({ error: 'Accesso negato' });
        }
        const db = await getDb();
        const target = await db.get('SELECT * FROM auth_users WHERE id = ?', req.params.id);
        if (!target) return res.status(404).json({ error: 'Utente non trovato' });
        if (target.user_type === 'superadmin') return res.status(400).json({ error: 'Operazione non consentita' });
        await db.run('DELETE FROM auth_users WHERE id = ?', req.params.id);
        return res.json({ ok: true });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: 'Errore server' });
    }
});

// Admin: read brand settings for current session tenant (legacy routes support)
app.get('/api/admin/brand-settings', requireAdmin, async (req, res) => {
    try {
        const sess = req.session && req.session.user;
        if (!sess || (!sess.tenantId && !sess.tenantSlug)) {
            return res.json({});
        }
        const dbConn = await getDb();
        const tenant = sess.tenantId
            ? { id: sess.tenantId }
            : await dbConn.get('SELECT id FROM tenants WHERE slug = ?', sess.tenantSlug);
        if (!tenant || !tenant.id) return res.json({});
        const row = await dbConn.get('SELECT * FROM tenant_brand_settings WHERE tenant_id = ?', tenant.id);
        if (!row) return res.json({});
        res.json({
            primary_color: row.primary_color,
            accent_color: row.accent_color,
            light_color: row.light_color,
            background_color: row.background_color,
            text_dark_color: row.text_dark_color
        });
    } catch (e) {
        console.error('Error fetching session tenant brand settings:', e);
        res.json({});
    }
});

// Store: read brand settings for current session tenant (legacy store routes support)
app.get('/api/store/brand-settings', requireStore, async (req, res) => {
    try {
        const sess = req.session && req.session.user;
        if (!sess || (!sess.tenantId && !sess.tenantSlug)) {
            return res.json({});
        }
        const dbConn = await getDb();
        const tenant = sess.tenantId
            ? { id: sess.tenantId }
            : await dbConn.get('SELECT id FROM tenants WHERE slug = ?', sess.tenantSlug);
        if (!tenant || !tenant.id) return res.json({});
        const row = await dbConn.get('SELECT * FROM tenant_brand_settings WHERE tenant_id = ?', tenant.id);
        if (!row) return res.json({});
        res.json({
            primary_color: row.primary_color,
            accent_color: row.accent_color,
            light_color: row.light_color,
            background_color: row.background_color,
            text_dark_color: row.text_dark_color
        });
    } catch (e) {
        console.error('Error fetching store tenant brand settings:', e);
        res.json({});
    }
});

// Superadmin brand settings page
app.get('/superadmin/tenants/:id/brand', requireSuperAdmin, async (req, res) => {
    try {
        if (!req.session || !req.session.user || req.session.user.userType !== 'superadmin') {
            return res.redirect('/superadmin-login');
        }
        res.sendFile(path.join(__dirname, 'views', 'superadmin-tenant-brand.html'));
    } catch (e) {
        console.error('Error serving brand page:', e);
        res.status(500).send('Errore interno');
    }
});

app.get('/api/superadmin/logs', requireSuperAdmin, async (req, res) => {
    try {
        if (req.session.user.userType !== 'superadmin') {
            return res.status(403).json({ error: 'Accesso negato' });
        }
        
        const db = await getDb();
        
        // Parse query parameters
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const offset = (page - 1) * limit;
        
        // Build WHERE clause based on filters
        let whereConditions = [];
        let params = [];
        
        if (req.query.tenant_id) {
            whereConditions.push('sl.tenant_id = ?');
            params.push(req.query.tenant_id);
        }
        
        if (req.query.username) {
            whereConditions.push('sl.username LIKE ?');
            params.push(`%${req.query.username}%`);
        }
        
        if (req.query.action_type) {
            whereConditions.push('sl.action_type = ?');
            params.push(req.query.action_type);
        }
        
        if (req.query.level) {
            whereConditions.push('sl.level = ?');
            params.push(req.query.level);
        }
        
        if (req.query.date_from) {
            whereConditions.push('DATE(sl.timestamp) >= ?');
            params.push(req.query.date_from);
        }
        
        if (req.query.date_to) {
            whereConditions.push('DATE(sl.timestamp) <= ?');
            params.push(req.query.date_to);
        }
        
        const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';
        
        // Get total count
        const countQuery = `
            SELECT COUNT(*) as total 
            FROM system_logs sl 
            ${whereClause}
        `;
        const countResult = await db.get(countQuery, params);
        const total = countResult.total;
        
        // Get logs with pagination
        const logsQuery = `
            SELECT 
                sl.id,
                sl.timestamp,
                sl.user_id,
                sl.username,
                sl.user_type,
                sl.tenant_id,
                sl.tenant_name,
                sl.tenant_slug,
                sl.action_type,
                sl.action_description,
                sl.level,
                sl.details,
                sl.ip_address,
                sl.user_agent
            FROM system_logs sl
            ${whereClause}
            ORDER BY sl.timestamp DESC
            LIMIT ? OFFSET ?
        `;
        
        const logs = await db.all(logsQuery, [...params, limit, offset]);
        
        // Get stats by level
        const statsQuery = `
            SELECT 
                level,
                COUNT(*) as count
            FROM system_logs sl
            ${whereClause}
            GROUP BY level
        `;
        
        const statsResult = await db.all(statsQuery, params);
        const stats = {
            total: total,
            info: 0,
            warning: 0,
            error: 0,
            success: 0
        };
        
        statsResult.forEach(stat => {
            if (stats.hasOwnProperty(stat.level)) {
                stats[stat.level] = stat.count;
            }
        });
        
        // Handle CSV export
        if (req.query.export === 'csv') {
            const csvQuery = `
                SELECT 
                    sl.timestamp,
                    sl.username,
                    sl.user_type,
                    sl.tenant_name,
                    sl.tenant_slug,
                    sl.action_type,
                    sl.action_description,
                    sl.level,
                    sl.details,
                    sl.ip_address
                FROM system_logs sl
                ${whereClause}
                ORDER BY sl.timestamp DESC
            `;
            
            const csvLogs = await db.all(csvQuery, params);
            
            // Convert to CSV
            const csvHeader = 'Timestamp,Username,User Type,Tenant Name,Tenant Slug,Action Type,Action Description,Level,Details,IP Address\n';
            const csvRows = csvLogs.map(log => [
                new Date(log.timestamp).toISOString(),
                log.username || '',
                log.user_type || '',
                log.tenant_name || '',
                log.tenant_slug || '',
                log.action_type || '',
                (log.action_description || '').replace(/"/g, '""'),
                log.level || '',
                (log.details || '').replace(/"/g, '""'),
                log.ip_address || ''
            ].map(field => `"${field}"`).join(',')).join('\n');
            
            const csv = csvHeader + csvRows;
            
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="logs_${new Date().toISOString().split('T')[0]}.csv"`);
            return res.send(csv);
        }
        
        const totalPages = Math.ceil(total / limit);
        
        res.json({
            logs: logs,
            total: total,
            page: page,
            totalPages: totalPages,
            stats: stats
        });
        
    } catch (error) {
        console.error('Error fetching logs:', error);
        res.status(500).json({ error: 'Errore interno del server' });
    }
});

app.delete('/api/superadmin/tenants/:id', requireSuperAdmin, async (req, res) => {
    const db = await getDb();
    
    try {
        if (!req.session || !req.session.user || req.session.user.userType !== 'superadmin') {
            return res.status(403).json({ error: 'Accesso negato' });
        }
        
        const tenantId = parseInt(req.params.id);
        if (isNaN(tenantId)) {
            return res.status(400).json({ error: 'ID tenant non valido' });
        }
        
        // Get tenant info before deletion
        const tenant = await db.get('SELECT * FROM tenants WHERE id = ?', tenantId);
        if (!tenant) {
            return res.status(404).json({ error: 'Tenant non trovato' });
        }
        
        // Use transaction to ensure atomicity
        // Temporarily disable foreign key constraints for safe deletion
        const isDevelopment = process.env.NODE_ENV !== 'production';
        if (isDevelopment) {
            console.log(`[DELETE TENANT] Starting deletion of tenant ${tenantId} (${tenant.name})`);
        }
        
        // Ensure WAL is checkpointed before starting transaction
        try {
            await db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
            if (isDevelopment) {
                console.log(`[DELETE TENANT] WAL checkpoint completed`);
            }
        } catch (checkpointError) {
            console.warn(`[DELETE TENANT] WAL checkpoint warning:`, checkpointError.message);
            // Continue anyway
        }
        
        await db.exec('PRAGMA foreign_keys = OFF');
        await db.exec('BEGIN TRANSACTION');
        
        try {
            // Delete all related data (cascading delete)
            // Order matters: delete child tables first, then parent tables
            
            // Helper function to check if a table has a specific column
            const tableHasColumn = async (tableName, columnName) => {
                try {
                    const columns = await db.all(`PRAGMA table_info(${tableName})`);
                    return columns.some(col => col.name === columnName);
                } catch (err) {
                    console.error(`[DELETE] Error checking columns for ${tableName}:`, err.message);
                    return false;
                }
            };
            
            // Helper function to safely delete from a table if it exists
            const safeDelete = async (tableName, whereClause, params = [], fallbackQuery = null) => {
                try {
                    if (isDevelopment) {
                        console.log(`[DELETE] Checking table: ${tableName}`);
                    }
                    // Check if table exists
                    const tableExists = await db.get(
                        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
                        tableName
                    );
                    if (!tableExists) {
                        if (isDevelopment) {
                            console.log(`[DELETE] Table ${tableName} does not exist, skipping`);
                        }
                        return;
                    }
                    
                    // Check if the where clause uses tenant_id and if the column exists
                    if (whereClause.includes('tenant_id')) {
                        const hasTenantId = await tableHasColumn(tableName, 'tenant_id');
                        if (!hasTenantId && fallbackQuery) {
                            if (isDevelopment) {
                                console.log(`[DELETE] Table ${tableName} does not have tenant_id, using fallback query`);
                            }
                            const result = await db.run(fallbackQuery, params);
                            if (isDevelopment && result.changes > 0) {
                                console.log(`[DELETE] Deleted from ${tableName} using fallback, changes: ${result.changes}`);
                            }
                            return;
                        } else if (!hasTenantId) {
                            if (isDevelopment) {
                                console.log(`[DELETE] Table ${tableName} does not have tenant_id column and no fallback, skipping`);
                            }
                            return;
                        }
                    }
                    
                    if (isDevelopment) {
                        console.log(`[DELETE] Table ${tableName} exists, executing delete with params:`, params);
                    }
                    const result = await db.run(`DELETE FROM ${tableName} WHERE ${whereClause}`, params);
                    if (isDevelopment && result.changes > 0) {
                        console.log(`[DELETE] Deleted from ${tableName} for tenant ${tenantId}, changes: ${result.changes}`);
                    }
                } catch (err) {
                    console.error(`[DELETE] Error deleting from ${tableName}:`, err.message);
                    console.error(`[DELETE] Error stack:`, err.stack);
                    throw err;
                }
            };
            
            // 1. Delete campaign_products first (if table exists)
            if (isDevelopment) {
                console.log(`[DELETE TENANT] Checking for campaigns with tenant_id ${tenantId}`);
            }
            const campaignIds = await db.all('SELECT id FROM campaigns WHERE tenant_id = ?', tenantId);
            if (isDevelopment) {
                console.log(`[DELETE TENANT] Found ${campaignIds ? campaignIds.length : 0} campaigns`);
            }
            if (campaignIds && campaignIds.length > 0) {
                const ids = campaignIds.map(c => c.id);
                if (isDevelopment) {
                    console.log(`[DELETE TENANT] Campaign IDs to delete from campaign_products:`, ids);
                }
                // Check if campaign_products table exists first
                const cpTableExists = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='campaign_products'");
                if (cpTableExists) {
                    const placeholders = ids.map(() => '?').join(',');
                    await safeDelete('campaign_products', `campaign_id IN (${placeholders})`, ids);
                } else if (isDevelopment) {
                    console.log(`[DELETE TENANT] campaign_products table does not exist, skipping`);
                }
            }
            
            // 2. Delete data that depends on users first
            // For user_custom_data, if it doesn't have tenant_id, delete via users relationship
            await safeDelete(
                'user_custom_data', 
                'tenant_id = ?', 
                [tenantId],
                'DELETE FROM user_custom_data WHERE user_id IN (SELECT id FROM users WHERE tenant_id = ?)'
            );
            await safeDelete('coupons', 'tenant_id = ?', [tenantId]);
            
            // 3. Delete users and auth_users
            await safeDelete('users', 'tenant_id = ?', [tenantId]);
            await safeDelete('auth_users', 'tenant_id = ?', [tenantId]);
            
            // 4. Delete campaigns
            await safeDelete('campaigns', 'tenant_id = ?', [tenantId]);
            
            // 5. Delete email templates
            await safeDelete('email_template', 'tenant_id = ?', [tenantId]);
            
            // 6. Delete products if table exists and has tenant_id
            const productsCheck = await db.all("PRAGMA table_info(products)").catch(() => []);
            if (productsCheck.some(col => col.name === 'tenant_id')) {
                await safeDelete('products', 'tenant_id = ?', [tenantId]);
            }
            
            // 7. Finally delete the tenant itself
            if (isDevelopment) {
                console.log(`[DELETE TENANT] Deleting tenant record with id ${tenantId}`);
            }
            await db.run('DELETE FROM tenants WHERE id = ?', tenantId);
            
            // Commit transaction
            await db.exec('COMMIT');
            await db.exec('PRAGMA foreign_keys = ON');
            
            // Log tenant deletion (after successful deletion)
            // Note: tenant is already deleted, so we use the saved tenant info
            try {
                await logAction(req, 'delete', `Tenant eliminato: ${tenant.name}`, 'warning', {
                    tenantId: tenantId,
                    tenantName: tenant.name,
                    tenantSlug: tenant.slug
                });
            } catch (logError) {
                console.error(`[DELETE TENANT] Error logging deletion (non-critical):`, logError.message);
                // Don't fail the request if logging fails
            }
            
            // Always log successful deletion (important for audit)
            console.log(`[DELETE TENANT] Tenant ${tenantId} (${tenant.name}) deleted successfully`);
            res.json({ success: true, message: 'Tenant eliminato con successo' });
        } catch (deleteError) {
            // Rollback on error
            try {
                await db.exec('ROLLBACK');
            } catch (rollbackError) {
                console.error('Rollback error:', rollbackError);
            }
            try {
                await db.exec('PRAGMA foreign_keys = ON');
            } catch (fkError) {
                console.error('Foreign keys re-enable error:', fkError);
            }
            throw deleteError;
        }
    } catch (error) {
        console.error('Error deleting tenant:', error);
        console.error('Error stack:', error.stack);
        const errorMessage = error.message || 'Errore interno del server';
        // In development, send more details about the error
        const errorDetails = process.env.NODE_ENV !== 'production' 
            ? { message: errorMessage, stack: error.stack } 
            : { message: errorMessage };
        res.status(500).json({ error: errorMessage, details: errorDetails });
    }
});

// Global error handler (must be before 404 handler)
app.use((error, req, res, next) => {
    // Skip if response already sent
    if (res.headersSent) {
        return next(error);
    }
    
    // Log error with context using logger
    const logContext = logger.withRequest(req);
    logContext.error({
        err: error,
        message: error.message,
        stack: error.stack,
        statusCode: error.status || error.statusCode || 500
    }, 'Unhandled error in request handler');
    
    // Determine status code
    let statusCode = error.status || error.statusCode || 500;
    if (statusCode < 400 || statusCode >= 600) {
        statusCode = 500;
    }
    
    // Prepare error response
    const isDevelopment = process.env.NODE_ENV === 'development';
    const errorResponse = {
        error: 'Errore interno del server',
        message: statusCode === 500 && !isDevelopment 
            ? 'Si è verificato un errore. Riprova più tardi.' 
            : error.message || 'Errore interno del server',
        statusCode
    };
    
    // Include stack trace only in development
    if (isDevelopment && error.stack) {
        errorResponse.stack = error.stack;
    }
    
    // Send error response
    res.status(statusCode).json(errorResponse);
});

// 404 handler (must be last): serve friendly not-found page
app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, 'views', '404.html'));
});

// Start server with proper timeout configurations
const server = app.listen(PORT, async () => {
    await getDb();
    logger.info({ port: PORT }, 'CouponGen server started');
});

// Configure server timeouts to prevent connection issues
// Note: requestTimeout and timeout are the same setting (requestTimeout is deprecated)
const KEEP_ALIVE_TIMEOUT = Number(process.env.SERVER_KEEPALIVE_TIMEOUT) || 65000; // 65 seconds (same as nginx default)
const HEADERS_TIMEOUT = Number(process.env.SERVER_HEADERS_TIMEOUT) || 66000; // 66 seconds (slightly higher than keepAliveTimeout)
const REQUEST_TIMEOUT = Number(process.env.SERVER_REQUEST_TIMEOUT) || 30000; // 30 seconds for request processing

server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT;
server.headersTimeout = HEADERS_TIMEOUT;
server.timeout = REQUEST_TIMEOUT; // Overall request timeout

    logger.info({
        keepAliveTimeout: server.keepAliveTimeout,
        headersTimeout: server.headersTimeout,
        requestTimeout: server.timeout
    }, 'Server timeouts configured');
console.log(`- Headers: ${server.headersTimeout}ms`);
console.log(`- Request/Overall: ${server.timeout}ms`);

// Graceful shutdown handler
let isShuttingDown = false;

async function gracefulShutdown(signal) {
    if (isShuttingDown) {
        console.log(`[shutdown] Already shutting down, ignoring ${signal}`);
        return;
    }
    
    isShuttingDown = true;
    console.log(`[shutdown] Received ${signal}, initiating graceful shutdown...`);
    
    // Stop accepting new requests
    server.close(() => {
        console.log('[shutdown] HTTP server closed');
    });
    
    // Close database connection
    if (db) {
        try {
            await db.close();
            console.log('[shutdown] Database connection closed');
        } catch (error) {
            console.error('[shutdown] Error closing database:', error);
        }
    }
    
    // Clear intervals
    if (cleanupInterval) {
        clearInterval(cleanupInterval);
        console.log('[shutdown] Cleanup intervals cleared');
    }
    
    // Force exit after timeout if graceful shutdown takes too long
    setTimeout(() => {
        console.error('[shutdown] Graceful shutdown timeout, forcing exit');
        process.exit(1);
    }, 10000); // 10 seconds timeout
    
    // Exit cleanly
    console.log('[shutdown] Graceful shutdown complete');
    process.exit(0);
}

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions and unhandled rejections
process.on('uncaughtException', (error) => {
    logger.fatal({ err: error, stack: error.stack }, 'Uncaught exception - shutting down');
    gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
    logger.fatal({ reason, promise, stack: reason?.stack }, 'Unhandled rejection - shutting down');
    gracefulShutdown('unhandledRejection');
});

