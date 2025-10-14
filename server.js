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
// Mailgun SDK
const formData = require('form-data');
const Mailgun = require('mailgun.js');
const { nanoid } = require('nanoid');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/static', express.static(path.join(__dirname, 'static')));

// Session configuration
app.use(session({
    secret: process.env.SESSION_SECRET || 'coupon-gen-secret-key-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// Ensure data directory exists
const DATA_DIR = path.join(__dirname, 'data');
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
    // First, create tables without foreign keys to avoid migration issues
    await db.exec(`
        PRAGMA foreign_keys = OFF;
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL,
            first_name TEXT,
            last_name TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
            redeemed_at DATETIME
        );
        CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code);
        CREATE TABLE IF NOT EXISTS user_custom_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            field_name TEXT NOT NULL,
            field_value TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_user_custom_data_user_id ON user_custom_data(user_id);
        CREATE INDEX IF NOT EXISTS idx_user_custom_data_field_name ON user_custom_data(field_name);
    `);
    
    // Migrate existing database
    try {
        console.log('Starting database migration...');
        
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
                const campaignCode = nanoid(12).toUpperCase();
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
                    const campaignCode = nanoid(12).toUpperCase();
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
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                );
                CREATE INDEX IF NOT EXISTS idx_user_custom_data_user_id ON user_custom_data(user_id);
                CREATE INDEX IF NOT EXISTS idx_user_custom_data_field_name ON user_custom_data(field_name);
            `);
        }

        // Email template table
        const emailTemplateTable = await db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='email_template'");
        if (emailTemplateTable.length === 0) {
            console.log('Creating email_template table...');
            await db.exec(`
                CREATE TABLE email_template (
                    id INTEGER PRIMARY KEY,
                    subject TEXT NOT NULL,
                    html TEXT NOT NULL,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                );
                INSERT INTO email_template (id, subject, html) VALUES (
                    1,
                    'Il tuo coupon',
                    '<p>Ciao {{firstName}} {{lastName}},</p>\n<p>Ecco il tuo coupon: <strong>{{code}}</strong> che vale {{discountText}}.</p>\n<p>Mostra questo codice in negozio. Puoi anche usare questo link per la cassa: <a href="{{redemptionUrl}}">{{redemptionUrl}}</a></p>\n<p><img src="cid:couponqr" alt="QR Code" /></p>\n<p>Grazie!</p>'
                );
            `);
        }

        // Check if form_customization table exists
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
        
        // Check if auth_users table exists
        const authUsersTable = await db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='auth_users'");
        if (authUsersTable.length === 0) {
            console.log('Creating auth_users table...');
            await db.exec(`
                CREATE TABLE auth_users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT NOT NULL UNIQUE,
                    password_hash TEXT NOT NULL,
                    user_type TEXT NOT NULL CHECK (user_type IN ('admin', 'store')),
                    is_active BOOLEAN DEFAULT 1,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    last_login DATETIME
                );
            `);
            
            // Create default admin user if no users exist
            const defaultAdminPassword = process.env.ADMIN_PASSWORD || 'admin123';
            const defaultStorePassword = process.env.STORE_PASSWORD || 'store123';
            
            // Simple password hashing (in production, use bcrypt)
            const adminHash = Buffer.from(defaultAdminPassword).toString('base64');
            const storeHash = Buffer.from(defaultStorePassword).toString('base64');
            
            await db.run(`
                INSERT INTO auth_users (username, password_hash, user_type) 
                VALUES ('admin', ?, 'admin'), ('store', ?, 'store')
            `, adminHash, storeHash);
            
            console.log('Default users created:');
            console.log('- Admin: username=admin, password=' + defaultAdminPassword);
            console.log('- Store: username=store, password=' + defaultStorePassword);
        }
        
        // Check if products table exists
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
        
        // Check if campaign_products table exists
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
        
        // Re-enable foreign keys after migration
        await db.exec('PRAGMA foreign_keys = ON');
        
        console.log('Database migration completed successfully');
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
            url: (process.env.MAILGUN_REGION || 'eu') === 'us' ? 'https://api.mailgun.net' : 'https://api.eu.mailgun.net'
        });
        // Wrap Mailgun client in a Nodemailer-like interface used below
        return {
            async sendMail(message) {
                // Build Mailgun message
                const data = {
                    from: message.from || (process.env.MAILGUN_FROM || 'CouponGen <no-reply@example.com>'),
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
                const result = await mg.messages.create(domain, data);
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
            } : undefined
        });
    }
    // Fallback to JSON transport (logs emails to console)
    return nodemailer.createTransport({ jsonTransport: true });
}

const transporter = buildTransport();

// Authentication middleware
function requireAuth(req, res, next) {
    if (req.session && req.session.user) {
        return next();
    } else {
        return res.redirect('/login');
    }
}

function requireAdmin(req, res, next) {
    if (req.session && req.session.user && req.session.user.userType === 'admin') {
        return next();
    } else {
        return res.status(403).send('Accesso negato. Richiesto ruolo Admin.');
    }
}

function requireStore(req, res, next) {
    if (req.session && req.session.user && req.session.user.userType === 'store') {
        return next();
    } else {
        return res.status(403).send('Accesso negato. Richiesto ruolo Store.');
    }
}

// Simple password verification (in production, use bcrypt)
function verifyPassword(password, hash) {
    return Buffer.from(password).toString('base64') === hash;
}

// Login API endpoint
app.post('/api/login', async (req, res) => {
    try {
        const { username, password, userType } = req.body;
        
        if (!username || !password || !userType) {
            return res.status(400).json({ error: 'Username, password e tipo utente sono richiesti' });
        }
        
        const dbConn = await getDb();
        const user = await dbConn.get(
            'SELECT * FROM auth_users WHERE username = ? AND user_type = ? AND is_active = 1',
            username, userType
        );
        
        if (!user || !verifyPassword(password, user.password_hash)) {
            return res.status(401).json({ error: 'Credenziali non valide' });
        }
        
        // Update last login
        await dbConn.run(
            'UPDATE auth_users SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
            user.id
        );
        
        // Create session
        req.session.user = {
            id: user.id,
            username: user.username,
            userType: user.user_type
        };
        
        // Determine redirect URL
        let redirectUrl = '/';
        if (userType === 'admin') {
            redirectUrl = '/admin';
        } else if (userType === 'store') {
            redirectUrl = '/store';
        }
        
        res.json({ 
            success: true, 
            message: 'Login effettuato con successo',
            redirect: redirectUrl
        });
        
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Errore interno del server' });
    }
});

// Logout API endpoint
app.post('/api/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Logout error:', err);
            return res.status(500).json({ error: 'Errore durante il logout' });
        }
        res.json({ success: true, message: 'Logout effettuato con successo' });
    });
});

// Login page
app.get('/login', (req, res) => {
    // If already logged in, redirect to appropriate page
    if (req.session && req.session.user) {
        if (req.session.user.userType === 'admin') {
            return res.redirect('/admin');
        } else if (req.session.user.userType === 'store') {
            return res.redirect('/store');
        }
    }
    res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

// Test email endpoint (admin protected)
app.get('/api/admin/test-email', requireAdmin, async (req, res) => {
    try {
        const to = req.query.to || process.env.MAIL_TEST_TO || 'test@example.com';
        const html = `<p>Test Mailgun integrazione da CouponGen.</p>`;
        const message = {
            from: process.env.MAIL_FROM || process.env.MAILGUN_FROM || 'CouponGen <no-reply@example.com>',
            to,
            subject: 'Test Email - CouponGen',
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

// Email template APIs (admin)
app.get('/api/admin/email-template', requireAdmin, async (req, res) => {
    try {
        const dbConn = await getDb();
        const row = await dbConn.get('SELECT subject, html, updated_at FROM email_template WHERE id = 1');
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
        await dbConn.run(
            `INSERT INTO email_template (id, subject, html, updated_at)
             VALUES (1, ?, ?, datetime('now'))
             ON CONFLICT(id) DO UPDATE SET subject = excluded.subject, html = excluded.html, updated_at = excluded.updated_at`,
            subject, html
        );
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

// API per configurazione form (pubblica)
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
        console.log('Ricevuta richiesta POST per form-customization (pubblico):', req.body);
        const configData = JSON.stringify(req.body);
        
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

app.get('/thanks', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'thanks.html'));
});

// Form submission - create user and coupon, send email with QR
app.post('/submit', async (req, res) => {
    try {
        const { email, firstName, lastName, campaign_id, ...customFields } = req.body;
        if (!email) {
            return res.status(400).send('Email richiesta');
        }
        const couponCode = nanoid(12).toUpperCase();

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

        const redemptionUrl = `${req.protocol}://${req.get('host')}/redeem/${couponCode}`;
        const qrDataUrl = await QRCode.toDataURL(couponCode, { width: 300, margin: 2 });

        const discountText = discountType === 'percent' ? `uno sconto del ${discountValue}%` : 
                            discountType === 'fixed' ? `uno sconto di &euro;${discountValue}` : discountValue;
        // Load email template
        let templateSubject = process.env.MAIL_SUBJECT || 'Il tuo coupon';
        let templateHtml = '';
        try {
            const t = await dbConn.get('SELECT subject, html FROM email_template WHERE id = 1');
            if (t) { templateSubject = t.subject || templateSubject; templateHtml = t.html || templateHtml; }
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
            from: process.env.MAIL_FROM || process.env.MAILGUN_FROM || 'CouponGen <no-reply@example.com>',
            to: email,
            subject: templateSubject,
            html,
            attachments: [
                {   // inline QR
                    filename: 'coupon.png',
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

// Store area - protected by session authentication
app.use('/store', requireAuth);
app.use('/api/store', requireStore);

// Admin area - protected by session authentication  
app.use('/admin', requireAuth);
app.use('/api/admin', requireAdmin);

app.get('/store', (req, res) => {
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

// Public: get campaign by code (for form parameter)
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
        
        if (!name || !discount_type || !discount_value) {
            return res.status(400).json({ error: 'Nome, tipo sconto e valore richiesti' });
        }
        
        const dbConn = await getDb();
        const campaignCode = nanoid(12).toUpperCase();
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

app.get('/formsetup', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'formsetup.html'));
});

app.get('/custom-fields', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'custom-fields.html'));
});

// New canonical route for aesthetic personalization
app.get('/form-design', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'form-setup.html'));
});

// Legacy/Direct file URL redirects to canonical route
// Legacy redirects
app.get('/admin/form-setup', (req, res) => res.redirect('/form-design'));
app.get('/form-setup', (req, res) => res.redirect('/form-design'));
app.get('/views/form-setup.html', (req, res) => res.redirect('/form-design'));

app.get('/admin/email-template', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'email-template.html'));
});

app.get('/db-utenti', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'db-utenti.html'));
});

app.get('/prodotti', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'prodotti.html'));
});

// Analytics page
app.get('/analytics', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'analytics.html'));
});

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

// Protected redemption page (QR link opens this for cashier)
app.use('/redeem', requireAuth);

app.get('/redeem/:code', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'redeem.html'));
});

// Minimal health
app.get('/health', (req, res) => res.json({ ok: true }));

// Start server
app.listen(PORT, async () => {
    await getDb();
    console.log(`CouponGen avviato su http://localhost:${PORT}`);
});


