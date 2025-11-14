'use strict';

const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const logger = require('./logger');

const DEFAULT_TENANT_SLUG = process.env.DEFAULT_TENANT_SLUG || 'default';
const DEFAULT_TENANT_NAME = process.env.DEFAULT_TENANT_NAME || 'Default Tenant';

// Database connection singleton
let db = null;

/**
 * Get database connection (singleton pattern).
 * 
 * Returns a singleton database connection instance. On first call:
 * 1. Creates data directory if it doesn't exist
 * 2. Opens SQLite database connection
 * 3. Configures database performance settings (WAL mode, cache size, etc.)
 * 4. Creates base tables if they don't exist
 * 5. Runs migrations if needed
 * 
 * Subsequent calls return the same connection instance.
 * 
 * @returns {Promise<Object>} Database connection object (sqlite Database instance)
 * 
 * @throws {Error} If database file cannot be created or opened
 * 
 * @example
 * const db = await getDb();
 * const campaigns = await db.all('SELECT * FROM campaigns WHERE tenant_id = ?', tenantId);
 * 
 * @description
 * Database configuration:
 * - WAL mode (Write-Ahead Logging) for better concurrency
 * - Cache size: 10000 pages
 * - Busy timeout: 30 seconds
 * - Temp store: MEMORY
 * 
 * @see {@link LLM_MD/DATABASE_SCHEMA.md} For database schema documentation
 */
async function getDb() {
    if (db) return db;
    
    // Ensure data directory exists
    const DATA_DIR = process.env.DATA_DIR
        ? path.resolve(process.env.DATA_DIR)
        : path.join(__dirname, '..', 'data');
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    
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
    
    // Create base tables
    await createBaseTables(db);
    
    // Run migrations
    await runMigrations(db);
    
    return db;
}

/**
 * Create base database tables.
 * 
 * Creates all base tables required by the application if they don't exist.
 * This function is idempotent (safe to call multiple times).
 * 
 * Tables created:
 * - tenants
 * - users
 * - campaigns
 * - coupons
 * - form_links
 * - user_custom_data
 * - system_logs
 * 
 * Also creates indexes for performance optimization.
 * 
 * @param {Object} dbConn - Database connection object
 * @returns {Promise<void>}
 * 
 * @throws {Error} If table creation fails
 * 
 * @see {@link LLM_MD/DATABASE_SCHEMA.md} For detailed schema documentation
 */
async function createBaseTables(dbConn) {
    await dbConn.exec(`
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
            form_config TEXT DEFAULT '{"email": {"visible": true, "required": true}, "firstName": {"visible": true, "required": true}, "lastName": {"visible": true, "required": true}, "phone": {"visible": false, "required": false}, "address": {"visible": false, "required": false}, "allergies": {"visible": false, "required": false}, "customFields": []}',
            expiry_date DATETIME,
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
}

/**
 * Run database migrations.
 * 
 * Executes all pending database migrations in order. Migrations are idempotent
 * and tracked in `schema_migrations` table to prevent duplicate execution.
 * 
 * Current migration version: `2025-10-mt-a2`
 * 
 * Migration steps:
 * 1. Creates migration tracking table
 * 2. Creates additional tables (auth_users, products, campaign_products, etc.)
 * 3. Ensures default tenant exists
 * 4. Migrates existing data (coupons, campaigns, users, etc.)
 * 5. Adds tenant_id columns where needed
 * 6. Creates indexes and constraints
 * 7. Ensures tenant-scoped unique constraints
 * 
 * @param {Object} dbConn - Database connection object
 * @returns {Promise<void>}
 * 
 * @throws {Error} If migration fails (foreign keys are re-enabled even on failure)
 * 
 * @description
 * Migrations are versioned and tracked. Each migration version is executed only once.
 * If a migration fails, foreign keys are re-enabled before throwing error.
 * 
 * @see {@link LLM_MD/DATABASE_SCHEMA.md} For schema details
 */
async function runMigrations(dbConn) {
    try {
        logger.info({ version: '2025-10-mt-a2' }, 'Starting database migration');
        
        // Create migrations table
        await dbConn.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
        const currentVersion = '2025-10-mt-a2';
        const hasVersion = await dbConn.get('SELECT 1 FROM schema_migrations WHERE version = ?', currentVersion);

        // STEP 1: Create all base tables FIRST (before any ALTER statements)
        logger.debug('Creating base tables');
        
        // Create auth_users table if it doesn't exist
        const authUsersTable = await dbConn.all("SELECT name FROM sqlite_master WHERE type='table' AND name='auth_users'");
        if (authUsersTable.length === 0) {
            logger.debug('Creating auth_users table');
            await dbConn.exec(`
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
        const formCustomizationTable = await dbConn.all("SELECT name FROM sqlite_master WHERE type='table' AND name='form_customization'");
        if (formCustomizationTable.length === 0) {
            logger.debug('Creating form_customization table');
            await dbConn.exec(`
                CREATE TABLE form_customization (
                    id INTEGER PRIMARY KEY,
                    tenant_id INTEGER,
                    config_data TEXT NOT NULL,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                );
            `);
            await dbConn.exec(`CREATE INDEX IF NOT EXISTS idx_form_customization_tenant_id ON form_customization(tenant_id)`);
        }

        // Create products table if it doesn't exist
        const productsTable = await dbConn.all("SELECT name FROM sqlite_master WHERE type='table' AND name='products'");
        if (productsTable.length === 0) {
            logger.debug('Creating products table');
            await dbConn.exec(`
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
            const productCols = await dbConn.all("PRAGMA table_info(products)");
            const hasTenantOnProducts = productCols.some(c => c.name === 'tenant_id');
            if (!hasTenantOnProducts) {
                logger.debug('Adding tenant_id column to products');
                await dbConn.exec('ALTER TABLE products ADD COLUMN tenant_id INTEGER');
            }
        }

        // Create campaign_products table if it doesn't exist
        const campaignProductsTable = await dbConn.all("SELECT name FROM sqlite_master WHERE type='table' AND name='campaign_products'");
        if (campaignProductsTable.length === 0) {
            logger.debug('Creating campaign_products table');
            await dbConn.exec(`
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
        const existingDefaultTenant = await dbConn.get('SELECT id FROM tenants WHERE slug = ?', DEFAULT_TENANT_SLUG);
        let defaultTenantId = existingDefaultTenant ? existingDefaultTenant.id : null;
        if (!defaultTenantId) {
            await dbConn.run('INSERT INTO tenants (slug, name) VALUES (?, ?)', DEFAULT_TENANT_SLUG, DEFAULT_TENANT_NAME);
            const row = await dbConn.get('SELECT id FROM tenants WHERE slug = ?', DEFAULT_TENANT_SLUG);
            defaultTenantId = row.id;
            logger.info({ slug: DEFAULT_TENANT_SLUG }, 'Created default tenant');
        }
        
        // Migrate coupons table
        await migrateCouponsTable(dbConn);
        
        // Migrate campaigns table
        await migrateCampaignsTable(dbConn, defaultTenantId);
        
        // Migrate users table
        await migrateUsersTable(dbConn);
        
        // Migrate user_custom_data table
        await migrateUserCustomDataTable(dbConn, defaultTenantId);
        
        // Migrate auth_users table
        await migrateAuthUsersTable(dbConn, defaultTenantId);
        
        // Migrate tenants table
        await migrateTenantsTable(dbConn);
        
        // Migrate email_template table
        await migrateEmailTemplateTable(dbConn, defaultTenantId);
        
        // Create tenant_brand_settings table
        await createTenantBrandSettingsTable(dbConn);
        
        // Create default users if auth_users table is empty
        await createDefaultUsers(dbConn, defaultTenantId);
        
        // Re-enable foreign keys after migration
        await dbConn.exec('PRAGMA foreign_keys = ON');
        
        // Ensure tenant-scoped unique constraints
        await ensureTenantScopedUniqueConstraints(dbConn);
        
        // Migration: Remove UNIQUE constraint from campaigns.name
        await removeUniqueConstraintFromCampaignsName(dbConn);
        
        if (!hasVersion) {
            await dbConn.run('INSERT INTO schema_migrations(version) VALUES (?)', currentVersion);
        }
        
        logger.info({ version: currentVersion }, 'Database migration completed successfully');
        
        // Create some initial sample logs for testing
        await createSampleLogs(dbConn);
        
    } catch (migrationError) {
        logger.error({ err: migrationError, version: '2025-10-mt-a2' }, 'Database migration error');
        // Re-enable foreign keys even if migration fails
        await dbConn.exec('PRAGMA foreign_keys = ON');
        throw migrationError;
    }
}

// Helper function to generate ID (needed for migrations)
function generateId(length = 12) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const bytes = crypto.randomBytes(length);
    let out = '';
    for (let i = 0; i < length; i++) {
        out += alphabet[bytes[i] % alphabet.length];
    }
    return out;
}

// Helper function to hash password
async function hashPassword(password) {
    return await bcrypt.hash(password, 10);
}

// Migration helper functions
async function migrateCouponsTable(dbConn) {
    const columns = await dbConn.all("PRAGMA table_info(coupons)");
    const columnNames = columns.map(col => col.name);
    
    if (!columnNames.includes('campaign_id')) {
        logger.debug('Adding campaign_id column to coupons...');
        await dbConn.exec('ALTER TABLE coupons ADD COLUMN campaign_id INTEGER');
    }
    
    if (!columnNames.includes('discount_type')) {
        logger.debug('Adding discount_type column to coupons...');
        await dbConn.exec("ALTER TABLE coupons ADD COLUMN discount_type TEXT DEFAULT 'percent'");
    }
    
    if (!columnNames.includes('discount_value')) {
        logger.debug('Adding discount_value column to coupons...');
        await dbConn.exec("ALTER TABLE coupons ADD COLUMN discount_value TEXT DEFAULT '10'");
    }
    
    // Migrate existing discount_percent to discount_value
    const hasOldColumn = columnNames.includes('discount_percent');
    if (hasOldColumn) {
        logger.info('Migrating discount_percent to discount_value...');
        await dbConn.exec('UPDATE coupons SET discount_value = CAST(discount_percent AS TEXT) WHERE discount_value = "10"');
        logger.info('Removing old discount_percent column...');
        // SQLite doesn't support DROP COLUMN directly, so we need to recreate the table
        await dbConn.exec(`
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
    await dbConn.exec('CREATE INDEX IF NOT EXISTS idx_coupons_campaign ON coupons(campaign_id)');
    if (!columnNames.includes('tenant_id')) {
        logger.debug('Adding tenant_id column to coupons...');
        await dbConn.exec('ALTER TABLE coupons ADD COLUMN tenant_id INTEGER');
    }
}

async function migrateCampaignsTable(dbConn, defaultTenantId) {
    const campaignColumns = await dbConn.all("PRAGMA table_info(campaigns)");
    const campaignColumnNames = campaignColumns.map(col => col.name);
    
    if (!campaignColumnNames.includes('campaign_code')) {
        logger.debug('Adding campaign_code column to campaigns...');
        await dbConn.exec(`ALTER TABLE campaigns ADD COLUMN campaign_code TEXT`);
        
        // Generate campaign codes for existing campaigns
        const existingCampaigns = await dbConn.all('SELECT id FROM campaigns WHERE campaign_code IS NULL');
        logger.info({ count: existingCampaigns.length }, 'Found campaigns without campaign_code');
        for (const campaign of existingCampaigns) {
            const campaignCode = generateId(12);
            await dbConn.run('UPDATE campaigns SET campaign_code = ? WHERE id = ?', campaignCode, campaign.id);
            logger.debug({ campaignId: campaign.id, campaignCode }, 'Generated campaign_code');
        }
    } else {
        // Check if there are campaigns without campaign_code
        const campaignsWithoutCode = await dbConn.all('SELECT id FROM campaigns WHERE campaign_code IS NULL');
        if (campaignsWithoutCode.length > 0) {
            logger.info({ count: campaignsWithoutCode.length }, 'Found campaigns without campaign_code, generating codes...');
            for (const campaign of campaignsWithoutCode) {
                const campaignCode = generateId(12).toUpperCase();
                await dbConn.run('UPDATE campaigns SET campaign_code = ? WHERE id = ?', campaignCode, campaign.id);
                logger.debug({ campaignId: campaign.id, campaignCode }, 'Generated campaign_code');
            }
        }
    }
    
    // Check if form_config column exists in campaigns table
    if (!campaignColumnNames.includes('form_config')) {
        logger.debug('Adding form_config column to campaigns...');
        await dbConn.exec(`ALTER TABLE campaigns ADD COLUMN form_config TEXT DEFAULT '{"email": {"visible": true, "required": true}, "firstName": {"visible": true, "required": true}, "lastName": {"visible": true, "required": true}}'`);
        
        // Set default form config for existing campaigns
        const existingCampaigns = await dbConn.all('SELECT id FROM campaigns WHERE form_config IS NULL');
        for (const campaign of existingCampaigns) {
            await dbConn.run('UPDATE campaigns SET form_config = ? WHERE id = ?', '{"email": {"visible": true, "required": true}, "firstName": {"visible": true, "required": true}, "lastName": {"visible": true, "required": true}}', campaign.id);
        }
    } else {
        // Migrate existing simple config to new structure
        const existingCampaigns = await dbConn.all('SELECT id, form_config FROM campaigns WHERE form_config IS NOT NULL');
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
                    await dbConn.run('UPDATE campaigns SET form_config = ? WHERE id = ?', JSON.stringify(newConfig), campaign.id);
                    logger.debug({ campaignId: campaign.id }, 'Migrated form config');
                }
            } catch (e) {
                logger.warn({ campaignId: campaign.id, error: e.message }, 'Skipping migration for campaign');
            }
        }
    }
    
    if (!campaignColumnNames.includes('tenant_id')) {
        logger.debug('Adding tenant_id column to campaigns...');
        await dbConn.exec('ALTER TABLE campaigns ADD COLUMN tenant_id INTEGER');
    }
    
    // Check if expiry_date column exists in campaigns table
    if (!campaignColumnNames.includes('expiry_date')) {
        logger.debug('Adding expiry_date column to campaigns...');
        await dbConn.exec('ALTER TABLE campaigns ADD COLUMN expiry_date DATETIME');
    }
}

async function migrateUsersTable(dbConn) {
    const userColumns = await dbConn.all("PRAGMA table_info(users)");
    const userColumnNames = userColumns.map(col => col.name);
    
    if (!userColumnNames.includes('phone')) {
        logger.debug('Adding phone column to users...');
        await dbConn.exec("ALTER TABLE users ADD COLUMN phone TEXT");
    }
    if (!userColumnNames.includes('address')) {
        logger.debug('Adding address column to users...');
        await dbConn.exec("ALTER TABLE users ADD COLUMN address TEXT");
    }
    if (!userColumnNames.includes('allergies')) {
        logger.debug('Adding allergies column to users...');
        await dbConn.exec("ALTER TABLE users ADD COLUMN allergies TEXT");
    }
    if (!userColumnNames.includes('tenant_id')) {
        logger.debug('Adding tenant_id column to users...');
        await dbConn.exec('ALTER TABLE users ADD COLUMN tenant_id INTEGER');
    }
}

async function migrateUserCustomDataTable(dbConn, defaultTenantId) {
    const customDataTable = await dbConn.all("SELECT name FROM sqlite_master WHERE type='table' AND name='user_custom_data'");
    if (customDataTable.length === 0) {
        logger.debug('Creating user_custom_data table');
        await dbConn.exec(`
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
        const userCustomDataCols = await dbConn.all("PRAGMA table_info(user_custom_data)");
        const userCustomDataColNames = userCustomDataCols.map(c => c.name);
        if (!userCustomDataColNames.includes('tenant_id')) {
            logger.debug('Adding tenant_id column to user_custom_data table...');
            await dbConn.exec('ALTER TABLE user_custom_data ADD COLUMN tenant_id INTEGER');
            // Set default tenant_id for existing records
            if (defaultTenantId) {
                await dbConn.run('UPDATE user_custom_data SET tenant_id = ? WHERE tenant_id IS NULL', defaultTenantId);
            }
        }
    }
}

async function migrateAuthUsersTable(dbConn, defaultTenantId) {
    // Ensure auth_users table exists BEFORE attempting to alter it
    const hasAuthUsersTable = await dbConn.all("SELECT name FROM sqlite_master WHERE type='table' AND name='auth_users'");
    if (hasAuthUsersTable.length === 0) {
        logger.debug('Creating auth_users table (missing before alteration step)');
        await dbConn.exec(`
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
    
    // Backfill tenant_id for existing rows to default tenant
    await dbConn.run('UPDATE users SET tenant_id = COALESCE(tenant_id, ?) WHERE tenant_id IS NULL', defaultTenantId);
    await dbConn.run('UPDATE campaigns SET tenant_id = COALESCE(tenant_id, ?) WHERE tenant_id IS NULL', defaultTenantId);
    await dbConn.run('UPDATE coupons SET tenant_id = COALESCE(tenant_id, ?) WHERE tenant_id IS NULL', defaultTenantId);
    
    // Check if user_custom_data has tenant_id column before updating
    const userCustomDataCols = await dbConn.all("PRAGMA table_info(user_custom_data)");
    const userCustomDataColNames = userCustomDataCols.map(c => c.name);
    if (userCustomDataColNames.includes('tenant_id')) {
        await dbConn.run('UPDATE user_custom_data SET tenant_id = COALESCE(tenant_id, ?) WHERE tenant_id IS NULL', defaultTenantId);
    }
    
    await dbConn.run('UPDATE auth_users SET tenant_id = COALESCE(tenant_id, ?) WHERE tenant_id IS NULL', defaultTenantId);

    // Indexes and unique constraints
    await dbConn.exec('CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id)');
    await dbConn.exec('CREATE INDEX IF NOT EXISTS idx_campaigns_tenant ON campaigns(tenant_id)');
    await dbConn.exec('CREATE INDEX IF NOT EXISTS idx_coupons_tenant ON coupons(tenant_id)');
    if (userCustomDataColNames.includes('tenant_id')) {
        await dbConn.exec('CREATE INDEX IF NOT EXISTS idx_ucd_tenant ON user_custom_data(tenant_id)');
    }
    await dbConn.exec('CREATE UNIQUE INDEX IF NOT EXISTS ux_users_tenant_email ON users(tenant_id, email)');
    await dbConn.exec('CREATE UNIQUE INDEX IF NOT EXISTS ux_coupons_tenant_code ON coupons(tenant_id, code)');
    
    // Performance indexes for analytics queries
    await dbConn.exec('CREATE INDEX IF NOT EXISTS idx_coupons_tenant_campaign_status ON coupons(tenant_id, campaign_id, status)');
    await dbConn.exec('CREATE INDEX IF NOT EXISTS idx_coupons_tenant_issued_at ON coupons(tenant_id, issued_at)');
    
    // Create email_template index only if tenant_id column exists
    const emailTemplateCols = await dbConn.all("PRAGMA table_info(email_template)");
    const emailTemplateColNames = emailTemplateCols.map(c => c.name);
    if (emailTemplateColNames.includes('tenant_id')) {
        await dbConn.exec('CREATE INDEX IF NOT EXISTS idx_email_template_tenant ON email_template(tenant_id)');
    }
}

async function migrateTenantsTable(dbConn) {
    const tenantColumnsAll = await dbConn.all("PRAGMA table_info(tenants)");
    const tenantColumnNames = tenantColumnsAll.map(c => c.name);
    
    // Add email_from_name column to tenants table if it doesn't exist
    const hasEmailFromName = tenantColumnsAll.some(col => col.name === 'email_from_name');
    if (!hasEmailFromName) {
        logger.debug('Adding email_from_name column to tenants table...');
        await dbConn.exec('ALTER TABLE tenants ADD COLUMN email_from_name TEXT DEFAULT "CouponGen"');
    }
    
    if (!tenantColumnNames.includes('email_from_address')) {
        logger.debug('Adding email_from_address column to tenants table...');
        await dbConn.exec('ALTER TABLE tenants ADD COLUMN email_from_address TEXT');
    }
    if (!tenantColumnNames.includes('mailgun_domain')) {
        logger.debug('Adding mailgun_domain column to tenants table...');
        await dbConn.exec('ALTER TABLE tenants ADD COLUMN mailgun_domain TEXT');
    }
    if (!tenantColumnNames.includes('mailgun_region')) {
        logger.debug('Adding mailgun_region column to tenants table...');
        await dbConn.exec('ALTER TABLE tenants ADD COLUMN mailgun_region TEXT');
    }
    if (!tenantColumnNames.includes('custom_domain')) {
        logger.debug('Adding custom_domain column to tenants table...');
        await dbConn.exec('ALTER TABLE tenants ADD COLUMN custom_domain TEXT');
    }
}

async function migrateEmailTemplateTable(dbConn, defaultTenantId) {
    const emailTemplateTable = await dbConn.all("SELECT name FROM sqlite_master WHERE type='table' AND name='email_template'");
    if (emailTemplateTable.length === 0) {
        logger.debug('Creating email_template table');
        await dbConn.exec(`
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
        const emailTemplateCols = await dbConn.all("PRAGMA table_info(email_template)");
        const emailTemplateColNames = emailTemplateCols.map(c => c.name);
        if (!emailTemplateColNames.includes('tenant_id')) {
            logger.debug('Adding tenant_id column to email_template...');
            await dbConn.exec('ALTER TABLE email_template ADD COLUMN tenant_id INTEGER');
            // Migrate existing template to default tenant
            await dbConn.run('UPDATE email_template SET tenant_id = ? WHERE tenant_id IS NULL', defaultTenantId);
        }
    }
}

async function createTenantBrandSettingsTable(dbConn) {
    const brandSettingsTable = await dbConn.all("SELECT name FROM sqlite_master WHERE type='table' AND name='tenant_brand_settings'");
    if (brandSettingsTable.length === 0) {
        logger.debug('Creating tenant_brand_settings table');
        await dbConn.exec(`
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
}

async function createDefaultUsers(dbConn, defaultTenantId) {
    const userCount = await dbConn.get('SELECT COUNT(*) as count FROM auth_users');
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
        
        await dbConn.run(`
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
}

async function removeUniqueConstraintFromCampaignsName(dbConn) {
    try {
        const tableInfo = await dbConn.all("SELECT sql FROM sqlite_master WHERE type='table' AND name='campaigns'");
        const tableSql = tableInfo.length > 0 ? (tableInfo[0].sql || '') : '';
        logger.debug({ tableSql: tableSql.substring(0, 300) }, 'Checking campaigns table definition for UNIQUE constraint on name');
        
        const upperSql = tableSql.toUpperCase();
        const hasExplicitUniqueOnName = upperSql.match(/NAME\s+TEXT\s+(NOT\s+NULL\s+)?UNIQUE/) !== null;
        const hasGlobalUniqueOnName = hasExplicitUniqueOnName || 
                                     (upperSql.includes('NAME') && 
                                      upperSql.includes('UNIQUE') &&
                                      !upperSql.match(/NAME.*TENANT_ID.*UNIQUE|UNIQUE.*TENANT_ID.*NAME/));
        
        const shouldMigrate = hasGlobalUniqueOnName;
        
        logger.info({ hasGlobalUniqueOnName, hasExplicitUniqueOnName, shouldMigrate }, 'UNIQUE constraint check result');
        
        if (tableInfo.length > 0 && tableInfo[0].sql && shouldMigrate) {
            logger.info('Removing UNIQUE constraint from campaigns.name by recreating table');
            
            // Create new table without UNIQUE on name
            await dbConn.exec(`
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
            await dbConn.exec(`
                INSERT INTO campaigns_new (id, campaign_code, name, description, is_active, discount_type, discount_value, form_config, expiry_date, created_at, tenant_id)
                SELECT id, campaign_code, name, description, is_active, discount_type, discount_value, form_config, expiry_date, created_at, tenant_id
                FROM campaigns
            `);
            
            // Drop old table
            await dbConn.exec('DROP TABLE campaigns');
            
            // Rename new table
            await dbConn.exec('ALTER TABLE campaigns_new RENAME TO campaigns');
            
            // Recreate indexes
            await dbConn.exec('CREATE INDEX IF NOT EXISTS idx_campaigns_tenant ON campaigns(tenant_id)');
            await ensureTenantScopedUniqueConstraints(dbConn);
            
            logger.info('Successfully removed UNIQUE constraint from campaigns.name');
        }
    } catch (e) {
        logger.error({ err: e }, 'Error removing UNIQUE constraint from campaigns.name');
        // Don't fail the migration if this fails - it might already be fixed
    }
}

async function createSampleLogs(dbConn) {
    try {
        const sampleLogs = await dbConn.all('SELECT COUNT(*) as count FROM system_logs');
        if (sampleLogs[0].count === 0) {
            logger.debug('Creating sample logs for testing');
            await dbConn.run(`
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
}

/**
 * Ensure tenant email columns exist in tenants table
 */
async function ensureTenantEmailColumns(dbConn) {
    if (!dbConn) return;
    const columns = await dbConn.all("PRAGMA table_info(tenants)");
    const columnNames = new Set(columns.map(c => c.name));
    const ensureColumn = async (name, ddl) => {
        if (!columnNames.has(name)) {
            logger.debug({ column: name }, 'Adding column to tenants table');
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
    // Import parseMailFrom dynamically to avoid circular dependency
    const { parseMailFrom } = require('./email');
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

/**
 * Ensure form_customization table has tenant_id column
 */
async function ensureFormCustomizationTenantId(dbConn) {
    if (!dbConn) return;
    try {
        const columns = await dbConn.all("PRAGMA table_info(form_customization)");
        const columnNames = new Set(columns.map(c => c.name));
        
        if (!columnNames.has('tenant_id')) {
            logger.debug('Adding tenant_id column to form_customization table');
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
            logger.error({ err: e }, 'Error ensuring form_customization tenant_id');
        }
    }
}

/**
 * Ensure tenant-scoped unique constraints on campaigns table
 */
async function ensureTenantScopedUniqueConstraints(dbConn) {
    if (!dbConn) return;
    try {
        // Get all indexes with their SQL definitions to check for UNIQUE constraints
        const indexes = await dbConn.all("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='campaigns'");
        const indexNames = new Set(indexes.map(idx => idx.name));
        
        logger.debug({ indexes: indexes.map(idx => ({ name: idx.name, sql: idx.sql })) }, 'Current indexes on campaigns table');
        
        // Remove old global unique indexes if they exist
        for (const idx of indexes) {
            const sql = (idx.sql || '').toUpperCase();
            const isUnique = sql.includes('UNIQUE');
            const isGlobal = !idx.name.includes('tenant') && !idx.name.includes('_tenant');
            
            // Remove global unique indexes on campaign_code
            if (idx.name === 'idx_campaigns_code' || (isUnique && isGlobal && sql.includes('CAMPAIGN_CODE'))) {
                logger.info({ index: idx.name }, 'Removing global unique index on campaign_code');
                await dbConn.exec(`DROP INDEX IF EXISTS ${idx.name}`);
                indexNames.delete(idx.name);
            }
            
            // Remove global unique indexes on name
            if (isUnique && isGlobal && (sql.includes('NAME') || idx.name.includes('name'))) {
                logger.info({ index: idx.name, sql: idx.sql }, 'Removing global unique index on name');
                await dbConn.exec(`DROP INDEX IF EXISTS ${idx.name}`);
                indexNames.delete(idx.name);
            }
        }
        
        // Create tenant-scoped unique indexes
        if (!indexNames.has('idx_campaigns_code_tenant')) {
            logger.info('Creating tenant-scoped unique index on campaigns(campaign_code, tenant_id)');
            await dbConn.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_campaigns_code_tenant ON campaigns(campaign_code, tenant_id)');
        } else {
            logger.debug('Tenant-scoped unique index on campaign_code already exists');
        }
        
        // Remove unique constraint on name to allow duplicate names per tenant
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

module.exports = {
    getDb,
    ensureTenantEmailColumns,
    ensureFormCustomizationTenantId,
    ensureTenantScopedUniqueConstraints
};

