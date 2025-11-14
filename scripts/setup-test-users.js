#!/usr/bin/env node
/**
 * Setup Test Users
 * Crea gli utenti di test necessari per eseguire tutti i test suite
 */

const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const bcrypt = require('bcrypt');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'coupons.db');

const TEST_USERS = [
    {
        username: 'superadmin',
        password: 'superadmin123',
        userType: 'superadmin',
        tenantId: null // superadmin non ha tenant_id
    },
    {
        username: 'admin',
        password: 'admin123',
        userType: 'superadmin', // admin è superadmin nel sistema
        tenantId: null
    },
    {
        username: 'mario123',
        password: 'admin123',
        userType: 'admin',
        tenantId: null // verrà impostato al default tenant
    },
    {
        username: 'store',
        password: 'store123',
        userType: 'store',
        tenantId: null // verrà impostato al default tenant
    }
];

async function setupTestUsers() {
    console.log('=== Setup Test Users ===\n');
    
    const db = await open({
        filename: DB_PATH,
        driver: sqlite3.Database
    });

    // Get default tenant
    let defaultTenant = await db.get('SELECT id FROM tenants WHERE slug = ?', ['default']);
    if (!defaultTenant) {
        // Create default tenant if it doesn't exist
        await db.run('INSERT INTO tenants (slug, name) VALUES (?, ?)', ['default', 'Default Tenant']);
        defaultTenant = await db.get('SELECT id FROM tenants WHERE slug = ?', ['default']);
    }
    const defaultTenantId = defaultTenant.id;
    console.log(`Default tenant ID: ${defaultTenantId}\n`);

    // Ensure auth_users table exists
    const tableExists = await db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='auth_users'");
    if (tableExists.length === 0) {
        console.log('Creating auth_users table...');
        await db.exec(`
            CREATE TABLE auth_users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL,
                password_hash TEXT NOT NULL,
                user_type TEXT NOT NULL CHECK (user_type IN ('superadmin', 'admin', 'store')),
                tenant_id INTEGER,
                is_active BOOLEAN DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                last_login DATETIME,
                FOREIGN KEY (tenant_id) REFERENCES tenants(id)
            );
        `);
        console.log('✓ auth_users table created\n');
    }

    // Check if tenant_id column exists
    const columns = await db.all("PRAGMA table_info(auth_users)");
    const hasTenantId = columns.some(c => c.name === 'tenant_id');
    if (!hasTenantId) {
        console.log('Adding tenant_id column to auth_users...');
        await db.run('ALTER TABLE auth_users ADD COLUMN tenant_id INTEGER');
        await db.run('CREATE INDEX IF NOT EXISTS idx_auth_users_tenant ON auth_users(tenant_id)');
        console.log('✓ tenant_id column added\n');
    }

    console.log('Creating/updating test users:\n');

    for (const user of TEST_USERS) {
        const passwordHash = await bcrypt.hash(user.password, 10);
        const tenantId = user.tenantId || (user.userType === 'superadmin' ? null : defaultTenantId);

        // Check if user exists
        const existing = await db.get(
            'SELECT * FROM auth_users WHERE username = ?',
            [user.username]
        );

        if (existing) {
            // Update existing user
            await db.run(
                `UPDATE auth_users 
                 SET password_hash = ?, user_type = ?, tenant_id = ?, is_active = 1 
                 WHERE username = ?`,
                passwordHash, user.userType, tenantId, user.username
            );
            console.log(`✓ Updated: ${user.username} (${user.userType})`);
        } else {
            // Create new user
            await db.run(
                `INSERT INTO auth_users (username, password_hash, user_type, tenant_id, is_active) 
                 VALUES (?, ?, ?, ?, 1)`,
                user.username, passwordHash, user.userType, tenantId
            );
            console.log(`✓ Created: ${user.username} (${user.userType})`);
        }
    }

    console.log('\n=== Test Users Setup Complete ===\n');
    console.log('Credentials:');
    console.log('  Superadmin: superadmin / superadmin123');
    console.log('  Admin (superadmin): admin / admin123');
    console.log('  Admin (tenant): mario123 / admin123');
    console.log('  Store: store / store123');
    console.log('\nYou can now run: npm run test:all\n');

    await db.close();
}

setupTestUsers().catch(err => {
    console.error('Error:', err);
    process.exit(1);
});

