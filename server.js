'use strict';

/**
 * FLYCouponGen - Express Server Entry Point
 * 
 * This file sets up the Express application with all middleware, routes, and error handlers.
 * 
 * IMPORTANT: Middleware order matters! The order below is critical for security and functionality:
 * 1. Trust proxy (for HTTPS detection behind reverse proxy)
 * 2. HTTPS enforcement (redirect HTTP to HTTPS in production)
 * 3. Body parsing (JSON, URL-encoded)
 * 4. Cookie parser
 * 5. JSON parsing error handler
 * 6. Static file serving
 * 7. Request ID and logging middleware
 * 8. Session middleware (must be before routes that use sessions)
 * 9. Security headers (helmet.js - CSP, HSTS, etc.)
 * 10. CORS middleware
 * 11. Auth routes setup
 * 12. Admin routes setup
 * 13. CSRF token endpoint
 * 14. CSRF protection middleware (for protected routes)
 * 15. Public routes (form submission, etc.)
 * 16. Admin panel routes
 * 17. Error handlers (must be last)
 * 
 * @see {@link LLM_MD/CONFIGURATION.md} for environment variables documentation
 * @see {@link LLM_MD/TYPES.md} for type definitions
 * @see {@link docs/ARCHITECTURE.md} for architecture overview
 */

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
// Security headers
const helmet = require('helmet');

/**
 * Generate random alphanumeric ID
 * 
 * Used for generating request IDs, coupon codes, and other unique identifiers.
 * 
 * @param {number} [length=12] - Length of generated ID
 * @returns {string} Random alphanumeric string (uppercase letters and numbers)
 */
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

// ============================================================================
// SECTION 1: Trust Proxy Configuration
// ============================================================================
// Trust proxy for HTTPS detection (when behind Nginx/load balancer)
// This allows req.secure to work correctly when behind a reverse proxy
app.set('trust proxy', 1);

// ============================================================================
// SECTION 2: HTTPS Enforcement
// ============================================================================
// Redirect HTTP to HTTPS in production for transport layer security
// This middleware must be early in the chain to catch all HTTP requests
const isProduction = process.env.NODE_ENV === 'production';
const FORCE_HTTPS = String(process.env.FORCE_HTTPS || 'true') === 'true';

if (isProduction && FORCE_HTTPS) {
    app.use((req, res, next) => {
        // Check if request is secure (HTTPS) or forwarded as secure
        const isSecure = req.secure || 
                        req.headers['x-forwarded-proto'] === 'https' ||
                        req.headers['x-forwarded-ssl'] === 'on';
        
        if (!isSecure) {
            // Redirect to HTTPS
            const httpsUrl = `https://${req.headers.host}${req.originalUrl}`;
            return res.redirect(301, httpsUrl);
        }
        next();
    });
    logger.info('HTTPS enforcement enabled: HTTP requests will be redirected to HTTPS');
}

// ============================================================================
// SECTION 3: Configuration Constants
// ============================================================================
const DEFAULT_TENANT_SLUG = process.env.DEFAULT_TENANT_SLUG || 'default';
const DEFAULT_TENANT_NAME = process.env.DEFAULT_TENANT_NAME || 'Default Tenant';
const ENFORCE_TENANT_PREFIX = String(process.env.ENFORCE_TENANT_PREFIX || 'false') === 'true';

// ============================================================================
// SECTION 4: Body Parsing Middleware
// ============================================================================
// Parse request bodies (must be before routes that read req.body)
app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: '15mb' }));
app.use(cookieParser());

// ============================================================================
// SECTION 5: Error Handling Middleware (Early)
// ============================================================================
// Handle JSON parsing errors (must be after body parsing middleware)
app.use((error, req, res, next) => {
    if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
        logger.warn({ err: error, message: error.message }, 'JSON parsing error in request body');
        return res.status(400).json({ success: false, message: 'JSON non valido' });
    }
    next();
});

// ============================================================================
// SECTION 6: Static File Serving
// ============================================================================
// Configure uploads directory (uploads are served via protected endpoint, not public static)
const UPLOADS_BASE_DIR = process.env.UPLOADS_DIR
    ? path.resolve(process.env.UPLOADS_DIR)
    : path.join(__dirname, 'static', 'uploads');
if (!fs.existsSync(UPLOADS_BASE_DIR)) {
    fs.mkdirSync(UPLOADS_BASE_DIR, { recursive: true });
}
// Uploads are served via /api/uploads/:tenantSlug/:filename endpoint below

// Serve static files with cache control
// Static files (CSS, JS, images) are served from /static directory
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

// Auth routes moved to routes/auth.js
const { setupAuthRoutes, logAction, hashPassword, verifyPassword, toSlug } = require('./routes/auth');

// ============================================================================
// SECTION 7: Request Logging Middleware
// ============================================================================
// Generate request ID and log all requests with structured logging
// This middleware must be early to capture all requests
app.use((req, res, next) => {
    req.requestId = generateId(10);
    const startedAt = Date.now();
    res.on('finish', () => {
        const durationMs = Date.now() - startedAt;
        const tenantPart = req.tenant ? req.tenant.slug : (req.session?.user?.tenantSlug || '-');
        logger.info({
            requestId: req.requestId,
            method: req.method,
            path: req.originalUrl,
            status: res.statusCode,
            durationMs,
            tenant: tenantPart
        }, 'request');
    });
    next();
});

// Rate limiting middleware moved to middleware/rateLimit.js

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

// tenantLoader, requireSameTenantAsSession, requireRole moved to middleware/

// ============================================================================
// SECTION 8: Session Configuration
// ============================================================================
// Configure Express session middleware (must be before routes that use sessions)
// Session store: in-memory (Redis optional for scaling/multi-instance)
// 
// Security features:
// - Secure random session secret (required in production)
// - HttpOnly cookies (prevents XSS access to session cookie)
// - Secure cookies in production (HTTPS only)
// - SameSite: lax (CSRF protection)
// - Rolling: false (session timeout doesn't reset on each request)
// - Proxy: true (trust proxy headers for secure detection)

/**
 * Generate secure random session secret
 * 
 * @returns {string} 128-character hex string
 */
const generateSecureSecret = () => {
    return crypto.randomBytes(64).toString('hex');
};

let sessionSecret = process.env.SESSION_SECRET;

// In production, SESSION_SECRET is REQUIRED - block startup if missing
if (isProduction) {
    if (!sessionSecret || sessionSecret === 'your-secret-key-change-in-production' || sessionSecret === 'coupon-gen-secret-key-change-in-production') {
        logger.error({
            missing: true
        }, 'FATAL ERROR: SESSION_SECRET is REQUIRED in production but not set or using default value. Set SESSION_SECRET in .env file before starting the server.');
        process.exit(1);
    }
} else {
    // In development, generate random secret if not provided (with warning)
    if (!sessionSecret || sessionSecret === 'your-secret-key-change-in-production' || sessionSecret === 'coupon-gen-secret-key-change-in-production') {
        sessionSecret = generateSecureSecret();
        logger.warn({
            generated: true,
            secretPreview: sessionSecret.substring(0, 16) + '...'
        }, 'SECURITY WARNING: SESSION_SECRET not set or using default value. A random secret has been generated for this session only. MUST set SESSION_SECRET in .env for production!');
    }
}

// Session timeout configuration (default: 24 hours, configurable via SESSION_TIMEOUT_MS)
const SESSION_TIMEOUT_MS = Number(process.env.SESSION_TIMEOUT_MS || 24 * 60 * 60 * 1000);

let sessionOptions = {
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    name: 'sessionId', // Don't expose framework name (not 'connect.sid')
    cookie: {
        secure: isProduction ? true : 'auto', // Force secure in production
        httpOnly: true, // Prevent XSS access to cookie
        sameSite: isProduction ? 'lax' : 'lax', // CSRF protection
        maxAge: SESSION_TIMEOUT_MS,
        path: '/'
    },
    // Additional security options
    rolling: false, // Don't reset expiration on every request (more secure)
    proxy: true // Trust proxy headers for secure detection
};
app.use(session(sessionOptions));

// ============================================================================
// SECTION 9: Security Headers Middleware
// ============================================================================
// Configure helmet.js for HTTP security headers
// Must be after session middleware but before routes
// 
// Headers configured:
// - Content-Security-Policy (CSP): Enabled in production, disabled in development
// - HSTS: HTTP Strict Transport Security (production only)
// - X-Frame-Options: DENY (prevents clickjacking)
// - X-Content-Type-Options: nosniff (prevents MIME sniffing)
// - Referrer-Policy: strict-origin-when-cross-origin
// - X-XSS-Protection: Enabled
// - Expect-CT: Certificate Transparency (production only)
app.use(helmet({
    contentSecurityPolicy: isProduction ? {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"], // Allow inline styles for compatibility
            scriptSrc: ["'self'", "'unsafe-inline'", "https://www.google.com", "https://www.gstatic.com"], // reCAPTCHA
            imgSrc: ["'self'", "data:", "https:"], // Allow data URLs for QR codes and images
            connectSrc: ["'self'"],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            frameSrc: ["'none'"],
        },
    } : false, // Disable CSP in development for easier debugging
    hsts: isProduction ? {
        maxAge: 31536000, // 1 year
        includeSubDomains: true,
        preload: true
    } : false, // Only enable HSTS in production
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    frameguard: { action: 'deny' }, // Prevent clickjacking
    noSniff: true, // Prevent MIME type sniffing
    xssFilter: true, // Enable XSS filter
    permittedCrossDomainPolicies: false,
    expectCt: isProduction ? {
        maxAge: 86400,
        enforce: true
    } : false
}));

// ============================================================================
// SECTION 10: CORS Configuration
// ============================================================================
// Configure Cross-Origin Resource Sharing
// Must be after security headers, before routes
// 
// Behavior:
// - Production: Only allows explicitly configured origins (ALLOWED_ORIGINS env var)
// - Development: Allows all origins if ALLOWED_ORIGINS is empty, otherwise uses whitelist
// - Supports credentials (cookies, auth headers) for whitelisted origins
const { corsMiddleware } = require('./middleware/cors');
app.use(corsMiddleware);

// ============================================================================
// SECTION 11: Route Setup
// ============================================================================
// Setup all application routes
// Order matters: auth routes before admin routes (some admin routes depend on auth)

// Setup auth routes (must be after session middleware)
setupAuthRoutes(app);

// Setup admin routes (campaigns, users, coupons, analytics, etc.)
const { setupAdminRoutes } = require('./routes/admin');
setupAdminRoutes(app);

// ============================================================================
// SECTION 12: CSRF Token Endpoint
// ============================================================================
// Endpoint to generate CSRF tokens for frontend
// Must be after session middleware but before CSRF protection middleware
// This endpoint needs CSRF middleware to generate token, but is itself exempt from protection
app.get(['/api/csrf-token','/t/:tenantSlug/api/csrf-token'], (req, res, next) => {
    // Apply csrfProtection just for this route to generate token
    csrfProtection(req, res, () => {
        try {
            const token = req.csrfToken ? req.csrfToken() : null;
            const hasSession = req.session && req.session.id;
            logger.debug({ token: token ? token.substring(0, 20) + '...' : null, hasSession }, '[CSRF] GET /api/csrf-token - Token generated');
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

// Super admin page will be defined before /admin middleware

// Database utilities (extracted to utils/db.js)
const { getDb, ensureTenantEmailColumns, ensureFormCustomizationTenantId, ensureTenantScopedUniqueConstraints } = require('./utils/db');

// Email utilities (extracted to utils/email.js)
const { buildTransport, buildTenantEmailFrom, getTenantMailgunDomain, parseMailFrom, transporter } = require('./utils/email');

// QR Code utilities (extracted to utils/qrcode.js)
const { generateQRDataURL, generateQRBuffer } = require('./utils/qrcode');

// Middleware (extracted to middleware/)
const { requireAuth, requireAdmin, requireSuperAdmin, requireStore, requireRole } = require('./middleware/auth');
const { tenantLoader, requireSameTenantAsSession, getTenantIdForApi } = require('./middleware/tenant');
const { checkLoginRateLimit, recordLoginFailure, recordLoginSuccess, checkSubmitRateLimit, startCleanupInterval } = require('./middleware/rateLimit');
const { csrfProtection, csrfIfProtectedRoute } = require('./middleware/csrf');

// Start cleanup interval for rate limiters
startCleanupInterval();

// Attach CSRF middleware for protected routes (mutating authenticated endpoints)
app.use(csrfIfProtectedRoute);

// Database connection (managed by utils/db.js)
let db; // Will be set by getDb() from utils/db.js

// Legacy database setup - now using utils/db.js
// Keep for backward compatibility during transition
const DATA_DIR = process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR);
}

// Database setup - DEPRECATED: Use getDb() from utils/db.js instead
// This code is kept temporarily for reference but will be removed
/*
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
        CREATE TABLE IF NOT EXISTS form_links (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            campaign_id INTEGER NOT NULL,
            token TEXT NOT NULL UNIQUE,
            used_at DATETIME,
            coupon_id INTEGER,
            tenant_id INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_form_links_token ON form_links(token);
        CREATE INDEX IF NOT EXISTS idx_form_links_campaign_id ON form_links(campaign_id);
        CREATE INDEX IF NOT EXISTS idx_form_links_tenant_id ON form_links(tenant_id);

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
            logger.info({ slug: DEFAULT_TENANT_SLUG }, 'Created default tenant');
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
            logger.info('Migrating discount_percent to discount_value...');
            await db.exec('UPDATE coupons SET discount_value = CAST(discount_percent AS TEXT) WHERE discount_value = "10"');
            logger.info('Removing old discount_percent column...');
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
            logger.info({ count: existingCampaigns.length }, 'Found campaigns without campaign_code');
            for (const campaign of existingCampaigns) {
                const campaignCode = generateId(12);
                await db.run('UPDATE campaigns SET campaign_code = ? WHERE id = ?', campaignCode, campaign.id);
                logger.debug({ campaignId: campaign.id, campaignCode }, 'Generated campaign_code');
            }
            
            // Don't create global unique index - will be created as tenant-scoped by ensureTenantScopedUniqueConstraints
            // This ensures tenant isolation for campaign codes
        } else {
            logger.debug('campaign_code column already exists');
            
            // Check if there are campaigns without campaign_code
            const campaignsWithoutCode = await db.all('SELECT id FROM campaigns WHERE campaign_code IS NULL');
            if (campaignsWithoutCode.length > 0) {
                logger.info({ count: campaignsWithoutCode.length }, 'Found campaigns without campaign_code, generating codes...');
                for (const campaign of campaignsWithoutCode) {
                    const campaignCode = generateId(12).toUpperCase();
                    await db.run('UPDATE campaigns SET campaign_code = ? WHERE id = ?', campaignCode, campaign.id);
                    logger.debug({ campaignId: campaign.id, campaignCode }, 'Generated campaign_code');
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
                        logger.debug({ campaignId: campaign.id }, 'Migrated form config for campaign');
                    }
                } catch (e) {
                    logger.warn({ campaignId: campaign.id, error: e.message }, 'Skipping migration for campaign');
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
*/

// parseMailFrom moved to utils/email.js
// ensureTenantEmailColumns, ensureFormCustomizationTenantId, ensureTenantScopedUniqueConstraints moved to utils/db.js

// getTenantIdForApi moved to middleware/tenant.js

// transporter moved to utils/email.js

// Startup visibility: log which email transport is active
try {
    const transportLabel =
        (transporter && transporter.options && transporter.options.provider)
            || (transporter && transporter.options && transporter.options.jsonTransport ? 'json' : null)
            || (transporter && transporter.options && transporter.options.host ? `smtp:${transporter.options.host}` : 'unknown');
    logger.info({ transport: transportLabel }, 'Email transport configured');
} catch (_) {}

// toSlug, logAction, verifyPassword, hashPassword moved to routes/auth.js and imported above

// requireAuth, requireAdmin moved to middleware/auth.js

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
        logger.withRequest(req).error({ err: error }, 'Error redirecting');
        return res.status(500).send('Errore nel reindirizzamento.');
    }
}

// requireSuperAdmin, requireStore moved to middleware/auth.js

// verifyPassword, hashPassword moved to routes/auth.js (and will be moved to utils/ later)

// Helper function to check if a user is the first admin of their tenant
async function isFirstAdmin(dbConn, userId, tenantId) {
    const firstAdmin = await dbConn.get(
        'SELECT id FROM auth_users WHERE tenant_id = ? AND user_type = ? ORDER BY created_at ASC LIMIT 1',
        tenantId, 'admin'
    );
    return firstAdmin && firstAdmin.id === parseInt(userId);
}

// Auth routes moved to routes/auth.js

// Tenant-scoped logout API for convenience
app.post('/t/:tenantSlug/api/logout', tenantLoader, (req, res) => {
    if (req.session) {
        req.session.destroy((err) => {
            if (err) {
                logger.withRequest(req).error({ err }, 'Logout error');
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
        logger.withRequest(req).error({ err: e }, 'Error getting tenant info');
        res.status(500).json({ error: 'Errore server' });
    }
});

// Logout and login GET routes moved to routes/auth.js

// Store login page
app.get('/store-login', (req, res) => {
    // If already logged in as store, redirect to store page
    if (req.session && req.session.user && req.session.user.userType === 'store') {
        const base = req.session.user.tenantSlug ? `/t/${req.session.user.tenantSlug}` : '';
        return res.redirect(base + '/store');
    }
    res.sendFile(path.join(__dirname, 'views', 'store-login.html'));
});

// Settings routes moved to routes/admin/settings.js

// Local-only: test coupon email with QR inline/allegato (no auth)
app.get('/api/test-coupon-email', async (req, res) => {
    try {
        if ((process.env.NODE_ENV || 'development') === 'production') {
            return res.status(403).json({ ok: false, error: 'Disabled in production' });
        }
        const to = req.query.to || process.env.MAIL_TEST_TO || 'test@example.com';
        const firstName = req.query.firstName || 'Test';
        const lastName = req.query.lastName || 'User';
        const couponCode = 'TEST' + Math.random().toString(36).slice(2, 8).toUpperCase();
        const discountText = 'uno sconto del 20%';
        const redemptionUrl = `${req.protocol}://${req.get('host')}/redeem/${couponCode}`;

        const qrDataUrl = await generateQRDataURL(redemptionUrl, { width: 300, margin: 2 });
        const qrPngBuffer = await generateQRBuffer(redemptionUrl, { width: 300, margin: 2, type: 'png' });

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

// Settings routes moved to routes/admin/settings.js

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
        logger.withRequest(req).error({ err: error }, 'Error serving upload');
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
        logger.withRequest(req).error({ err: error }, 'Error serving upload');
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
        logger.withRequest(req).error({ err: error }, 'Errore caricamento configurazione form');
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
        logger.withRequest(req).error({ err: error }, 'Errore caricamento configurazione form');
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
            logger.withRequest(req).warn('Body non valido o vuoto');
            return res.status(400).json({ success: false, message: 'Body della richiesta non valido' });
        }
        
        const dbConn = await getDb();
        await ensureFormCustomizationTenantId(dbConn);
        const tenantId = req.session.user.tenantId;
        if (!tenantId) {
            return res.status(400).json({ error: 'Tenant non valido' });
        }
        
        const configData = JSON.stringify(req.body);
        logger.debug({ configData }, 'Config data da salvare');
        
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
        
        logger.info('Configurazione salvata con successo (pubblico)');
        res.json({ success: true, message: 'Configurazione salvata con successo!' });
    } catch (error) {
        logger.withRequest(req).error({ err: error }, 'Errore salvataggio configurazione form');
        res.status(500).json({ success: false, message: 'Errore durante il salvataggio della configurazione' });
    }
});

// Views
// Homepage for root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'home.html'));
});

// API endpoint to check if default tenant exists (for homepage CTA)
app.get('/api/check-default-tenant', async (req, res) => {
    try {
        const db = await getDb();
        const tenant = await db.get('SELECT slug FROM tenants WHERE slug = ?', DEFAULT_TENANT_SLUG);
        res.json({
            hasDefaultTenant: !!tenant,
            tenantSlug: tenant ? tenant.slug : null
        });
    } catch (error) {
        logger.error({ err: error }, 'Error checking default tenant');
        res.json({ hasDefaultTenant: false, tenantSlug: null });
    }
});

// Public form - support for campaign parameter (deprecated, use /t/:tenantSlug)
app.get('/form', (req, res) => {
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
const { validateBody } = require('./middleware/validation');
const { formSubmissionSchema } = require('./utils/validators');

app.post('/t/:tenantSlug/submit', tenantLoader, checkSubmitRateLimit, verifyRecaptchaIfEnabled, validateBody(formSubmissionSchema), async (req, res) => {
    try {
        // Data is already validated and sanitized by validateBody middleware
        const { email, firstName, lastName, campaign_id, form_token, ...customFields } = req.body;
        const couponCode = generateId(12);

        const dbConn = await getDb();
        
        let discountType = 'percent';
        let discountValue = process.env.DEFAULT_DISCOUNT_PERCENT || '10';
        let campaignId = null;
        let specificCampaign = null;
        let formLinkId = null;
        
        // Check if form token is provided (new parametric form link)
        if (form_token) {
            const logContext = logger.withRequest(req);
            const tokenShort = form_token.substring(0, 10) + '...';
            logger.debug({ form_token: tokenShort }, '[FORM_LINK] Starting form link submission');
            
            // SIMPLIFIED APPROACH: Atomic UPDATE first, then validate
            // This ensures the link is marked as used atomically before any other checks
            const usedAtTimestamp = new Date().toISOString();
            
            // Step 1: Try to mark link as used atomically (this is the critical operation)
            // This UPDATE will only succeed if the link exists, belongs to this tenant, and is not already used
            const markUsedResult = await dbConn.run(
                `UPDATE form_links 
                 SET used_at = ? 
                 WHERE token = ? 
                   AND tenant_id = ? 
                   AND used_at IS NULL`,
                usedAtTimestamp, form_token, req.tenant.id
            );
            
            logger.debug({ changes: markUsedResult.changes, lastID: markUsedResult.lastID }, '[FORM_LINK] Atomic UPDATE result');
            
            // Step 2: If UPDATE failed (0 changes), determine why
            if (markUsedResult.changes === 0) {
                // Check if link exists at all
                const linkCheck = await dbConn.get(
                    'SELECT id, used_at, tenant_id, campaign_id FROM form_links WHERE token = ?',
                    form_token
                );
                
                if (!linkCheck) {
                    logger.warn({ form_token: tokenShort }, '[FORM_LINK] Link not found');
                    return res.status(400).send('Link non valido');
                }
                
                if (linkCheck.tenant_id !== req.tenant.id) {
                    logger.warn({ form_token: tokenShort, tenantId: linkCheck.tenant_id }, '[FORM_LINK] Link belongs to different tenant');
                    return res.status(400).send('Link non valido per questo tenant');
                }
                
                if (linkCheck.used_at) {
                    logger.warn({ form_token: tokenShort, used_at: linkCheck.used_at }, '[FORM_LINK] Link already used');
                    logContext.warn({ form_token: tokenShort, linkId: linkCheck.id, used_at: linkCheck.used_at }, 'Form link already used');
                    return res.status(400).send('Link già utilizzato');
                }
                
                // Should not reach here, but handle it
                logger.warn({ form_token: tokenShort }, '[FORM_LINK] UPDATE failed for unknown reason');
                return res.status(400).send('Link non valido');
            }
            
            logger.debug({ form_token: tokenShort, changes: markUsedResult.changes }, '[FORM_LINK] Link marked as used successfully');
            
            // Step 3: Get form link and campaign info (link is now marked as used)
            const formLink = await dbConn.get(
                `SELECT fl.id, fl.token, fl.used_at, fl.campaign_id, fl.tenant_id, 
                 c.campaign_code, c.name, c.description, c.is_active, c.discount_type, 
                 c.discount_value, c.form_config, c.expiry_date, c.tenant_id as campaign_tenant_id
                 FROM form_links fl 
                 JOIN campaigns c ON c.id = fl.campaign_id 
                 WHERE fl.token = ? AND fl.tenant_id = ?`,
                form_token, req.tenant.id
            );
            
            if (!formLink) {
                logContext.error({ form_token: tokenShort, markUsedResult }, '[FORM_LINK] CRITICAL: Link not found after UPDATE');
                logContext.error({ form_token: tokenShort, markUsedResult }, 'Form link not found after marking as used');
                return res.status(500).send('Errore nel recupero del link');
            }
            
            logger.debug({ formLinkId: formLink.id, used_at: formLink.used_at, campaign_id: formLink.campaign_id }, '[FORM_LINK] Form link retrieved');
            
            // Step 4: Verify the link is actually marked as used
            if (!formLink.used_at) {
                logContext.error({ formLinkId: formLink.id, form_token: tokenShort }, '[FORM_LINK] CRITICAL: Link not marked as used after UPDATE');
                logContext.error({ formLinkId: formLink.id, form_token: tokenShort }, 'Form link not marked as used after UPDATE');
                // Try to mark it again (without the IS NULL check since we know it should be null)
                await dbConn.run(
                    'UPDATE form_links SET used_at = ? WHERE id = ?',
                    usedAtTimestamp, formLink.id
                );
            }
            
            // Step 5: Check if campaign is active and not expired
            if (!formLink.is_active) {
                logger.warn({ campaign_id: formLink.campaign_id }, '[FORM_LINK] Campaign not active');
                return res.status(400).send('Questo coupon non esiste o è scaduto');
            }
            
            if (formLink.expiry_date && new Date(formLink.expiry_date) < new Date()) {
                logger.warn({ campaign_id: formLink.campaign_id }, '[FORM_LINK] Campaign expired');
                // Auto-deactivate expired campaign
                await dbConn.run('UPDATE campaigns SET is_active = 0 WHERE id = ?', formLink.campaign_id);
                return res.status(400).send('Questo coupon non esiste o è scaduto');
            }
            
            // Step 6: Set campaign data for coupon creation
            specificCampaign = {
                id: formLink.campaign_id,
                campaign_code: formLink.campaign_code,
                tenant_id: formLink.campaign_tenant_id || formLink.tenant_id,
                form_config: formLink.form_config
            };
            discountType = formLink.discount_type;
            discountValue = formLink.discount_value;
            campaignId = formLink.campaign_id;
            formLinkId = formLink.id;
            
            logger.debug({ formLinkId: formLink.id, used_at: formLink.used_at }, '[FORM_LINK] Form link processing completed');
            logContext.info({ 
                formLinkId: formLink.id,
                campaignId: formLink.campaign_id,
                used_at: formLink.used_at
            }, '[FORM_LINK] Form link processing completed successfully');
        } else if (campaign_id) {
            // Legacy: Resolve campaign by code (use tenant from campaign to scope user/coupon)
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

        // Verify specificCampaign is set
        if (!specificCampaign || !specificCampaign.tenant_id) {
            return res.status(400).send('Campagna non valida');
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

        const couponResult = await dbConn.run(
            'INSERT INTO coupons (code, user_id, campaign_id, discount_type, discount_value, status, tenant_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
            couponCode, userId, campaignId, discountType, discountValue, 'active', specificCampaign.tenant_id
        );
        
        // Update form_link with coupon_id if form_token was used
        if (formLinkId) {
            await dbConn.run(
                'UPDATE form_links SET coupon_id = ? WHERE id = ?',
                couponResult.lastID, formLinkId
            );
        }

        // Redemption URL per staff cassa; il QR deve puntare a questa pagina
        const redemptionUrl = `${req.protocol}://${req.get('host')}/redeem/${couponCode}`;
        // Generate QR both as DataURL (for web preview) and as PNG buffer for email inline attachment
        const qrDataUrl = await generateQRDataURL(redemptionUrl, { width: 300, margin: 2 });
        const qrPngBuffer = await generateQRBuffer(redemptionUrl, { width: 300, margin: 2, type: 'png' });

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

        // Remove "Vai alla Cassa" button if present in template (cleanup from DB)
        // This removes buttons/links with "Vai alla Cassa" text, including emoji variations
        // Match various HTML patterns that might contain the button
        const buttonPatterns = [
            // Link with "Vai alla Cassa" text (case insensitive, with optional emoji)
            /<a[^>]*>[\s\S]*?(?:🚀\s*)?[\s\S]*?Vai\s+alla\s+Cassa[\s\S]*?<\/a>/gi,
            // Button element
            /<button[^>]*>[\s\S]*?(?:🚀\s*)?[\s\S]*?Vai\s+alla\s+Cassa[\s\S]*?<\/button>/gi,
            // Div containing link with button styling
            /<div[^>]*>[\s\S]*?<a[^>]*>[\s\S]*?(?:🚀\s*)?[\s\S]*?Vai\s+alla\s+Cassa[\s\S]*?<\/a>[\s\S]*?<\/div>/gi,
            // Paragraph containing the button
            /<p[^>]*>[\s\S]*?<a[^>]*>[\s\S]*?(?:🚀\s*)?[\s\S]*?Vai\s+alla\s+Cassa[\s\S]*?<\/a>[\s\S]*?<\/p>/gi,
            // Centered div with button
            /<div[^>]*style[^>]*text-align[^>]*:?\s*center[^>]*>[\s\S]*?<a[^>]*>[\s\S]*?(?:🚀\s*)?[\s\S]*?Vai\s+alla\s+Cassa[\s\S]*?<\/a>[\s\S]*?<\/div>/gi,
        ];
        buttonPatterns.forEach(pattern => {
            templateHtml = templateHtml.replace(pattern, '');
        });

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
// NOTE: These app.use() calls are redundant because routes registered via registerAdminRoute
// already include the necessary middleware. Commenting out to avoid intercepting requests
// before they reach the specific routes.
// app.use('/t/:tenantSlug/admin', tenantLoader, requireSameTenantAsSession, requireRole('admin'));
// app.use('/t/:tenantSlug/api/admin', tenantLoader, requireSameTenantAsSession, requireRole('admin'));
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
// Coupons search route moved to routes/admin/coupons.js

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
        logger.withRequest(req).error({ err: e }, 'Error in legacy /api/coupons/:code/redeem');
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

// Campaigns routes moved to routes/admin/campaigns.js

// Tenant-aware auth-users routes are now handled by routes/admin/auth-users.js via registerAdminRoute

// Tenant-scoped: create campaign
// Campaigns routes moved to routes/admin/campaigns.js

// Settings routes moved to routes/admin/settings.js

// Campaigns form-config, form-links, custom-fields routes moved to routes/admin/campaigns.js

// Duplicate routes removed - see routes above (before app.use middleware)

// Tenant-scoped: get campaign by code (for form parameter)
app.get('/t/:tenantSlug/api/campaigns/:code', tenantLoader, async (req, res) => {
    try {
        const dbConn = await getDb();
        const formToken = req.query.form;
        
        let campaign;
        
        // If form token is provided, resolve campaign via form_links
        if (formToken) {
            // First check if link exists at all
            const linkCheck = await dbConn.get('SELECT id, used_at, tenant_id, campaign_id FROM form_links WHERE token = ?', formToken);
            
            if (!linkCheck) {
                return res.status(404).json({ error: 'Link non trovato' });
            }
            
            // Check if link belongs to this tenant
            if (linkCheck.tenant_id !== req.tenant.id) {
                return res.status(404).json({ error: 'Link non trovato' });
            }
            
            // Check if link is already used
            if (linkCheck.used_at) {
                return res.status(400).json({ error: 'Link già utilizzato' });
            }
            
            // Now get the campaign via form_links join
            const formLink = await dbConn.get(
                'SELECT fl.*, c.* FROM form_links fl JOIN campaigns c ON c.id = fl.campaign_id WHERE fl.token = ? AND fl.tenant_id = ? AND fl.used_at IS NULL',
                formToken, req.tenant.id
            );
            
            if (!formLink) {
                return res.status(404).json({ error: 'Campagna associata al link non trovata' });
            }
            
            // Build campaign object from joined result
            campaign = {
                id: formLink.campaign_id,
                campaign_code: formLink.campaign_code,
                name: formLink.name,
                description: formLink.description,
                is_active: formLink.is_active,
                discount_type: formLink.discount_type,
                discount_value: formLink.discount_value,
                form_config: formLink.form_config,
                expiry_date: formLink.expiry_date,
                created_at: formLink.created_at,
                tenant_id: formLink.tenant_id,
                _form_token: formToken // Include token for form submission
            };
        } else {
            // Legacy: resolve by campaign_code
            campaign = await dbConn.get('SELECT * FROM campaigns WHERE campaign_code = ? AND tenant_id = ?', req.params.code, req.tenant.id);
        }
        
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
        try {
            const formConfig = JSON.parse(campaign.form_config || '{"email": {"visible": true, "required": true}, "firstName": {"visible": true, "required": true}, "lastName": {"visible": true, "required": true}}');
            campaign.form_config = formConfig;
        } catch (parseError) {
            logger.withRequest(req).error({ err: parseError, form_config: campaign.form_config }, 'Error parsing form_config');
            // Use default form config if parsing fails
            campaign.form_config = {
                email: { visible: true, required: true },
                firstName: { visible: true, required: true },
                lastName: { visible: true, required: true }
            };
        }
        
        res.json(campaign);
    } catch (e) {
        logger.withRequest(req).error({ err: e }, 'Error in GET /t/:tenantSlug/api/campaigns/:code');
        const logContext = logger.withRequest(req);
        logContext.error({ err: e, formToken: req.query.form, code: req.params.code }, 'Error fetching campaign');
        res.status(500).json({ error: 'Errore server' });
    }
});

// Legacy endpoint /api/campaigns/:code - Deprecated
// Returns 410 Gone to indicate the endpoint is deprecated
app.get('/api/campaigns/:code', async (req, res) => {
    return res.status(410).json({
        error: 'Endpoint deprecato. Usa /t/:tenantSlug/api/campaigns/:code',
        deprecated: true
    });
});

// Campaigns CRUD routes moved to routes/admin/campaigns.js

// Users routes moved to routes/admin/users.js
// Coupons routes moved to routes/admin/coupons.js
// Analytics routes moved to routes/admin/analytics.js

// API to manage custom fields for a campaign
// Campaigns custom-fields routes moved to routes/admin/campaigns.js

// Products API
// Products routes moved to routes/admin/products.js

// Campaign products routes moved to routes/admin/campaigns.js

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
// Settings routes moved to routes/admin/settings.js

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

// Analytics routes moved to routes/admin/analytics.js
// Removed: GET /api/admin/analytics/summary
// Removed: GET /t/:tenantSlug/api/admin/analytics/summary
// Removed: GET /api/admin/analytics/campaigns
// Removed: GET /t/:tenantSlug/api/admin/analytics/campaigns
// Removed: GET /api/admin/analytics/temporal
// Removed: GET /t/:tenantSlug/api/admin/analytics/temporal
// Removed: GET /api/admin/analytics/export
// Removed: GET /t/:tenantSlug/api/admin/analytics/export

// Analytics endpoints removed - moved to routes/admin/analytics.js

// Auth-users routes moved to routes/admin/auth-users.js

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
        logger.withRequest(req).error({ err: e }, 'Error fetching account profile');
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
        logger.withRequest(req).error({ err: e }, 'Error updating account profile');
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
        logger.withRequest(req).error({ err: e }, 'Error changing account password');
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
/**
 * GET /health - Simple health check (no database check)
 * 
 * Returns basic health status without database connectivity check.
 * Useful for load balancer health checks that need fast response.
 * 
 * @route GET /health
 * @public
 * 
 * @returns {Object} Health status
 * @returns {boolean} returns.ok - Always true
 */
app.get('/health', (req, res) => res.json({ ok: true }));

/**
 * GET /healthz - Health check with database connectivity
 * 
 * Performs basic health check including database connectivity.
 * Returns 200 if healthy, 500 if database is unreachable.
 * 
 * @route GET /healthz
 * @public
 * 
 * @returns {Object} Health status
 * @returns {boolean} returns.ok - true if healthy, false if unhealthy
 * @returns {string} [returns.error] - Error message if unhealthy
 * 
 * @throws {500} Internal Server Error - If database is unreachable
 */
app.get('/healthz', async (req, res) => {
    try {
        const dbConn = await getDb();
        const row = await dbConn.get('SELECT 1 as ok');
        if (row && row.ok === 1) {
            return res.json({ ok: true, status: 'healthy', timestamp: new Date().toISOString() });
        }
        return res.status(500).json({ ok: false, status: 'unhealthy', error: 'Database query failed' });
    } catch (e) {
        logger.warn({ err: e }, 'Health check failed');
        return res.status(500).json({ 
            ok: false, 
            status: 'unhealthy', 
            error: 'Database unreachable',
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * GET /healthz/detailed - Detailed health check with system metrics
 * 
 * Performs comprehensive health check including:
 * - Database connectivity
 * - Database file size and status
 * - Memory usage
 * - Disk space (if available)
 * - Uptime
 * 
 * @route GET /healthz/detailed
 * @public
 * 
 * @returns {Object} Detailed health status
 * @returns {boolean} returns.ok - Overall health status
 * @returns {string} returns.status - 'healthy' or 'unhealthy'
 * @returns {Object} returns.checks - Individual check results
 * @returns {boolean} returns.checks.database - Database connectivity
 * @returns {Object} returns.checks.database.details - Database details (size, etc.)
 * @returns {Object} returns.checks.memory - Memory usage
 * @returns {Object} returns.checks.disk - Disk space (if available)
 * @returns {number} returns.uptime - Server uptime in seconds
 * @returns {string} returns.timestamp - Current timestamp (ISO)
 * 
 * @throws {500} Internal Server Error - If critical checks fail
 */
app.get('/healthz/detailed', async (req, res) => {
    const checks = {
        database: { ok: false, details: {} },
        memory: { ok: true, details: {} },
        disk: { ok: true, details: {} }
    };
    let overallOk = true;
    
    try {
        // Database check
        try {
            const dbConn = await getDb();
            const dbRow = await dbConn.get('SELECT 1 as ok');
            if (dbRow && dbRow.ok === 1) {
                checks.database.ok = true;
                
                // Get database file info
                const fs = require('fs');
                const path = require('path');
                const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
                const dbPath = path.join(DATA_DIR, 'coupons.db');
                
                if (fs.existsSync(dbPath)) {
                    const stats = fs.statSync(dbPath);
                    checks.database.details = {
                        size: stats.size,
                        sizeMB: (stats.size / 1024 / 1024).toFixed(2),
                        modified: stats.mtime.toISOString()
                    };
                }
            } else {
                checks.database.ok = false;
                overallOk = false;
            }
        } catch (dbError) {
            checks.database.ok = false;
            checks.database.error = String(dbError?.message || dbError);
            overallOk = false;
        }
        
        // Memory check
        try {
            const memUsage = process.memoryUsage();
            const memMB = {
                rss: (memUsage.rss / 1024 / 1024).toFixed(2),
                heapTotal: (memUsage.heapTotal / 1024 / 1024).toFixed(2),
                heapUsed: (memUsage.heapUsed / 1024 / 1024).toFixed(2),
                external: (memUsage.external / 1024 / 1024).toFixed(2)
            };
            
            checks.memory.details = memMB;
            
            // Warn if heap used > 500MB
            if (memUsage.heapUsed > 500 * 1024 * 1024) {
                checks.memory.warning = 'High memory usage';
            }
        } catch (memError) {
            checks.memory.ok = false;
            checks.memory.error = String(memError?.message || memError);
        }
        
        // Disk space check (if available)
        try {
            const fs = require('fs').promises;
            const path = require('path');
            const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
            
            // Try to get disk stats (may not work on all systems)
            const stats = await fs.statfs ? await fs.statfs(DATA_DIR) : null;
            if (stats) {
                checks.disk.details = {
                    available: stats.available,
                    total: stats.total,
                    freePercent: ((stats.available / stats.total) * 100).toFixed(2)
                };
                
                // Warn if < 10% free
                if ((stats.available / stats.total) < 0.1) {
                    checks.disk.warning = 'Low disk space';
                }
            } else {
                checks.disk.details = { note: 'Disk stats not available on this system' };
            }
        } catch (diskError) {
            // Disk check is optional, don't fail overall health
            checks.disk.details = { note: 'Disk check unavailable', error: String(diskError?.message || diskError) };
        }
        
        const response = {
            ok: overallOk,
            status: overallOk ? 'healthy' : 'unhealthy',
            checks,
            uptime: Math.floor(process.uptime()),
            timestamp: new Date().toISOString(),
            version: process.env.npm_package_version || '1.0.0',
            nodeVersion: process.version
        };
        
        const statusCode = overallOk ? 200 : 500;
        res.status(statusCode).json(response);
    } catch (error) {
        logger.error({ err: error }, 'Detailed health check failed');
        res.status(500).json({
            ok: false,
            status: 'unhealthy',
            error: 'Health check failed',
            timestamp: new Date().toISOString()
        });
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
        logger.withRequest(req).error({ err: error }, 'Error fetching super admin stats');
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
        logger.withRequest(req).error({ err: error }, 'Error fetching tenants');
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
        logger.withRequest(req).error({ err: e }, 'Error resolving tenant email settings');
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
        logger.withRequest(req).error({ err: e }, 'Superadmin test email error');
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
        logger.withRequest(req).error({ err: e }, 'Error fetching tenant email settings');
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
        logger.withRequest(req).error({ err: e }, 'Error updating tenant email settings');
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
        logger.withRequest(req).error({ err: e }, 'Error fetching brand settings');
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
        logger.withRequest(req).error({ err: e }, 'Error upserting brand settings');
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
        logger.withRequest(req).error({ err: e }, 'Error partial updating brand settings');
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
        logger.withRequest(req).error({ err: e }, 'Error fetching tenant brand settings (public)');
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
        logger.withRequest(req).error({ err: error }, 'Error creating tenant');
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
                logger.warn({ err: upgradeError }, 'Error upgrading password hash');
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
        logger.withRequest(req).error({ err: error }, 'Superadmin login error');
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
        logger.withRequest(req).error({ err: error }, 'Error fetching admin users');
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
        logger.withRequest(req).error({ err: e }, 'Error in superadmin auth-users PUT');
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
        logger.withRequest(req).error({ err: e }, 'Error in superadmin auth-users DELETE');
        return res.status(500).json({ error: 'Errore server' });
    }
});

// Settings routes moved to routes/admin/settings.js

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
        logger.withRequest(req).error({ err: e }, 'Error fetching store tenant brand settings');
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
        logger.withRequest(req).error({ err: e }, 'Error serving brand page');
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
        logger.withRequest(req).error({ err: error }, 'Error fetching logs');
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
        const logContext = logger.withRequest(req);
        if (isDevelopment) {
            logger.info({ tenantId, tenantName: tenant.name }, '[DELETE TENANT] Starting deletion');
        }
        
        // Ensure WAL is checkpointed before starting transaction
        try {
            await db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
            if (isDevelopment) {
                logger.debug('[DELETE TENANT] WAL checkpoint completed');
            }
        } catch (checkpointError) {
            logger.warn({ err: checkpointError }, '[DELETE TENANT] WAL checkpoint warning');
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
                    logger.error({ err, tableName }, '[DELETE] Error checking columns');
                    return false;
                }
            };
            
            // Helper function to safely delete from a table if it exists
            const safeDelete = async (tableName, whereClause, params = [], fallbackQuery = null) => {
                try {
                    if (isDevelopment) {
                        logger.debug({ tableName }, '[DELETE] Checking table');
                    }
                    // Check if table exists
                    const tableExists = await db.get(
                        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
                        tableName
                    );
                    if (!tableExists) {
                        if (isDevelopment) {
                            logger.debug({ tableName }, '[DELETE] Table does not exist, skipping');
                        }
                        return;
                    }
                    
                    // Check if the where clause uses tenant_id and if the column exists
                    if (whereClause.includes('tenant_id')) {
                        const hasTenantId = await tableHasColumn(tableName, 'tenant_id');
                        if (!hasTenantId && fallbackQuery) {
                            if (isDevelopment) {
                                logger.debug({ tableName }, '[DELETE] Table does not have tenant_id, using fallback query');
                            }
                            const result = await db.run(fallbackQuery, params);
                            if (isDevelopment && result.changes > 0) {
                                logger.debug({ tableName, changes: result.changes }, '[DELETE] Deleted using fallback');
                            }
                            return;
                        } else if (!hasTenantId) {
                            if (isDevelopment) {
                                logger.debug({ tableName }, '[DELETE] Table does not have tenant_id column and no fallback, skipping');
                            }
                            return;
                        }
                    }
                    
                    if (isDevelopment) {
                        logger.debug({ tableName, params }, '[DELETE] Table exists, executing delete');
                    }
                    const result = await db.run(`DELETE FROM ${tableName} WHERE ${whereClause}`, params);
                    if (isDevelopment && result.changes > 0) {
                        logger.debug({ tableName, tenantId, changes: result.changes }, '[DELETE] Deleted from table');
                    }
                } catch (err) {
                    logger.error({ err, tableName, whereClause, params }, '[DELETE] Error deleting from table');
                    throw err;
                }
            };
            
            // 1. Delete campaign_products first (if table exists)
            if (isDevelopment) {
                logger.debug({ tenantId }, '[DELETE TENANT] Checking for campaigns');
            }
            const campaignIds = await db.all('SELECT id FROM campaigns WHERE tenant_id = ?', tenantId);
            if (isDevelopment) {
                logger.debug({ tenantId, count: campaignIds ? campaignIds.length : 0 }, '[DELETE TENANT] Found campaigns');
            }
            if (campaignIds && campaignIds.length > 0) {
                const ids = campaignIds.map(c => c.id);
                if (isDevelopment) {
                    logger.debug({ tenantId, campaignIds: ids }, '[DELETE TENANT] Campaign IDs to delete from campaign_products');
                }
                // Check if campaign_products table exists first
                const cpTableExists = await db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='campaign_products'");
                if (cpTableExists) {
                    const placeholders = ids.map(() => '?').join(',');
                    await safeDelete('campaign_products', `campaign_id IN (${placeholders})`, ids);
                } else if (isDevelopment) {
                    logger.debug('[DELETE TENANT] campaign_products table does not exist, skipping');
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
                logger.debug({ tenantId }, '[DELETE TENANT] Deleting tenant record');
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
                logger.warn({ err: logError }, '[DELETE TENANT] Error logging deletion (non-critical)');
                // Don't fail the request if logging fails
            }
            
            // Always log successful deletion (important for audit)
            logger.info({ tenantId, tenantName: tenant.name, tenantSlug: tenant.slug }, '[DELETE TENANT] Tenant deleted successfully');
            res.json({ success: true, message: 'Tenant eliminato con successo' });
        } catch (deleteError) {
            // Rollback on error
            try {
                await db.exec('ROLLBACK');
            } catch (rollbackError) {
                logger.error({ err: rollbackError }, '[DELETE TENANT] Rollback error');
            }
            try {
                await db.exec('PRAGMA foreign_keys = ON');
            } catch (fkError) {
                logger.error({ err: fkError }, '[DELETE TENANT] Foreign keys re-enable error');
            }
            throw deleteError;
        }
    } catch (error) {
        logContext.error({ err: error, tenantId }, '[DELETE TENANT] Error deleting tenant');
        const errorMessage = error.message || 'Errore interno del server';
        // In development, send more details about the error
        const errorDetails = process.env.NODE_ENV !== 'production' 
            ? { message: errorMessage, stack: error.stack } 
            : { message: errorMessage };
        res.status(500).json({ error: errorMessage, details: errorDetails });
    }
});

// ============================================================================
// SECTION 14: Global Error Handler
// ============================================================================
// Global error handler (must be last middleware, before 404 handler)
// 
// Security features:
// - Prevents information disclosure: Full error details logged server-side only
// - Standardized error messages: Generic messages in production, detailed in development
// - Status code normalization: Ensures valid HTTP status codes
// - Request context logging: Includes request ID, URL, method, IP, user agent
// 
// Error handling strategy:
// - 404: "Risorsa non trovata"
// - 403: "Accesso negato"
// - 401: "Non autorizzato"
// - 400: "Richiesta non valida" (with details in development)
// - 500: Generic message in production, detailed in development
app.use((error, req, res, next) => {
    // Skip if response already sent
    if (res.headersSent) {
        return next(error);
    }
    
    const isDevelopment = process.env.NODE_ENV === 'development';
    
    // Determine status code
    let statusCode = error.status || error.statusCode || 500;
    if (statusCode < 400 || statusCode >= 600) {
        statusCode = 500;
    }
    
    // Log error with full context server-side (never expose to client)
    const logContext = logger.withRequest(req);
    logContext.error({
        err: error,
        message: error.message,
        stack: error.stack, // Full stack trace logged server-side only
        statusCode,
        url: req.originalUrl,
        method: req.method,
        ip: req.ip,
        userAgent: req.get('user-agent')
    }, 'Unhandled error in request handler');
    
    // Prepare safe error response (no sensitive information)
    const errorResponse = {
        error: 'Errore interno del server',
        statusCode
    };
    
    // Standardized error messages based on status code
    if (statusCode === 404) {
        errorResponse.error = 'Risorsa non trovata';
        errorResponse.message = 'La risorsa richiesta non è stata trovata';
    } else if (statusCode === 403) {
        errorResponse.error = 'Accesso negato';
        errorResponse.message = 'Non hai i permessi per accedere a questa risorsa';
    } else if (statusCode === 401) {
        errorResponse.error = 'Non autorizzato';
        errorResponse.message = 'Autenticazione richiesta';
    } else if (statusCode === 400) {
        errorResponse.error = 'Richiesta non valida';
        errorResponse.message = isDevelopment ? error.message : 'La richiesta non è valida';
    } else if (statusCode === 500) {
        // Generic message for 500 errors in production
        errorResponse.message = isDevelopment 
            ? error.message || 'Si è verificato un errore interno'
            : 'Si è verificato un errore. Riprova più tardi.';
    } else {
        // For other status codes, use generic message in production
        errorResponse.message = isDevelopment 
            ? error.message || 'Si è verificato un errore'
            : 'Si è verificato un errore. Riprova più tardi.';
    }
    
    // Include stack trace and detailed error only in development
    if (isDevelopment) {
        if (error.stack) {
            errorResponse.stack = error.stack;
        }
        if (error.message && statusCode !== 500) {
            errorResponse.message = error.message;
        }
    }
    
    // Never expose:
    // - File paths
    // - Software versions
    // - Internal error details
    // - Database errors
    // - Stack traces (except in development)
    
    // Send error response
    res.status(statusCode).json(errorResponse);
});

// 404 handler (must be last): serve friendly not-found page
app.use((req, res) => {
    logger.debug({ path: req.path, method: req.method }, '404 Not Found');
    res.status(404).sendFile(path.join(__dirname, 'views', '404.html'));
});

// Start server with proper timeout configurations
// Use '127.0.0.1' on Windows to avoid connection refused issues, '0.0.0.0' for all interfaces
const HOST = process.env.HOST || (process.platform === 'win32' ? '127.0.0.1' : '0.0.0.0');

// Server instance (will be set in async initialization)
let server;

// Initialize database before starting server to ensure it's ready
(async () => {
    try {
        // Initialize database first
        await getDb();
        logger.info('Database initialized');
        
        // Start server after database is ready
        server = app.listen(PORT, HOST, () => {
            logger.info({ port: PORT, host: HOST, url: `http://${HOST}:${PORT}` }, 'CouponGen server started');
        });
        
        // Handle server errors
        server.on('error', (error) => {
            if (error.code === 'EADDRINUSE') {
                logger.error({ port: PORT, err: error }, 'Port already in use');
            } else {
                logger.error({ err: error }, 'Server error');
            }
            process.exit(1);
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
        
    } catch (error) {
        logger.error({ err: error }, 'Error during server startup');
        process.exit(1);
    }
})();

// Graceful shutdown handler
let isShuttingDown = false;

async function gracefulShutdown(signal) {
    if (isShuttingDown) {
        logger.info({ signal }, '[shutdown] Already shutting down, ignoring signal');
        return;
    }
    
    isShuttingDown = true;
    logger.info({ signal }, '[shutdown] Received signal, initiating graceful shutdown');
    
    // Stop accepting new requests
    if (server) {
        server.close(() => {
            logger.info('[shutdown] HTTP server closed');
        });
    }
    
    // Close database connection
    if (db) {
        try {
            await db.close();
            logger.info('[shutdown] Database connection closed');
        } catch (error) {
            logger.error({ err: error }, '[shutdown] Error closing database');
        }
    }
    
    // Clear intervals
    if (cleanupInterval) {
        clearInterval(cleanupInterval);
        logger.info('[shutdown] Cleanup intervals cleared');
    }
    
    // Force exit after timeout if graceful shutdown takes too long
    setTimeout(() => {
        logger.error('[shutdown] Graceful shutdown timeout, forcing exit');
        process.exit(1);
    }, 10000); // 10 seconds timeout
    
    // Exit cleanly
    logger.info('[shutdown] Graceful shutdown complete');
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

