#!/usr/bin/env node

const path = require('path');
const { open } = require('sqlite');
const sqlite3 = require('sqlite3');

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    users: 5,
    coupons: 20,
    campaigns: 3,
    logs: 200,
    authUsers: 2,
    products: 10
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--users' && args[i + 1]) result.users = parseInt(args[++i], 10);
    else if (arg === '--coupons' && args[i + 1]) result.coupons = parseInt(args[++i], 10);
    else if (arg === '--campaigns' && args[i + 1]) result.campaigns = parseInt(args[++i], 10);
    else if (arg === '--logs' && args[i + 1]) result.logs = parseInt(args[++i], 10);
    else if (arg === '--auth-users' && args[i + 1]) result.authUsers = parseInt(args[++i], 10);
    else if (arg === '--products' && args[i + 1]) result.products = parseInt(args[++i], 10);
  }
  return result;
}

async function openDb() {
  const dbPath = path.resolve(__dirname, '..', 'data', 'coupons.db');
  const db = await open({ filename: dbPath, driver: sqlite3.Database });
  return db;
}

const ALLOWED_TABLES = new Set(['users','campaigns','coupons','system_logs','auth_users','products','user_custom_data','campaign_products']);

function assertAllowedTable(tableName) {
  if (!ALLOWED_TABLES.has(tableName)) {
    throw new Error(`Table not allowed: ${tableName}`);
  }
}

async function selectIdsToKeep(db, tableName, limit) {
  assertAllowedTable(tableName);
  const rows = await db.all(`SELECT id FROM ${tableName} ORDER BY id DESC LIMIT ?`, limit);
  return rows.map(r => r.id);
}

async function deleteBeyondKeepIds(db, tableName, idsToKeep) {
  assertAllowedTable(tableName);
  if (idsToKeep.length === 0) {
    await db.run(`DELETE FROM ${tableName}`);
    return;
  }
  const placeholders = idsToKeep.map(() => '?').join(',');
  await db.run(`DELETE FROM ${tableName} WHERE id NOT IN (${placeholders})`, idsToKeep);
}

async function cleanupOrphans(db) {
  // Remove coupons referencing deleted users or campaigns
  await db.run(`DELETE FROM coupons WHERE user_id IS NOT NULL AND user_id NOT IN (SELECT id FROM users)`);
  await db.run(`DELETE FROM coupons WHERE campaign_id IS NOT NULL AND campaign_id NOT IN (SELECT id FROM campaigns)`);

  // Remove custom data orphaned by user deletions
  await db.run(`DELETE FROM user_custom_data WHERE user_id NOT IN (SELECT id FROM users)`);

  // Remove campaign_products orphaned by campaign or product deletions (best-effort)
  await db.run(`DELETE FROM campaign_products WHERE campaign_id NOT IN (SELECT id FROM campaigns)`);
  await db.run(`DELETE FROM campaign_products WHERE product_id NOT IN (SELECT id FROM products)`);
}

async function main() {
  const limits = parseArgs();
  const db = await openDb();
  try {
    await db.exec('PRAGMA foreign_keys = OFF');
    await db.exec('BEGIN');

    // Determine which IDs to keep
    const usersKeep = await selectIdsToKeep(db, 'users', limits.users);
    const campaignsKeep = await selectIdsToKeep(db, 'campaigns', limits.campaigns);
    const couponsKeep = await selectIdsToKeep(db, 'coupons', limits.coupons);
    const logsKeep = await selectIdsToKeep(db, 'system_logs', limits.logs);
    const authUsersKeep = await selectIdsToKeep(db, 'auth_users', limits.authUsers);
    const productsKeep = await selectIdsToKeep(db, 'products', limits.products);

    // Trim main tables
    await deleteBeyondKeepIds(db, 'users', usersKeep);
    await deleteBeyondKeepIds(db, 'campaigns', campaignsKeep);
    await deleteBeyondKeepIds(db, 'coupons', couponsKeep);
    await deleteBeyondKeepIds(db, 'system_logs', logsKeep);
    await deleteBeyondKeepIds(db, 'auth_users', authUsersKeep);
    await deleteBeyondKeepIds(db, 'products', productsKeep);

    // Cleanup dependent/orphaned rows
    await cleanupOrphans(db);

    await db.exec('COMMIT');

    // Re-enable FKs and vacuum
    await db.exec('PRAGMA foreign_keys = ON');
    await db.exec('VACUUM');

    console.log('Database cleanup complete. Kept:', limits);
  } catch (err) {
    console.error('Cleanup failed:', err);
    try { await db.exec('ROLLBACK'); } catch {}
    process.exitCode = 1;
  } finally {
    await db.close();
  }
}

main();


