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
        const cols = await db.all("PRAGMA table_info(tenants)");
        const names = cols.map(c => c.name);
        if (!names.includes('email_from_name')) {
            console.log('Adding email_from_name...');
            await db.exec('ALTER TABLE tenants ADD COLUMN email_from_name TEXT DEFAULT "CouponGen"');
        }
        if (!names.includes('email_from_address')) {
            console.log('Adding email_from_address...');
            await db.exec('ALTER TABLE tenants ADD COLUMN email_from_address TEXT');
        }
        if (!names.includes('mailgun_domain')) {
            console.log('Adding mailgun_domain...');
            await db.exec('ALTER TABLE tenants ADD COLUMN mailgun_domain TEXT');
        }
        if (!names.includes('mailgun_region')) {
            console.log('Adding mailgun_region...');
            await db.exec('ALTER TABLE tenants ADD COLUMN mailgun_region TEXT');
        }
        if (!names.includes('custom_domain')) {
            console.log('Adding custom_domain...');
            await db.exec('ALTER TABLE tenants ADD COLUMN custom_domain TEXT');
        }
        console.log('✅ Migration applied (tenant email columns ensured).');
    } catch (e) {
        console.error('❌ Migration error:', e.message);
        process.exit(1);
    } finally {
        await db.close();
    }
})();




