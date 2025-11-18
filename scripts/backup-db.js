#!/usr/bin/env node
/**
 * Database Backup Script
 * 
 * Creates incremental backups of SQLite database with compression and retention policy.
 * 
 * Usage:
 *   node scripts/backup-db.js
 *   npm run backup:db
 * 
 * Environment Variables:
 *   DATA_DIR - Directory containing database (default: ./data)
 *   BACKUP_DIR - Directory for backups (default: ./backups)
 *   BACKUP_RETENTION_DAYS - Days to keep backups (default: 7)
 *   BACKUP_COMPRESSION - Enable gzip compression (default: true)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');
const { getDb } = require('../utils/db');
const logger = require('../utils/logger');

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const unlink = promisify(fs.unlink);
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups');
const RETENTION_DAYS = Number(process.env.BACKUP_RETENTION_DAYS || 7);
const COMPRESSION_ENABLED = String(process.env.BACKUP_COMPRESSION || 'true') === 'true';

const DB_FILE = path.join(DATA_DIR, 'coupons.db');
const DB_WAL_FILE = path.join(DATA_DIR, 'coupons.db-wal');
const DB_SHM_FILE = path.join(DATA_DIR, 'coupons.db-shm');

/**
 * Ensure backup directory exists
 */
function ensureBackupDir() {
    if (!fs.existsSync(BACKUP_DIR)) {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
        logger.info({ backupDir: BACKUP_DIR }, 'Created backup directory');
    }
}

/**
 * Generate backup filename with timestamp
 */
function generateBackupFilename() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const extension = COMPRESSION_ENABLED ? '.db.gz' : '.db';
    return `coupons-${timestamp}${extension}`;
}

/**
 * Copy file with error handling
 */
async function copyFile(src, dest) {
    try {
        const data = await readFile(src);
        await writeFile(dest, data);
        return true;
    } catch (error) {
        if (error.code === 'ENOENT') {
            // File doesn't exist, skip (e.g., WAL/SHM files may not exist)
            return false;
        }
        throw error;
    }
}

/**
 * Compress file using gzip
 */
async function compressFile(filePath) {
    return new Promise((resolve, reject) => {
        const gzip = zlib.createGzip();
        const input = fs.createReadStream(filePath);
        const output = fs.createWriteStream(filePath + '.gz');
        
        input.pipe(gzip).pipe(output);
        
        output.on('finish', () => {
            // Remove original file after compression
            fs.unlink(filePath, (err) => {
                if (err && err.code !== 'ENOENT') {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
        
        output.on('error', reject);
        input.on('error', reject);
    });
}

/**
 * Create database backup
 */
async function createBackup() {
    try {
        ensureBackupDir();
        
        // Check if database file exists
        if (!fs.existsSync(DB_FILE)) {
            throw new Error(`Database file not found: ${DB_FILE}`);
        }
        
        logger.info({ dbFile: DB_FILE, backupDir: BACKUP_DIR }, 'Starting database backup');
        
        // Close database connection if open (to ensure WAL checkpoint)
        // Note: getDb() returns singleton, but we can't easily close it
        // SQLite will handle WAL checkpoint automatically
        
        const backupFilename = generateBackupFilename();
        const backupPath = path.join(BACKUP_DIR, backupFilename);
        
        // Copy main database file
        await copyFile(DB_FILE, backupPath);
        logger.info({ backupFile: backupFilename }, 'Database file copied');
        
        // Copy WAL and SHM files if they exist (for consistency)
        // Note: These are usually small and help ensure backup consistency
        if (fs.existsSync(DB_WAL_FILE)) {
            const walBackupPath = backupPath.replace(/\.db(\.gz)?$/, '.db-wal');
            await copyFile(DB_WAL_FILE, walBackupPath);
            logger.debug({ walFile: 'coupons.db-wal' }, 'WAL file copied');
        }
        
        if (fs.existsSync(DB_SHM_FILE)) {
            const shmBackupPath = backupPath.replace(/\.db(\.gz)?$/, '.db-shm');
            await copyFile(DB_SHM_FILE, shmBackupPath);
            logger.debug({ shmFile: 'coupons.db-shm' }, 'SHM file copied');
        }
        
        // Compress if enabled
        if (COMPRESSION_ENABLED && !backupPath.endsWith('.gz')) {
            logger.info({ backupFile: backupFilename }, 'Compressing backup');
            await compressFile(backupPath);
            logger.info({ backupFile: backupFilename + '.gz' }, 'Backup compressed');
        }
        
        // Get backup file size
        const finalBackupPath = COMPRESSION_ENABLED ? backupPath + '.gz' : backupPath;
        const stats = await stat(finalBackupPath);
        const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
        
        logger.info({
            backupFile: path.basename(finalBackupPath),
            sizeMB,
            compression: COMPRESSION_ENABLED
        }, 'Backup completed successfully');
        
        return {
            success: true,
            backupFile: path.basename(finalBackupPath),
            backupPath: finalBackupPath,
            size: stats.size,
            sizeMB: parseFloat(sizeMB),
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        logger.error({ err: error }, 'Backup failed');
        throw error;
    }
}

/**
 * Cleanup old backups based on retention policy
 */
async function cleanupOldBackups() {
    try {
        if (!fs.existsSync(BACKUP_DIR)) {
            return { deleted: 0 };
        }
        
        const files = await readdir(BACKUP_DIR);
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);
        
        let deleted = 0;
        const errors = [];
        
        for (const file of files) {
            // Only process backup files (coupons-*.db or coupons-*.db.gz)
            if (!file.startsWith('coupons-') || (!file.endsWith('.db') && !file.endsWith('.db.gz'))) {
                continue;
            }
            
            const filePath = path.join(BACKUP_DIR, file);
            
            try {
                const stats = await stat(filePath);
                
                if (stats.mtime < cutoffDate) {
                    await unlink(filePath);
                    deleted++;
                    logger.debug({ file }, 'Deleted old backup');
                    
                    // Also delete associated WAL/SHM files if they exist
                    const walFile = file.replace(/\.db(\.gz)?$/, '.db-wal');
                    const shmFile = file.replace(/\.db(\.gz)?$/, '.db-shm');
                    
                    const walPath = path.join(BACKUP_DIR, walFile);
                    const shmPath = path.join(BACKUP_DIR, shmFile);
                    
                    if (fs.existsSync(walPath)) {
                        await unlink(walPath).catch(() => {});
                    }
                    if (fs.existsSync(shmPath)) {
                        await unlink(shmPath).catch(() => {});
                    }
                }
            } catch (error) {
                errors.push({ file, error: error.message });
            }
        }
        
        if (deleted > 0) {
            logger.info({ deleted, retentionDays: RETENTION_DAYS }, 'Cleaned up old backups');
        }
        
        if (errors.length > 0) {
            logger.warn({ errors }, 'Some files could not be deleted during cleanup');
        }
        
        return { deleted, errors };
    } catch (error) {
        logger.error({ err: error }, 'Error cleaning up old backups');
        throw error;
    }
}

/**
 * List available backups
 */
async function listBackups() {
    try {
        if (!fs.existsSync(BACKUP_DIR)) {
            return [];
        }
        
        const files = await readdir(BACKUP_DIR);
        const backups = [];
        
        for (const file of files) {
            if (!file.startsWith('coupons-') || (!file.endsWith('.db') && !file.endsWith('.db.gz'))) {
                continue;
            }
            
            const filePath = path.join(BACKUP_DIR, file);
            const stats = await stat(filePath);
            
            backups.push({
                filename: file,
                path: filePath,
                size: stats.size,
                sizeMB: (stats.size / 1024 / 1024).toFixed(2),
                created: stats.birthtime.toISOString(),
                modified: stats.mtime.toISOString(),
                compressed: file.endsWith('.gz')
            });
        }
        
        // Sort by creation date (newest first)
        backups.sort((a, b) => new Date(b.created) - new Date(a.created));
        
        return backups;
    } catch (error) {
        logger.error({ err: error }, 'Error listing backups');
        throw error;
    }
}

/**
 * Main function
 */
async function main() {
    const command = process.argv[2] || 'backup';
    
    try {
        switch (command) {
            case 'backup':
                const result = await createBackup();
                await cleanupOldBackups();
                console.log(JSON.stringify(result, null, 2));
                break;
                
            case 'list':
                const backups = await listBackups();
                console.log(JSON.stringify(backups, null, 2));
                break;
                
            case 'cleanup':
                const cleanupResult = await cleanupOldBackups();
                console.log(JSON.stringify(cleanupResult, null, 2));
                break;
                
            default:
                console.error(`Unknown command: ${command}`);
                console.error('Usage: node scripts/backup-db.js [backup|list|cleanup]');
                process.exit(1);
        }
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}

// Run if executed directly
if (require.main === module) {
    main();
}

module.exports = {
    createBackup,
    cleanupOldBackups,
    listBackups
};

