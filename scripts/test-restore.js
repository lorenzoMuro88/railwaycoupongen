#!/usr/bin/env node
/**
 * Database Restore Test Script
 * 
 * Tests database restore functionality by:
 * 1. Creating a backup
 * 2. Modifying the database
 * 3. Restoring from backup
 * 4. Verifying data integrity
 * 
 * Usage:
 *   node scripts/test-restore.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');
const { getDb } = require('../utils/db');
const { createBackup, listBackups } = require('./backup-db');

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);
const gunzip = promisify(zlib.gunzip);

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups');
const DB_FILE = path.join(DATA_DIR, 'coupons.db');

let testResults = [];

function log(message) {
    console.log(`[TEST] ${message}`);
}

async function test(name, fn) {
    try {
        await fn();
        testResults.push({ name, status: 'PASS', error: null });
        log(`✅ PASS: ${name}`);
    } catch (error) {
        testResults.push({ name, status: 'FAIL', error: error.message });
        log(`❌ FAIL: ${name} - ${error.message}`);
    }
}

/**
 * Get database row count for a table
 */
async function getTableRowCount(db, tableName) {
    const result = await db.get(`SELECT COUNT(*) as count FROM ${tableName}`);
    return result ? result.count : 0;
}

/**
 * Restore database from backup file
 */
async function restoreFromBackup(backupPath) {
    const isCompressed = backupPath.endsWith('.gz');
    
    if (isCompressed) {
        // Decompress backup
        const compressedData = await readFile(backupPath);
        const decompressedData = await gunzip(compressedData);
        await writeFile(DB_FILE, decompressedData);
    } else {
        // Copy backup directly
        const backupData = await readFile(backupPath);
        await writeFile(DB_FILE, backupData);
    }
    
    log(`Database restored from ${path.basename(backupPath)}`);
}

async function runTests() {
    log('=== Database Restore Test Suite ===\n');
    
    try {
        // ===== TEST 1: Create Backup =====
        log('=== TEST 1: Create Backup ===');
        
        let backupFile = null;
        
        await test('Create backup before modifications', async () => {
            const result = await createBackup();
            if (!result.success) {
                throw new Error('Backup creation failed');
            }
            backupFile = result.backupPath;
            log(`Backup created: ${path.basename(backupFile)}`);
        });
        
        if (!backupFile) {
            log('❌ Cannot proceed without backup');
            process.exit(1);
        }
        
        // ===== TEST 2: Modify Database =====
        log('\n=== TEST 2: Modify Database ===');
        
        let originalCounts = {};
        let modifiedCounts = {};
        
        await test('Get original row counts', async () => {
            const db = await getDb();
            originalCounts = {
                tenants: await getTableRowCount(db, 'tenants'),
                campaigns: await getTableRowCount(db, 'campaigns'),
                coupons: await getTableRowCount(db, 'coupons'),
                users: await getTableRowCount(db, 'users')
            };
            log(`Original counts: ${JSON.stringify(originalCounts)}`);
        });
        
        await test('Modify database (add test data)', async () => {
            const db = await getDb();
            
            // Add a test campaign
            await db.run(
                'INSERT INTO campaigns (campaign_code, name, discount_type, discount_value, tenant_id, is_active) VALUES (?, ?, ?, ?, ?, ?)',
                'TEST123', 'Test Campaign Restore', 'percent', '50', 1, 0
            );
            
            // Get modified counts
            modifiedCounts = {
                tenants: await getTableRowCount(db, 'tenants'),
                campaigns: await getTableRowCount(db, 'campaigns'),
                coupons: await getTableRowCount(db, 'coupons'),
                users: await getTableRowCount(db, 'users')
            };
            
            if (modifiedCounts.campaigns <= originalCounts.campaigns) {
                throw new Error('Database modification failed');
            }
            
            log(`Modified counts: ${JSON.stringify(modifiedCounts)}`);
        });
        
        // ===== TEST 3: Restore Database =====
        log('\n=== TEST 3: Restore Database ===');
        
        await test('Restore database from backup', async () => {
            // Close database connection before restore
            // Note: getDb() returns singleton, we can't easily close it
            // SQLite will handle file locking
            
            await restoreFromBackup(backupFile);
            
            // Re-open database connection
            const db = await getDb();
            
            // Verify restore worked
            const restoredCounts = {
                tenants: await getTableRowCount(db, 'tenants'),
                campaigns: await getTableRowCount(db, 'campaigns'),
                coupons: await getTableRowCount(db, 'coupons'),
                users: await getTableRowCount(db, 'users')
            };
            
            log(`Restored counts: ${JSON.stringify(restoredCounts)}`);
            
            // Verify counts match original
            if (restoredCounts.campaigns !== originalCounts.campaigns) {
                throw new Error(`Campaign count mismatch: expected ${originalCounts.campaigns}, got ${restoredCounts.campaigns}`);
            }
            
            if (restoredCounts.tenants !== originalCounts.tenants) {
                throw new Error(`Tenant count mismatch: expected ${originalCounts.tenants}, got ${restoredCounts.tenants}`);
            }
        });
        
        await test('Verify test campaign was removed', async () => {
            const db = await getDb();
            const testCampaign = await db.get(
                'SELECT * FROM campaigns WHERE campaign_code = ?',
                'TEST123'
            );
            
            if (testCampaign) {
                throw new Error('Test campaign still exists after restore');
            }
        });
        
        // ===== TEST 4: Backup File Integrity =====
        log('\n=== TEST 4: Backup File Integrity ===');
        
        await test('Verify backup file exists and is readable', async () => {
            if (!fs.existsSync(backupFile)) {
                throw new Error(`Backup file not found: ${backupFile}`);
            }
            
            const stats = fs.statSync(backupFile);
            if (stats.size === 0) {
                throw new Error('Backup file is empty');
            }
            
            log(`Backup file size: ${(stats.size / 1024).toFixed(2)} KB`);
        });
        
        // ===== SUMMARY =====
        log('\n=== TEST SUMMARY ===');
        const passed = testResults.filter(r => r.status === 'PASS').length;
        const failed = testResults.filter(r => r.status === 'FAIL').length;
        const total = testResults.length;
        
        log(`Total tests: ${total}`);
        log(`Passed: ${passed}`);
        log(`Failed: ${failed}`);
        
        if (failed > 0) {
            log('\nFailed tests:');
            testResults.filter(r => r.status === 'FAIL').forEach(r => {
                log(`  - ${r.name}: ${r.error}`);
            });
        }
        
        if (failed > 0) {
            process.exit(1);
        } else {
            log('\n✅ All tests passed!');
            process.exit(0);
        }
        
    } catch (error) {
        log(`\n❌ Fatal error: ${error.message}`);
        console.error(error);
        process.exit(1);
    }
}

// Run tests
runTests();


