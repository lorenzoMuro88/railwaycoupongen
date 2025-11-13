#!/usr/bin/env node

require('dotenv').config();
const { open } = require('sqlite');
const sqlite3 = require('sqlite3');
const path = require('path');

(async () => {
    const DATA_DIR = process.env.DATA_DIR || './data';
    const DB_PATH = path.join(DATA_DIR, 'coupons.db');
    const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
    try {
        // Check if table has UNIQUE constraint on name
        const tableInfo = await db.all("SELECT sql FROM sqlite_master WHERE type='table' AND name='campaigns'");
        const tableSql = tableInfo.length > 0 ? (tableInfo[0].sql || '') : '';
        const upperSql = tableSql.toUpperCase();
        const hasExplicitUniqueOnName = upperSql.match(/NAME\s+TEXT\s+(NOT\s+NULL\s+)?UNIQUE/) !== null;
        
        console.log('Table SQL:', tableSql.substring(0, 200));
        console.log('Has UNIQUE on name:', hasExplicitUniqueOnName);
        
        if (!hasExplicitUniqueOnName) {
            console.log('✅ No UNIQUE constraint on name found. Migration not needed.');
            return;
        }
        
        console.log('Removing UNIQUE constraint from campaigns.name by recreating table...');
        
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
        await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_campaigns_code_tenant ON campaigns(campaign_code, tenant_id)');
        await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_campaigns_name_tenant ON campaigns(name, tenant_id)');
        
        console.log('✅ Migration applied successfully. UNIQUE constraint removed from campaigns.name');
    } catch (e) {
        console.error('❌ Migration error:', e.message);
        console.error(e);
        process.exit(1);
    } finally {
        await db.close();
    }
})();


