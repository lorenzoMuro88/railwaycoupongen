'use strict';

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const basicAuth = require('express-basic-auth');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const QRCode = require('qrcode');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
// Mailgun SDK
const formData = require('form-data');
const Mailgun = require('mailgun.js');
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

app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: '15mb' }));

// Middleware per gestire errori di parsing JSON
app.use((error, req, res, next) => {
    if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
        console.error('Errore parsing JSON:', error.message);
        return res.status(400).json({ success: false, message: 'JSON non valido' });
    }
    next();
});

// Serve uploads from configurable directory before general static
const UPLOADS_BASE_DIR = process.env.UPLOADS_DIR
    ? path.resolve(process.env.UPLOADS_DIR)
    : path.join(__dirname, 'static', 'uploads');
if (!fs.existsSync(UPLOADS_BASE_DIR)) {
    fs.mkdirSync(UPLOADS_BASE_DIR, { recursive: true });
}
app.use('/static/uploads', express.static(UPLOADS_BASE_DIR));

app.use('/static', express.static(path.join(__dirname, 'static')));

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
        console.error('reCAPTCHA verify error', e);
        return { ok: false, reason: 'verify-exception' };
    }
}

async function verifyRecaptchaIfEnabled(req, res, next) {
    if (!RECAPTCHA_ENABLED) return next();
    const token = req.body['g-recaptcha-response'] || req.body['recaptchaToken'];
    const ip = req.ip || req.connection?.remoteAddress || undefined;
    if (!RECAPTCHA_SECRET) {
        console.warn('RECAPTCHA_ENABLED=true ma RECAPTCHA_SECRET è vuoto');
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
        const dbConn = await getDb();
        const tenant = await dbConn.get('SELECT id, slug, name FROM tenants WHERE slug = ?', tenantSlug);
        if (!tenant) {
            return res.status(404).send('Tenant non trovato');
        }
        req.tenant = tenant;
        req.tenantSlug = tenant.slug;
        // Simple visibility in logs
        console.log(`[tenant:${tenant.slug}] ${req.method} ${req.originalUrl}`);
        next();
    } catch (e) {
        console.error('tenantLoader error', e);
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

// Session configuration (Redis in production)
let sessionOptions = {
    secret: process.env.SESSION_SECRET || 'coupon-gen-secret-key-change-in-production',
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
            campaign_code TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL UNIQUE,
            description TEXT,
            is_active BOOLEAN DEFAULT 0,
            discount_type TEXT NOT NULL DEFAULT 'percent',
            discount_value TEXT NOT NULL,
            form_config TEXT DEFAULT '{"email": {"visible": true, "required": true}, "firstName": {"visible": true, "required": true}, "lastName": {"visible": true, "required": true}, "phone": {"visible": false, "required": false}, "address": {"visible": false, "required": false}, "allergies": {"visible": false, "required": false}, "customFields": []}', -- JSON config for form fields
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
        console.log('Starting database migration...');
        
        // Simple versioned migrations table
        await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
        const currentVersion = '2025-10-mt-a2';
        const hasVersion = await db.get('SELECT 1 FROM schema_migrations WHERE version = ?', currentVersion);

        // STEP 1: Create all base tables FIRST (before any ALTER statements)
        console.log('Creating base tables...');
        
        // Create auth_users table if it doesn't exist
        const authUsersTable = await db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='auth_users'");
        if (authUsersTable.length === 0) {
            console.log('Creating auth_users table...');
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
            console.log('Creating form_customization table...');
            await db.exec(`
                CREATE TABLE form_customization (
                    id INTEGER PRIMARY KEY,
                    config_data TEXT NOT NULL,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                );
            `);
        }

        // Create products table if it doesn't exist
        const productsTable = await db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='products'");
        if (productsTable.length === 0) {
            console.log('Creating products table...');
            await db.exec(`
                CREATE TABLE products (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    value REAL NOT NULL,
                    margin_price REAL NOT NULL,
                    sku TEXT UNIQUE,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                );
            `);
        }

        // Create campaign_products table if it doesn't exist
        const campaignProductsTable = await db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='campaign_products'");
        if (campaignProductsTable.length === 0) {
            console.log('Creating campaign_products table...');
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
            console.log('Adding campaign_id column to coupons...');
            await db.exec('ALTER TABLE coupons ADD COLUMN campaign_id INTEGER');
        }
        
        if (!columnNames.includes('discount_type')) {
            console.log('Adding discount_type column to coupons...');
            await db.exec("ALTER TABLE coupons ADD COLUMN discount_type TEXT DEFAULT 'percent'");
        }
        
        if (!columnNames.includes('discount_value')) {
            console.log('Adding discount_value column to coupons...');
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
            console.log('Adding tenant_id column to coupons...');
            await db.exec('ALTER TABLE coupons ADD COLUMN tenant_id INTEGER');
        }
        
        // Check if campaign_code column exists in campaigns table
        const campaignColumns = await db.all("PRAGMA table_info(campaigns)");
        const campaignColumnNames = campaignColumns.map(col => col.name);
        
        if (!campaignColumnNames.includes('campaign_code')) {
            console.log('Adding campaign_code column to campaigns...');
            await db.exec(`ALTER TABLE campaigns ADD COLUMN campaign_code TEXT`);
            
            // Generate campaign codes for existing campaigns
            const existingCampaigns = await db.all('SELECT id FROM campaigns WHERE campaign_code IS NULL');
            console.log(`Found ${existingCampaigns.length} campaigns without campaign_code`);
            for (const campaign of existingCampaigns) {
                const campaignCode = generateId(12);
                await db.run('UPDATE campaigns SET campaign_code = ? WHERE id = ?', campaignCode, campaign.id);
                console.log(`Generated campaign_code ${campaignCode} for campaign ${campaign.id}`);
            }
            
            // Make campaign_code unique
            await db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_campaigns_code ON campaigns(campaign_code)`);
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
            console.log('Adding form_config column to campaigns...');
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
            console.log('Adding tenant_id column to campaigns...');
            await db.exec('ALTER TABLE campaigns ADD COLUMN tenant_id INTEGER');
        }
        
        // Check if new columns exist in users table
        const userColumns = await db.all("PRAGMA table_info(users)");
        const userColumnNames = userColumns.map(col => col.name);
        
        if (!userColumnNames.includes('phone')) {
            console.log('Adding phone column to users...');
            await db.exec("ALTER TABLE users ADD COLUMN phone TEXT");
        }
        if (!userColumnNames.includes('address')) {
            console.log('Adding address column to users...');
            await db.exec("ALTER TABLE users ADD COLUMN address TEXT");
        }
        if (!userColumnNames.includes('allergies')) {
            console.log('Adding allergies column to users...');
            await db.exec("ALTER TABLE users ADD COLUMN allergies TEXT");
        }
        if (!userColumnNames.includes('tenant_id')) {
            console.log('Adding tenant_id column to users...');
            await db.exec('ALTER TABLE users ADD COLUMN tenant_id INTEGER');
        }
        
        // Check if user_custom_data table exists
        const customDataTable = await db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='user_custom_data'");
        if (customDataTable.length === 0) {
            console.log('Creating user_custom_data table...');
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
        }

        // Ensure auth_users table exists BEFORE attempting to alter it
        const hasAuthUsersTable = await db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='auth_users'");
        if (hasAuthUsersTable.length === 0) {
            console.log('Creating auth_users table (missing before alteration step)...');
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

        // Ensure auth_users has tenant_id and default records are tenant-scoped
        const authUserCols = await db.all("PRAGMA table_info(auth_users)");
        const authUserColNames = authUserCols.map(c => c.name);
        if (!authUserColNames.includes('tenant_id')) {
            console.log('Adding tenant_id to auth_users...');
            await db.exec('ALTER TABLE auth_users ADD COLUMN tenant_id INTEGER');
        }
        if (!authUserColNames.includes('first_name')) {
            console.log('Adding first_name to auth_users...');
            await db.exec('ALTER TABLE auth_users ADD COLUMN first_name TEXT');
        }
        if (!authUserColNames.includes('last_name')) {
            console.log('Adding last_name to auth_users...');
            await db.exec('ALTER TABLE auth_users ADD COLUMN last_name TEXT');
        }
        if (!authUserColNames.includes('email')) {
            console.log('Adding email to auth_users...');
            await db.exec('ALTER TABLE auth_users ADD COLUMN email TEXT');
        }
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
                console.log('Adding email_from_name column to tenants table...');
                await db.exec('ALTER TABLE tenants ADD COLUMN email_from_name TEXT DEFAULT "CouponGen"');
            }
            
            await db.run('INSERT INTO schema_migrations(version) VALUES (?)', currentVersion);
        }

        // Email template table (multitenant)
        const emailTemplateTable = await db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='email_template'");
        if (emailTemplateTable.length === 0) {
            console.log('Creating email_template table...');
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
                console.log('Adding tenant_id column to email_template...');
                await db.exec('ALTER TABLE email_template ADD COLUMN tenant_id INTEGER');
                // Migrate existing template to default tenant
                await db.run('UPDATE email_template SET tenant_id = ? WHERE tenant_id IS NULL', defaultTenantId);
            }
        }

        
        // Create default users if auth_users table is empty
        const userCount = await db.get('SELECT COUNT(*) as count FROM auth_users');
        if (userCount.count === 0) {
            console.log('Creating default users...');
            const defaultSuperAdminPassword = process.env.SUPERADMIN_PASSWORD || 'admin123';
            const defaultStorePassword = process.env.STORE_PASSWORD || 'store123';
            
            // Simple password hashing (in production, use bcrypt)
            const superAdminHash = Buffer.from(defaultSuperAdminPassword).toString('base64');
            const storeHash = Buffer.from(defaultStorePassword).toString('base64');
            
            await db.run(`
                INSERT INTO auth_users (username, password_hash, user_type, tenant_id) 
                VALUES ('admin', ?, 'superadmin', ?), ('store', ?, 'store', ?)
            `, superAdminHash, defaultTenantId, storeHash, defaultTenantId);
            
            console.log('Default users created:');
            console.log('- SuperAdmin: username=admin, password=' + defaultSuperAdminPassword);
            console.log('- Store: username=store, password=' + defaultStorePassword);
        }
        
        // Re-enable foreign keys after migration
        await db.exec('PRAGMA foreign_keys = ON');
        
        console.log('Database migration completed successfully');
        
        // Create some initial sample logs for testing
        try {
            const sampleLogs = await db.all('SELECT COUNT(*) as count FROM system_logs');
            if (sampleLogs[0].count === 0) {
                console.log('Creating sample logs...');
                await db.run(`
                    INSERT INTO system_logs (username, user_type, action_type, action_description, level, details, timestamp) VALUES
                    ('Sistema', 'system', 'create', 'Sistema avviato', 'info', '{"message": "Sistema CouponGen avviato correttamente"}', datetime('now', '-1 hour')),
                    ('admin', 'superadmin', 'login', 'Login SuperAdmin effettuato', 'success', '{"username": "admin", "userType": "superadmin"}', datetime('now', '-30 minutes')),
                    ('Sistema', 'system', 'create', 'Database inizializzato', 'info', '{"tables": ["tenants", "users", "campaigns", "coupons", "system_logs"]}', datetime('now', '-15 minutes'))
                `);
                console.log('Sample logs created');
            }
        } catch (error) {
            console.error('Error creating sample logs:', error);
        }
    } catch (migrationError) {
        console.error('Migration error:', migrationError);
        // Re-enable foreign keys even if migration fails
        await db.exec('PRAGMA foreign_keys = ON');
    }
    return db;
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
                    data.attachment = message.attachments.map(att => ({
                        filename: att.filename,
                        data: att.content,
                        knownLength: att.content?.length
                    }));
                    // For inline image, set inline too
                    const inline = message.attachments.filter(a => a.cid).map(att => ({ filename: att.filename, data: att.content, knownLength: att.content?.length }));
                    if (inline.length) data.inline = inline;
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
                const domain = process.env.MAILGUN_DOMAIN;
                
                // Add timeout wrapper for Mailgun API call
                const timeoutPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Mailgun API timeout')), 30000)
                );
                
                const result = await Promise.race([
                    mg.messages.create(domain, data),
                    timeoutPromise
                ]);
                return { id: result.id };
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

// Utilities
function toSlug(input) {
    return String(input || '')
        .toLowerCase()
        .normalize('NFD').replace(/\p{Diacritic}/gu, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64) || 'tenant';
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
        console.error('Error logging action:', error);
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
        return res.status(403).send('Accesso negato. Richiesto ruolo Admin.');
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

// Simple password verification (in production, use bcrypt)
function verifyPassword(password, hash) {
    return Buffer.from(password).toString('base64') === hash;
}

function hashPassword(password) {
    return Buffer.from(password).toString('base64');
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
            console.error('Database connection failed');
            return res.status(500).json({ error: 'Errore di connessione al database' });
        }
        
        const user = await dbConn.get(
            'SELECT * FROM auth_users WHERE username = ? AND user_type = ? AND is_active = 1',
            username, userType
        );
        
        if (!user || !verifyPassword(password, user.password_hash)) {
            recordLoginFailure(ip);
            return res.status(401).json({ error: 'Credenziali non valide' });
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
            console.error('Session regeneration failed:', sessionError);
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
        
        // Debug: Log session creation
        console.log('Session created:', req.session.user);
        console.log('Session ID:', req.sessionID);
        console.log('Request headers:', req.headers);
        console.log('Request secure:', req.secure);
        console.log('Request protocol:', req.protocol);
        
        // Determine redirect URL (simplified for debugging)
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
            console.error('Failed to log login action:', logError);
            // Continue with login even if logging fails
        }
        
        // Debug: Log cookie headers
        console.log('Response headers being set:', res.getHeaders());
        console.log('Session cookie should be set with secure flag');
        
        res.json({ 
            success: true, 
            message: 'Login effettuato con successo',
            redirect: redirectUrl
        });
        
    } catch (error) {
        console.error('Login error:', error);
        console.error('Error stack:', error.stack);
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
                                <img src="cid:couponqr" alt="QR Code" style="max-width: 200px; height: auto; border: 1px solid #ddd; border-radius: 8px; display: block; margin: 0 auto;">
                            </div>
                            <p style="font-size: 16px; color: #333333; margin: 20px 0;">Mostra questo codice in negozio oppure usa il link qui sotto:</p>
                            <div style="text-align: center; margin: 30px 0;">
                                <a href="{{redemptionUrl}}" style="display: inline-block; background-color: #2d5a3d; color: #ffffff; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; font-size: 16px;">🚀 Vai alla Cassa</a>
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
        await dbConn.run(
            'INSERT INTO auth_users (username, password_hash, user_type, is_active, tenant_id) VALUES (?, ?, ?, 1, ?)',
            adminUsername, hashPassword(adminPassword), 'admin', newTenantId
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
        
        // Try to get custom sender name from user's tenant
        let senderName = 'CouponGen';
        if (req.session && req.session.user && req.session.user.tenantSlug) {
            try {
                const dbConn = await getDb();
                const tenant = await dbConn.get('SELECT email_from_name FROM tenants WHERE slug = ?', req.session.user.tenantSlug);
                if (tenant && tenant.email_from_name) {
                    senderName = tenant.email_from_name;
                }
            } catch (e) {
                console.error('Error getting tenant sender name:', e);
            }
        }
        
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
        console.error('Test email error:', e);
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
        console.error(e);
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
        console.error('Test email error:', e);
        res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
});

// API per configurazione personalizzazione form
app.get('/api/admin/form-customization', requireAdmin, async (req, res) => {
    try {
        const config = await db.get('SELECT * FROM form_customization WHERE id = 1');
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
        console.error('Errore get email template:', e);
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
        const configData = JSON.stringify(req.body);
        
        // Inserisci o aggiorna la configurazione
        await db.run(`
            INSERT OR REPLACE INTO form_customization (id, config_data, updated_at) 
            VALUES (1, ?, datetime('now'))
        `, configData);
        
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
        const publicUrl = `/static/uploads/${tenantSlug}/${filename}`;
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
        const publicUrl = `/static/uploads/${req.tenant.slug}/${filename}`;
        res.json({ url: publicUrl });
    } catch (e) {
        console.error('Upload image error:', e);
        res.status(500).json({ error: 'Errore durante il caricamento immagine' });
    }
});

// Tenant-scoped: API per configurazione form (pubblica)
app.get('/t/:tenantSlug/api/form-customization', tenantLoader, async (req, res) => {
    try {
        const config = await db.get('SELECT * FROM form_customization WHERE id = 1');
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

// Legacy: API per configurazione form (pubblica)
app.get('/api/form-customization', async (req, res) => {
    try {
        const config = await db.get('SELECT * FROM form_customization WHERE id = 1');
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
app.post('/api/form-customization', async (req, res) => {
    try {
        console.log('=== RICHIESTA FORM-CUSTOMIZATION ===');
        console.log('Headers ricevuti:', req.headers);
        console.log('Content-Type:', req.get('Content-Type'));
        console.log('Body ricevuto:', req.body);
        console.log('Tipo del body:', typeof req.body);
        console.log('=====================================');
        
        // Verifica che il body sia un oggetto valido
        if (!req.body || typeof req.body !== 'object') {
            console.error('Body non valido o vuoto');
            return res.status(400).json({ success: false, message: 'Body della richiesta non valido' });
        }
        
        const configData = JSON.stringify(req.body);
        console.log('Config data da salvare:', configData);
        
        // Inserisci o aggiorna la configurazione
        await db.run(`
            INSERT OR REPLACE INTO form_customization (id, config_data, updated_at) 
            VALUES (1, ?, datetime('now'))
        `, configData);
        
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

// Form submission - create user and coupon, send email with QR
app.post('/submit', checkSubmitRateLimit, verifyRecaptchaIfEnabled, async (req, res) => {
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
            specificCampaign = await dbConn.get('SELECT * FROM campaigns WHERE campaign_code = ?', campaign_id);
            if (specificCampaign) {
                // Check if campaign is active
                if (!specificCampaign.is_active) {
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

        const user = await dbConn.get('SELECT * FROM users WHERE email = ?', email);
        let userId;
        if (user) {
            userId = user.id;
        } else {
            const result = await dbConn.run(
                'INSERT INTO users (email, first_name, last_name) VALUES (?, ?, ?)',
                email, firstName || null, lastName || null
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
                        'INSERT INTO user_custom_data (user_id, field_name, field_value) VALUES (?, ?, ?)',
                        userId, customField.id, fieldValue
                    );
                }
            }
        }

        await dbConn.run(
            'INSERT INTO coupons (code, user_id, campaign_id, discount_type, discount_value, status) VALUES (?, ?, ?, ?, ?, ?)',
            couponCode, userId, campaignId, discountType, discountValue, 'active'
        );

        // Redemption URL per staff cassa; il QR deve puntare a questa pagina
        const redemptionUrl = `${req.protocol}://${req.get('host')}/redeem/${couponCode}`;
        const qrDataUrl = await QRCode.toDataURL(redemptionUrl, { width: 300, margin: 2 });

        const discountText = discountType === 'percent' ? `uno sconto del ${discountValue}%` : 
                            discountType === 'fixed' ? `uno sconto di &euro;${discountValue}` : discountValue;
        // Load email template (multitenant)
        let templateSubject = process.env.MAIL_SUBJECT || 'Il tuo coupon';
        let templateHtml = '';
        try {
            const tenantId = req.tenant?.id || req.session?.user?.tenantId;
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
            <p><img src="cid:couponqr" alt="QR Code" /></p>
            <p>Grazie!</p>`;
        }

        const html = templateHtml
            .replaceAll('{{firstName}}', firstName || '')
            .replaceAll('{{lastName}}', lastName || '')
            .replaceAll('{{code}}', couponCode)
            .replaceAll('{{discountText}}', discountText)
            .replaceAll('{{redemptionUrl}}', redemptionUrl);

        const message = {
            from: process.env.MAIL_FROM || process.env.MAILGUN_FROM || 'CouponGen <no-reply@send.coupongen.it>',
            to: email,
            subject: templateSubject,
            html,
            attachments: [
                {   // inline QR (Mailgun risolve per filename)
                    filename: 'couponqr.png',
                    cid: 'couponqr',
                    content: Buffer.from(qrDataUrl.split(',')[1], 'base64'),
                    contentType: 'image/png'
                }
            ]
        };

        try {
            const info = await transporter.sendMail(message);
            if (transporter.options.jsonTransport) {
                // Log to console in dev
                console.log('Email simulata:', info.message);
            }
        } catch (emailErr) {
            console.error('Email error:', emailErr);
            // Continue without failing the request
        }

        res.redirect('/thanks');
    } catch (err) {
        console.error('Error in submit:', err);
        console.error('Error stack:', err.stack);
        res.status(500).send('Errore durante la creazione del coupon');
    }
});

// Tenant-scoped form submission (M3)
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

        if (campaign_id) {
            specificCampaign = await dbConn.get('SELECT * FROM campaigns WHERE campaign_code = ? AND tenant_id = ?', campaign_id, req.tenant.id);
            if (specificCampaign) {
                if (!specificCampaign.is_active) {
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

        const user = await dbConn.get('SELECT * FROM users WHERE email = ? AND tenant_id = ?', email, req.tenant.id);
        let userId;
        if (user) {
            userId = user.id;
        } else {
            const result = await dbConn.run(
                'INSERT INTO users (email, first_name, last_name, tenant_id) VALUES (?, ?, ?, ?)',
                email, firstName || null, lastName || null, req.tenant.id
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
                        userId, customField.id, fieldValue, req.tenant.id
                    );
                }
            }
        }

        await dbConn.run(
            'INSERT INTO coupons (code, user_id, campaign_id, discount_type, discount_value, status, tenant_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
            couponCode, userId, campaignId, discountType, discountValue, 'active', req.tenant.id
        );

        const redemptionUrl = `${req.protocol}://${req.get('host')}/t/${req.tenant.slug}/redeem/${couponCode}`;
        const qrDataUrl = await QRCode.toDataURL(redemptionUrl, { width: 300, margin: 2 });

        const discountText = discountType === 'percent' ? `uno sconto del ${discountValue}%` : 
                            discountType === 'fixed' ? `uno sconto di &euro;${discountValue}` : discountValue;
        let templateSubject = process.env.MAIL_SUBJECT || 'Il tuo coupon';
        let templateHtml = '';
        try {
            const tenantId = req.tenant?.id || req.session?.user?.tenantId;
            if (tenantId) {
                const t = await dbConn.get('SELECT subject, html FROM email_template WHERE tenant_id = ?', tenantId);
                if (t) { templateSubject = t.subject || templateSubject; templateHtml = t.html || templateHtml; }
            }
        } catch (e) {}
        if (!templateHtml) {
            templateHtml = `<p>Ciao {{firstName}} {{lastName}},</p>
            <p>Ecco il tuo coupon: <strong>{{code}}</strong> che vale {{discountText}}.</p>
            <p>Mostra questo codice in negozio. Puoi anche usare questo link per la cassa: <a href="{{redemptionUrl}}">{{redemptionUrl}}</a></p>
            <p><img src="cid:couponqr" alt="QR Code" /></p>
            <p>Grazie!</p>`;
        }
        const html = templateHtml
            .replaceAll('{{firstName}}', firstName || '')
            .replaceAll('{{lastName}}', lastName || '')
            .replaceAll('{{code}}', couponCode)
            .replaceAll('{{discountText}}', discountText)
            .replaceAll('{{redemptionUrl}}', redemptionUrl);

        const message = {
            from: process.env.MAIL_FROM || process.env.MAILGUN_FROM || 'CouponGen <no-reply@send.coupongen.it>',
            to: email,
            subject: templateSubject,
            html,
            attachments: [
                { filename: 'couponqr.png', cid: 'couponqr', content: Buffer.from(qrDataUrl.split(',')[1], 'base64'), contentType: 'image/png' }
            ]
        };
        try { await transporter.sendMail(message); } catch (emailErr) { console.error('Email error:', emailErr); }

        // Log coupon creation
        await logAction(req, 'create', `Coupon creato: ${couponCode}`, 'success', {
            couponCode: couponCode,
            campaignId: campaignId,
            discountType: discountType,
            discountValue: discountValue,
            userEmail: email
        });

        res.redirect(`/t/${req.tenant.slug}/thanks`);
    } catch (err) {
        console.error('Error in submit (tenant):', err);
        res.status(500).send('Errore durante la creazione del coupon');
    }
});

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

// Tenant-scoped protected areas (soft-enforce in M2)
app.use('/t/:tenantSlug/admin', tenantLoader, requireSameTenantAsSession, requireRole('admin'));
app.use('/t/:tenantSlug/api/admin', tenantLoader, requireSameTenantAsSession, requireRole('admin'));
app.use('/t/:tenantSlug/store', tenantLoader, requireSameTenantAsSession, requireRole('store'));
app.use('/t/:tenantSlug/api/store', tenantLoader, requireSameTenantAsSession, requireRole('store'));

app.get('/store', (req, res) => {
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
        console.error(e);
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
        console.error(e);
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
        console.error(e);
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
        console.error(e);
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
        console.error(e);
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
        console.error(e);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Admin: search coupons by code (partial) or last name
app.get('/api/admin/coupons/search', async (req, res) => {
    try {
        const { q } = req.query;
        if (!q || q.trim().length < 2) {
            return res.json([]);
        }
        
        const dbConn = await getDb();
        const searchTerm = `%${q.trim().toUpperCase()}%`;
        
        const coupons = await dbConn.all(`
            SELECT c.id, c.code, c.discount_type AS discountType, c.discount_value AS discountValue, c.status, c.issued_at AS issuedAt, c.redeemed_at AS redeemedAt,
                   u.first_name AS firstName, u.last_name AS lastName, u.email, camp.name AS campaignName
            FROM coupons c
            JOIN users u ON u.id = c.user_id
            LEFT JOIN campaigns camp ON camp.id = c.campaign_id
            WHERE c.code LIKE ? OR UPPER(u.last_name) LIKE ?
            ORDER BY c.issued_at DESC
            LIMIT 100
        `, searchTerm, searchTerm);
        
        res.json(coupons);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Redeem coupon (burn)
app.post('/api/coupons/:code/redeem', async (req, res) => {
    try {
        const dbConn = await getDb();
        const coupon = await dbConn.get('SELECT * FROM coupons WHERE code = ?', req.params.code);
        if (!coupon) return res.status(404).json({ error: 'Non trovato' });
        if (coupon.status !== 'active') return res.status(400).json({ error: 'Coupon non attivo' });

        await dbConn.run('UPDATE coupons SET status = ?, redeemed_at = CURRENT_TIMESTAMP WHERE id = ?', 'redeemed', coupon.id);
        res.json({ ok: true, code: coupon.code, status: 'redeemed' });
    } catch (e) {
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
app.get('/api/admin/campaigns', async (req, res) => {
    try {
        const dbConn = await getDb();
        const campaigns = await dbConn.all('SELECT * FROM campaigns ORDER BY created_at DESC');
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
        res.json(campaigns);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Tenant-scoped: create campaign
app.post('/t/:tenantSlug/api/admin/campaigns', tenantLoader, requireSameTenantAsSession, requireRole('admin'), async (req, res) => {
    try {
        const { name, description, discount_type, discount_value } = req.body || {};
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
            'INSERT INTO campaigns (campaign_code, name, description, discount_type, discount_value, form_config, tenant_id, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, 0)',
            campaignCode, name, description || null, discount_type, discount_value, defaultFormConfig, req.tenant.id
        );
        res.json({ id: result.lastID, campaign_code: campaignCode, name, description, discount_type, discount_value });
    } catch (e) {
        console.error(e);
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
        console.error(e);
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

// Tenant-scoped: get campaign by code (for form parameter)
app.get('/t/:tenantSlug/api/campaigns/:code', tenantLoader, async (req, res) => {
    try {
        const dbConn = await getDb();
        const campaign = await dbConn.get('SELECT * FROM campaigns WHERE campaign_code = ? AND tenant_id = ?', req.params.code, req.tenant.id);
        if (!campaign) {
            return res.status(404).json({ error: 'Campagna non trovata' });
        }
        // Check if campaign is active
        if (!campaign.is_active) {
            return res.status(404).json({ error: 'Campagna non trovata' });
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

// Legacy: get campaign by code (DEPRECATED - use tenant-scoped endpoint)
app.get('/api/campaigns/:code', async (req, res) => {
    try {
        const dbConn = await getDb();
        const campaign = await dbConn.get('SELECT * FROM campaigns WHERE campaign_code = ?', req.params.code);
        if (!campaign) {
            return res.status(404).json({ error: 'Campagna non trovata' });
        }
        // Check if campaign is active
        if (!campaign.is_active) {
            return res.status(404).json({ error: 'Campagna non trovata' });
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

app.post('/api/admin/campaigns', async (req, res) => {
    try {
        const { name, description, discount_type, discount_value } = req.body;
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
            'INSERT INTO campaigns (campaign_code, name, description, discount_type, discount_value, form_config) VALUES (?, ?, ?, ?, ?, ?)',
            campaignCode, name, description || null, discount_type, discount_value, defaultFormConfig
        );
        res.json({ id: result.lastID, campaign_code: campaignCode, name, description, discount_type, discount_value });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Errore server' });
    }
});

app.put('/api/admin/campaigns/:id/activate', async (req, res) => {
    try {
        const dbConn = await getDb();
        // Simply activate the selected campaign (no need to deactivate others)
        await dbConn.run('UPDATE campaigns SET is_active = 1 WHERE id = ?', req.params.id);
        res.json({ ok: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Errore server' });
    }
});

app.put('/api/admin/campaigns/:id/deactivate', async (req, res) => {
    try {
        const dbConn = await getDb();
        // Deactivate the specific campaign
        await dbConn.run('UPDATE campaigns SET is_active = 0 WHERE id = ?', req.params.id);
        res.json({ ok: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Errore server' });
    }
});

app.delete('/api/admin/campaigns/:id', async (req, res) => {
    try {
        const dbConn = await getDb();
        await dbConn.run('DELETE FROM campaigns WHERE id = ?', req.params.id);
        res.json({ ok: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Form configuration APIs
app.get('/api/admin/campaigns/:id/form-config', async (req, res) => {
    try {
        const dbConn = await getDb();
        const campaign = await dbConn.get('SELECT form_config FROM campaigns WHERE id = ?', req.params.id);
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

app.put('/api/admin/campaigns/:id/form-config', async (req, res) => {
    try {
        const { formConfig } = req.body;
        if (!formConfig || typeof formConfig !== 'object') {
            return res.status(400).json({ error: 'Configurazione form non valida' });
        }
        
        const dbConn = await getDb();
        await dbConn.run('UPDATE campaigns SET form_config = ? WHERE id = ?', JSON.stringify(formConfig), req.params.id);
        res.json({ ok: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Errore server' });
    }
});

// API per recuperare tutte le campagne
app.get('/api/admin/campaigns-list', async (req, res) => {
    try {
        const dbConn = await getDb();
        const campaigns = await dbConn.all(`
            SELECT DISTINCT name 
            FROM campaigns 
            WHERE name IS NOT NULL AND name != ''
            ORDER BY name
        `);
        res.json(campaigns.map(c => c.name));
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Database utenti API
app.get('/api/admin/users', async (req, res) => {
    try {
        const { search, campaigns } = req.query;
        const dbConn = await getDb();
        
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
            LEFT JOIN coupons co ON u.id = co.user_id
            LEFT JOIN campaigns c ON co.campaign_id = c.id
        `;
        
        const params = [];
        const conditions = [];
        
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
            GROUP BY u.email, u.first_name, u.last_name
            ORDER BY last_coupon_date DESC
        `;
        
        const users = await dbConn.all(query, params);
        
        // Fetch custom fields for each user
        for (let user of users) {
            const customFields = await dbConn.all(
                'SELECT field_name, field_value FROM user_custom_data WHERE user_id = ?',
                user.id
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

// Get user coupons
app.get('/api/admin/users/:id/coupons', async (req, res) => {
    try {
        const dbConn = await getDb();
        
        // Check if user exists
        const user = await dbConn.get('SELECT * FROM users WHERE id = ?', req.params.id);
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
            WHERE c.user_id = ?
            ORDER BY c.issued_at DESC
        `, req.params.id);
        
        res.json(coupons);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Delete specific coupon
app.delete('/api/admin/coupons/:id', async (req, res) => {
    try {
        const dbConn = await getDb();
        
        // Check if coupon exists
        const coupon = await dbConn.get('SELECT * FROM coupons WHERE id = ?', req.params.id);
        if (!coupon) {
            return res.status(404).json({ error: 'Coupon non trovato' });
        }
        
        // Delete coupon
        await dbConn.run('DELETE FROM coupons WHERE id = ?', req.params.id);
        
        res.json({ success: true, message: 'Coupon eliminato con successo' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Delete user
app.delete('/api/admin/users/:id', async (req, res) => {
    try {
        const dbConn = await getDb();
        
        // Check if user exists
        const user = await dbConn.get('SELECT * FROM users WHERE id = ?', req.params.id);
        if (!user) {
            return res.status(404).json({ error: 'Utente non trovato' });
        }
        
        // Check if user has active coupons
        const activeCouponCount = await dbConn.get('SELECT COUNT(*) as count FROM coupons WHERE user_id = ? AND status = "active"', req.params.id);
        if (activeCouponCount.count > 0) {
            return res.status(400).json({ 
                error: 'Impossibile eliminare l\'utente: ha dei coupon attivi. Elimina prima i coupon attivi o cambia il loro stato.' 
            });
        }
        
        // Delete user (custom fields will be deleted automatically due to CASCADE)
        await dbConn.run('DELETE FROM users WHERE id = ?', req.params.id);
        
        res.json({ success: true, message: 'Utente eliminato con successo' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Errore server' });
    }
});

// Get single user by ID
app.get('/api/admin/users/:id', async (req, res) => {
    try {
        const dbConn = await getDb();
        const user = await dbConn.get('SELECT * FROM users WHERE id = ?', req.params.id);
        if (!user) {
            return res.status(404).json({ error: 'Utente non trovato' });
        }
        
        // Fetch custom fields
        const customFields = await dbConn.all(
            'SELECT field_name, field_value FROM user_custom_data WHERE user_id = ?',
            user.id
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
app.put('/api/admin/users/:id', async (req, res) => {
    try {
        const { email, first_name, last_name, customFields } = req.body;
        const dbConn = await getDb();
        
        // Check if user exists
        const existingUser = await dbConn.get('SELECT * FROM users WHERE id = ?', req.params.id);
        if (!existingUser) {
            return res.status(404).json({ error: 'Utente non trovato' });
        }
        
        // Check if email is already taken by another user
        if (email && email !== existingUser.email) {
            const emailExists = await dbConn.get('SELECT id FROM users WHERE email = ? AND id != ?', email, req.params.id);
            if (emailExists) {
                return res.status(400).json({ error: 'Email già utilizzata da un altro utente' });
            }
        }
        
        // Update user basic info
        await dbConn.run(
            'UPDATE users SET email = ?, first_name = ?, last_name = ? WHERE id = ?',
            email, first_name, last_name, req.params.id
        );
        
        // Update custom fields
        if (customFields && typeof customFields === 'object') {
            // Delete existing custom fields
            await dbConn.run('DELETE FROM user_custom_data WHERE user_id = ?', req.params.id);
            
            // Insert new custom fields
            for (const [fieldName, fieldValue] of Object.entries(customFields)) {
                if (fieldValue !== undefined && fieldValue !== '') {
                    await dbConn.run(
                        'INSERT INTO user_custom_data (user_id, field_name, field_value) VALUES (?, ?, ?)',
                        req.params.id, fieldName, fieldValue
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

app.get('/api/admin/coupons', async (req, res) => {
    try {
        const { status = 'active', limit = '50', offset = '0', order = 'desc' } = req.query;
        const orderDir = String(order).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
        const parsedLimit = Math.min(Math.max(parseInt(String(limit), 10) || 50, 1), 500);
        const parsedOffset = Math.max(parseInt(String(offset), 10) || 0, 0);

        const dbConn = await getDb();
        const params = [];
        let whereClause = '';
        if (status) {
            whereClause = 'WHERE c.status = ?';
            params.push(String(status));
        }

        const rows = await dbConn.all(
            `SELECT c.code, c.status, c.discount_type AS discountType, c.discount_value AS discountValue, 
                    c.issued_at AS issuedAt, c.redeemed_at AS redeemedAt,
                    u.email AS userEmail, camp.name AS campaignName
             FROM coupons c
             JOIN users u ON u.id = c.user_id
             LEFT JOIN campaigns camp ON camp.id = c.campaign_id
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
app.get('/api/admin/campaigns/:id/custom-fields', async (req, res) => {
    try {
        const dbConn = await getDb();
        const campaign = await dbConn.get('SELECT form_config FROM campaigns WHERE id = ?', req.params.id);
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

app.put('/api/admin/campaigns/:id/custom-fields', async (req, res) => {
    try {
        const { customFields } = req.body;
        const dbConn = await getDb();
        
        // Controlla il limite di 5 campi custom
        if (customFields && customFields.length > 5) {
            return res.status(400).json({ error: 'Limite massimo di 5 campi custom per campagna' });
        }
        
        // Get current form config
        const campaign = await dbConn.get('SELECT form_config FROM campaigns WHERE id = ?', req.params.id);
        if (!campaign) {
            return res.status(404).json({ error: 'Campagna non trovata' });
        }
        
        const formConfig = JSON.parse(campaign.form_config);
        formConfig.customFields = customFields || [];
        
        // Update campaign
        await dbConn.run('UPDATE campaigns SET form_config = ? WHERE id = ?', JSON.stringify(formConfig), req.params.id);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating custom fields:', error);
        res.status(500).json({ error: 'Errore nell\'aggiornamento dei campi custom' });
    }
});

// Products API
app.get('/api/admin/products', async (req, res) => {
    try {
        const dbConn = await getDb();
        const products = await dbConn.all('SELECT * FROM products ORDER BY created_at DESC');
        res.json(products);
    } catch (error) {
        console.error('Error fetching products:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/admin/products', async (req, res) => {
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
            'INSERT INTO products (name, value, margin_price, sku) VALUES (?, ?, ?, ?)',
            [name, parseFloat(value), parseFloat(margin_price), sku || null]
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

app.put('/api/admin/products/:id', async (req, res) => {
    try {
        const { name, value, margin_price, sku } = req.body;
        if (typeof name !== 'string' || !name.trim()) {
            return res.status(400).json({ error: 'Nome non valido' });
        }
        if (isNaN(parseFloat(value)) || isNaN(parseFloat(margin_price))) {
            return res.status(400).json({ error: 'Valori numerici non validi' });
        }
        const dbConn = await getDb();
        
        await dbConn.run(
            'UPDATE products SET name = ?, value = ?, margin_price = ?, sku = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [name, parseFloat(value), parseFloat(margin_price), sku || null, req.params.id]
        );
        
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

app.delete('/api/admin/products/:id', async (req, res) => {
    try {
        const dbConn = await getDb();
        await dbConn.run('DELETE FROM products WHERE id = ?', req.params.id);
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting product:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Campaign Products API
app.get('/api/admin/campaigns/:id/products', async (req, res) => {
    try {
        const dbConn = await getDb();
        const products = await dbConn.all(`
            SELECT p.*, cp.created_at as assigned_at
            FROM products p
            INNER JOIN campaign_products cp ON p.id = cp.product_id
            WHERE cp.campaign_id = ?
            ORDER BY p.name
        `, req.params.id);
        res.json(products);
    } catch (error) {
        console.error('Error fetching campaign products:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/admin/campaigns/:id/products', async (req, res) => {
    try {
        const { product_ids } = req.body;
        const dbConn = await getDb();
        
        // Remove existing associations
        await dbConn.run('DELETE FROM campaign_products WHERE campaign_id = ?', req.params.id);
        
        // Add new associations
        if (product_ids && product_ids.length > 0) {
            for (const product_id of product_ids) {
                await dbConn.run(
                    'INSERT INTO campaign_products (campaign_id, product_id) VALUES (?, ?)',
                    [req.params.id, product_id]
                );
            }
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating campaign products:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Admin page
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'admin.html'));
});
app.get('/t/:tenantSlug/admin', tenantLoader, requireSameTenantAsSession, requireRole('admin'), (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'admin.html'));
});

app.get('/formsetup', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'formsetup.html'));
});
app.get('/t/:tenantSlug/formsetup', tenantLoader, requireSameTenantAsSession, requireRole('admin'), (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'formsetup.html'));
});

app.get('/custom-fields', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'custom-fields.html'));
});
app.get('/t/:tenantSlug/custom-fields', tenantLoader, requireSameTenantAsSession, requireRole('admin'), (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'custom-fields.html'));
});

// New canonical route for aesthetic personalization
app.get('/form-design', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'form-setup.html'));
});
app.get('/t/:tenantSlug/form-design', tenantLoader, requireSameTenantAsSession, requireRole('admin'), (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'form-setup.html'));
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

app.get('/admin/email-template', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'email-template.html'));
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

app.get('/db-utenti', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'db-utenti.html'));
});
app.get('/t/:tenantSlug/db-utenti', tenantLoader, requireSameTenantAsSession, requireRole('admin'), (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'db-utenti.html'));
});

// Utenti (gestione auth_users admin/store)
app.get('/utenti', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'utenti.html'));
});
app.get('/t/:tenantSlug/utenti', tenantLoader, requireSameTenantAsSession, requireRole('admin'), (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'utenti.html'));
});

app.get('/prodotti', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'prodotti.html'));
});
app.get('/t/:tenantSlug/prodotti', tenantLoader, requireSameTenantAsSession, requireRole('admin'), (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'prodotti.html'));
});

// Analytics page
app.get('/analytics', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'analytics.html'));
});
app.get('/t/:tenantSlug/analytics', tenantLoader, requireSameTenantAsSession, requireRole('admin'), (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'analytics.html'));
});

// (moved 404 handler to the very end, before app.listen)

// Admin analytics: summary
app.get('/api/admin/analytics/summary', async (req, res) => {
    try {
        const dbConn = await getDb();
        const { start, end, campaignId, status } = req.query;

        const where = [];
        const params = [];
        if (campaignId) { where.push('campaign_id = ?'); params.push(campaignId); }
        if (start) { where.push('date(issued_at) >= date(?)'); params.push(start); }
        if (end) { where.push('date(issued_at) <= date(?)'); params.push(end); }
        if (status) { where.push('status = ?'); params.push(status); }
        const whereSql = where.length ? ('WHERE ' + where.join(' AND ')) : '';

        const coupons = await dbConn.all(
            `SELECT discount_type AS discountType, discount_value AS discountValue, status, campaign_id AS campaignId, issued_at AS issuedAt, redeemed_at AS redeemedAt FROM coupons ${whereSql}`,
            params
        );
        const campaigns = await dbConn.all('SELECT id FROM campaigns');

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
app.get('/api/admin/analytics/campaigns', async (req, res) => {
    try {
        const dbConn = await getDb();
        const { start, end, campaignId, status } = req.query;
        const campaigns = await dbConn.all('SELECT id, name FROM campaigns ORDER BY created_at DESC');

        const where = [];
        const params = [];
        if (campaignId) { where.push('campaign_id = ?'); params.push(campaignId); }
        if (start) { where.push('date(issued_at) >= date(?)'); params.push(start); }
        if (end) { where.push('date(issued_at) <= date(?)'); params.push(end); }
        if (status) { where.push('status = ?'); params.push(status); }
        const whereSql = where.length ? ('WHERE ' + where.join(' AND ')) : '';

        const coupons = await dbConn.all(
            `SELECT campaign_id AS campaignId, discount_type AS discountType, discount_value AS discountValue, status FROM coupons ${whereSql}`,
            params
        );
        const avgs = await dbConn.all(`
            SELECT cp.campaign_id AS campaignId, AVG(p.value) AS avgValue, AVG(p.margin_price) AS avgMargin
            FROM campaign_products cp
            JOIN products p ON p.id = cp.product_id
            GROUP BY cp.campaign_id
        `);
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
app.get('/api/admin/analytics/temporal', async (req, res) => {
    try {
        const dbConn = await getDb();
        const { start, end, campaignId, status, groupBy = 'day' } = req.query;

        const where = [];
        const params = [];
        if (campaignId) { where.push('campaign_id = ?'); params.push(campaignId); }
        if (start) { where.push('date(issued_at) >= date(?)'); params.push(start); }
        if (end) { where.push('date(issued_at) <= date(?)'); params.push(end); }
        if (status) { where.push('status = ?'); params.push(status); }
        const whereSql = where.length ? ('WHERE ' + where.join(' AND ')) : '';

        // Get temporal aggregation
        const dateFormat = groupBy === 'week' ? "strftime('%Y-W%W', issued_at)" : "date(issued_at)";
        const temporalData = await dbConn.all(`
            SELECT 
                ${dateFormat} as period,
                COUNT(*) as issued,
                SUM(CASE WHEN status = 'redeemed' THEN 1 ELSE 0 END) as redeemed,
                SUM(CASE WHEN status = 'redeemed' THEN 
                    CASE 
                        WHEN discount_type = 'percent' THEN (SELECT AVG(p.value) FROM campaign_products cp JOIN products p ON p.id = cp.product_id WHERE cp.campaign_id = c.campaign_id) * (discount_value / 100.0)
                        WHEN discount_type = 'fixed' THEN discount_value
                        ELSE 0
                    END
                ELSE 0 END) as discount_applied,
                SUM(CASE WHEN status = 'redeemed' THEN 
                    (SELECT AVG(p.margin_price) FROM campaign_products cp JOIN products p ON p.id = cp.product_id WHERE cp.campaign_id = c.campaign_id)
                ELSE 0 END) as gross_margin
            FROM coupons c
            ${whereSql}
            GROUP BY ${dateFormat}
            ORDER BY ${groupBy === 'week' ? "strftime('%Y', issued_at), strftime('%W', issued_at)" : "date(issued_at)"}
        `, params);

        res.json(temporalData);
    } catch (e) {
        console.error('analytics/temporal error', e);
        res.status(500).json({ error: 'Errore analytics temporali' });
    }
});

// Admin analytics: export CSV
app.get('/api/admin/analytics/export', async (req, res) => {
    try {
        const dbConn = await getDb();
        const { start, end, campaignId, status, format = 'csv' } = req.query;

        const where = [];
        const params = [];
        if (campaignId) { where.push('c.campaign_id = ?'); params.push(campaignId); }
        if (start) { where.push('date(c.issued_at) >= date(?)'); params.push(start); }
        if (end) { where.push('date(c.issued_at) <= date(?)'); params.push(end); }
        if (status) { where.push('c.status = ?'); params.push(status); }
        const whereSql = where.length ? ('WHERE ' + where.join(' AND ')) : '';

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
                (SELECT AVG(p.value) FROM campaign_products cp JOIN products p ON p.id = cp.product_id WHERE cp.campaign_id = c.campaign_id) as avg_product_value,
                (SELECT AVG(p.margin_price) FROM campaign_products cp JOIN products p ON p.id = cp.product_id WHERE cp.campaign_id = c.campaign_id) as avg_margin
            FROM coupons c
            LEFT JOIN campaigns camp ON camp.id = c.campaign_id
            LEFT JOIN users u ON u.id = c.user_id
            ${whereSql}
            ORDER BY c.issued_at DESC
        `, params);

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
app.get('/api/admin/auth-users', async (req, res) => {
    try {
        const sess = req.session && req.session.user;
        if (!sess || (sess.userType !== 'admin' && sess.userType !== 'superadmin')) return res.status(403).json({ error: 'Accesso negato' });
        const dbConn = await getDb();
        
        // Superadmin can see users from current tenant context, regular admin sees only their tenant
        const tenantId = sess.userType === 'superadmin' ? (req.tenant?.id || sess.tenantId || null) : (sess.tenantId || null);
        
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

app.post('/api/admin/auth-users', async (req, res) => {
    try {
        const sess = req.session && req.session.user;
        if (!sess || (sess.userType !== 'admin' && sess.userType !== 'superadmin')) return res.status(403).json({ error: 'Accesso negato' });
        const { username, password, user_type } = req.body || {};
        const role = String(user_type || '').toLowerCase();
        if (!username || !password || !['admin', 'store'].includes(role)) {
            return res.status(400).json({ error: 'Dati non validi' });
        }
        const dbConn = await getDb();
        // Simple hash to match existing approach
        const passwordHash = Buffer.from(String(password)).toString('base64');
        
        // Superadmin can create users in current tenant context, regular admin creates in their tenant
        const tenantId = sess.userType === 'superadmin' ? (req.tenant?.id || sess.tenantId || null) : (sess.tenantId || null);
        
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

app.put('/api/admin/auth-users/:id', async (req, res) => {
    try {
        const sess = req.session && req.session.user;
        if (!sess || (sess.userType !== 'admin' && sess.userType !== 'superadmin')) return res.status(403).json({ error: 'Accesso negato' });
        const { username, password, user_type, is_active } = req.body || {};
        const role = user_type ? String(user_type).toLowerCase() : undefined;
        if (role && !['admin', 'store'].includes(role)) {
            return res.status(400).json({ error: 'Ruolo non valido' });
        }
        const dbConn = await getDb();
        // Superadmin can modify users from current tenant context, regular admin sees only their tenant
        const tenantId = sess.userType === 'superadmin' ? (req.tenant?.id || sess.tenantId || null) : (sess.tenantId || null);
        const user = await dbConn.get('SELECT * FROM auth_users WHERE id = ? AND tenant_id = ?', req.params.id, tenantId);
        if (!user) return res.status(404).json({ error: 'Utente non trovato' });
        if (user.user_type === 'superadmin') return res.status(400).json({ error: 'Operazione non consentita' });
        // Admin non può modificare utenti con ruolo admin, tranne se è il primo admin
        if (user.user_type === 'admin' && sess.userType === 'admin') {
            const isCurrentUserFirstAdmin = await isFirstAdmin(dbConn, sess.authUserId || sess.id, tenantId);
            if (!isCurrentUserFirstAdmin) {
                return res.status(400).json({ error: 'Gli utenti admin non possono essere modificati' });
            }
        }
        if (user.id === (sess.authUserId || sess.id)) {
            // Prevent demoting or deactivating self
            if ((role && role !== 'admin') || (is_active === 0 || is_active === false)) {
                return res.status(400).json({ error: 'Non puoi disattivare o cambiare ruolo al tuo utente' });
            }
        }
        
        // Prevent first admin from being modified by others (including themselves for critical changes)
        const isTargetUserFirstAdmin = await isFirstAdmin(dbConn, user.id, tenantId);
        if (isTargetUserFirstAdmin && user.id !== (sess.authUserId || sess.id)) {
            return res.status(400).json({ error: 'Il primo admin non può essere modificato da altri utenti' });
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
            params.push(Buffer.from(String(password)).toString('base64'));
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

app.delete('/api/admin/auth-users/:id', async (req, res) => {
    try {
        const sess = req.session && req.session.user;
        if (!sess || (sess.userType !== 'admin' && sess.userType !== 'superadmin')) return res.status(403).json({ error: 'Accesso negato' });
        const dbConn = await getDb();
        // Superadmin can modify users from current tenant context, regular admin sees only their tenant
        const tenantId = sess.userType === 'superadmin' ? (req.tenant?.id || sess.tenantId || null) : (sess.tenantId || null);
        const user = await dbConn.get('SELECT * FROM auth_users WHERE id = ? AND tenant_id = ?', req.params.id, tenantId);
        if (!user) return res.status(404).json({ error: 'Utente non trovato' });
        if (user.user_type === 'superadmin') return res.status(400).json({ error: 'Operazione non consentita' });
        // Admin non può eliminare utenti con ruolo admin, tranne se è il primo admin
        if (user.user_type === 'admin' && sess.userType === 'admin') {
            const isCurrentUserFirstAdmin = await isFirstAdmin(dbConn, sess.authUserId || sess.id, tenantId);
            if (!isCurrentUserFirstAdmin) {
                return res.status(400).json({ error: 'Gli utenti admin non possono essere eliminati' });
            }
        }
        
        // Prevent first admin from being deleted
        const isTargetUserFirstAdmin = await isFirstAdmin(dbConn, user.id, tenantId);
        if (isTargetUserFirstAdmin) {
            return res.status(400).json({ error: 'Il primo admin non può essere eliminato' });
        }
        if (user.id === (sess.authUserId || sess.id)) return res.status(400).json({ error: 'Non puoi eliminare il tuo utente' });
        await dbConn.run('DELETE FROM auth_users WHERE id = ?', req.params.id);
        res.json({ ok: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Errore server' });
    }
});

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
        
        if (!verifyPassword(currentPassword, user.password_hash)) {
            return res.status(400).json({ error: 'Password attuale non corretta' });
        }
        
        // Update password
        const newPasswordHash = hashPassword(newPassword);
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
        
        // Verify password (simple base64 comparison for now)
        const passwordHash = Buffer.from(password).toString('base64');
        if (user.password_hash !== passwordHash) {
            return res.status(401).json({ error: 'Credenziali non valide' });
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
    try {
        if (req.session.user.userType !== 'superadmin') {
            return res.status(403).json({ error: 'Accesso negato' });
        }
        
        const tenantId = parseInt(req.params.id);
        if (isNaN(tenantId)) {
            return res.status(400).json({ error: 'ID tenant non valido' });
        }
        
        const db = await getDb();
        
        // Get tenant info before deletion
        const tenant = await db.get('SELECT * FROM tenants WHERE id = ?', tenantId);
        if (!tenant) {
            return res.status(404).json({ error: 'Tenant non trovato' });
        }
        
        // Delete all related data (cascading delete)
        await db.run('DELETE FROM coupons WHERE tenant_id = ?', tenantId);
        await db.run('DELETE FROM campaigns WHERE tenant_id = ?', tenantId);
        await db.run('DELETE FROM user_custom_data WHERE tenant_id = ?', tenantId);
        await db.run('DELETE FROM auth_users WHERE tenant_id = ?', tenantId);
        await db.run('DELETE FROM tenants WHERE id = ?', tenantId);
        
        // Log tenant deletion
        await logAction(req, 'delete', `Tenant eliminato: ${tenant.name}`, 'warning', {
            tenantId: tenantId,
            tenantName: tenant.name,
            tenantSlug: tenant.slug
        });
        
        res.json({ success: true, message: 'Tenant eliminato con successo' });
    } catch (error) {
        console.error('Error deleting tenant:', error);
        res.status(500).json({ error: 'Errore interno del server' });
    }
});

// 404 handler (must be last): serve friendly not-found page
app.use((req, res) => {
    res.status(404).sendFile(path.join(__dirname, 'views', '404.html'));
});

// Start server with proper timeout configurations
const server = app.listen(PORT, async () => {
    await getDb();
    console.log(`CouponGen avviato su http://localhost:${PORT}`);
});

// Configure server timeouts to prevent connection issues
server.keepAliveTimeout = 65000; // 65 seconds (same as nginx default)
server.headersTimeout = 66000;   // 66 seconds (slightly higher than keepAliveTimeout)
server.requestTimeout = 30000;   // 30 seconds for request processing
server.timeout = 30000;          // 30 seconds overall timeout

console.log('Server timeouts configured:');
console.log(`- Keep-Alive: ${server.keepAliveTimeout}ms`);
console.log(`- Headers: ${server.headersTimeout}ms`);
console.log(`- Request: ${server.requestTimeout}ms`);
console.log(`- Overall: ${server.timeout}ms`);


