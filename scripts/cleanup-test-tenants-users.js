#!/usr/bin/env node

const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

// Tenants to keep: default and any tenant with "mario" in the slug

async function main() {
  const dbPath = path.join(__dirname, '..', 'data', 'coupons.db');
  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  try {
    await db.exec('PRAGMA foreign_keys = OFF');
    await db.exec('BEGIN TRANSACTION');

    // Get tenant IDs to keep: default + any tenant with "mario" in slug
    const tenantsToKeep = await db.all(
      `SELECT id, slug FROM tenants 
       WHERE slug = ? OR slug LIKE '%mario%'`,
      'default'
    );
    
    const tenantIdsToKeep = tenantsToKeep.map(t => t.id);
    console.log('Tenants to keep:', tenantsToKeep.map(t => `${t.slug} (id: ${t.id})`).join(', '));

    if (tenantIdsToKeep.length === 0) {
      console.error('ERROR: Could not find tenants to keep!');
      process.exit(1);
    }

    // Get all tenants
    const allTenants = await db.all('SELECT id, slug, name FROM tenants');
    const tenantsToDelete = allTenants.filter(t => !tenantIdsToKeep.includes(t.id));
    
    console.log(`\nFound ${tenantsToDelete.length} tenants to delete:`);
    tenantsToDelete.forEach(t => console.log(`  - ${t.slug} (id: ${t.id})`));

    if (tenantsToDelete.length === 0) {
      console.log('\nNo tenants to delete.');
      await db.exec('ROLLBACK');
      await db.close();
      return;
    }

    const tenantIdsToDelete = tenantsToDelete.map(t => t.id);

    // Get auth_users to keep (superadmin + users from kept tenants)
    const authUsersToKeep = await db.all(
      `SELECT id, username, user_type, tenant_id 
       FROM auth_users 
       WHERE user_type = 'superadmin' OR tenant_id IN (${tenantIdsToKeep.map(() => '?').join(',')})`,
      ...tenantIdsToKeep
    );
    
    console.log(`\nAuth users to keep (${authUsersToKeep.length}):`);
    authUsersToKeep.forEach(u => console.log(`  - ${u.username} (${u.user_type}, tenant_id: ${u.tenant_id})`));

    const authUserIdsToKeep = authUsersToKeep.map(u => u.id);
    const authUserIdsToDelete = await db.all(
      `SELECT id FROM auth_users WHERE id NOT IN (${authUserIdsToKeep.map(() => '?').join(',')})`,
      ...authUserIdsToKeep
    );

    console.log(`\nAuth users to delete: ${authUserIdsToDelete.length}`);

    // Delete data associated with tenants to delete
    console.log('\nDeleting data for test tenants...');

    // Delete form_links
    const formLinksDeleted = await db.run(
      `DELETE FROM form_links WHERE tenant_id IN (${tenantIdsToDelete.map(() => '?').join(',')})`,
      ...tenantIdsToDelete
    );
    console.log(`  - Deleted ${formLinksDeleted.changes} form_links`);

    // Delete coupons
    const couponsDeleted = await db.run(
      `DELETE FROM coupons WHERE tenant_id IN (${tenantIdsToDelete.map(() => '?').join(',')})`,
      ...tenantIdsToDelete
    );
    console.log(`  - Deleted ${couponsDeleted.changes} coupons`);

    // Delete campaigns
    const campaignsDeleted = await db.run(
      `DELETE FROM campaigns WHERE tenant_id IN (${tenantIdsToDelete.map(() => '?').join(',')})`,
      ...tenantIdsToDelete
    );
    console.log(`  - Deleted ${campaignsDeleted.changes} campaigns`);

    // Delete user_custom_data
    const customDataDeleted = await db.run(
      `DELETE FROM user_custom_data WHERE tenant_id IN (${tenantIdsToDelete.map(() => '?').join(',')})`,
      ...tenantIdsToDelete
    );
    console.log(`  - Deleted ${customDataDeleted.changes} user_custom_data entries`);

    // Delete users (regular users, not auth_users)
    const usersDeleted = await db.run(
      `DELETE FROM users WHERE tenant_id IN (${tenantIdsToDelete.map(() => '?').join(',')})`,
      ...tenantIdsToDelete
    );
    console.log(`  - Deleted ${usersDeleted.changes} users`);

    // Delete system_logs
    const logsDeleted = await db.run(
      `DELETE FROM system_logs WHERE tenant_id IN (${tenantIdsToDelete.map(() => '?').join(',')})`,
      ...tenantIdsToDelete
    );
    console.log(`  - Deleted ${logsDeleted.changes} system_logs entries`);

    // Delete auth_users
    if (authUserIdsToDelete.length > 0) {
      const authUsersDeleted = await db.run(
        `DELETE FROM auth_users WHERE id IN (${authUserIdsToDelete.map(() => '?').join(',')})`,
        ...authUserIdsToDelete.map(u => u.id)
      );
      console.log(`  - Deleted ${authUsersDeleted.changes} auth_users`);
    }

    // Delete tenant email configs if table exists
    try {
      const tenantEmailDeleted = await db.run(
        `DELETE FROM tenant_email_configs WHERE tenant_id IN (${tenantIdsToDelete.map(() => '?').join(',')})`,
        ...tenantIdsToDelete
      );
      console.log(`  - Deleted ${tenantEmailDeleted.changes} tenant_email_configs entries`);
    } catch (e) {
      // Table might not exist, ignore
    }

    // Delete tenant brand settings if table exists
    try {
      const brandDeleted = await db.run(
        `DELETE FROM tenant_brand_settings WHERE tenant_id IN (${tenantIdsToDelete.map(() => '?').join(',')})`,
        ...tenantIdsToDelete
      );
      console.log(`  - Deleted ${brandDeleted.changes} tenant_brand_settings entries`);
    } catch (e) {
      // Table might not exist, ignore
    }

    // Finally, delete the tenants themselves
    const tenantsDeleted = await db.run(
      `DELETE FROM tenants WHERE id IN (${tenantIdsToDelete.map(() => '?').join(',')})`,
      ...tenantIdsToDelete
    );
    console.log(`  - Deleted ${tenantsDeleted.changes} tenants`);

    await db.exec('COMMIT');
    await db.exec('PRAGMA foreign_keys = ON');
    await db.exec('VACUUM');

    console.log('\n✅ Cleanup completed successfully!');
    console.log(`\nRemaining tenants: ${tenantsToKeep.length}`);
    tenantsToKeep.forEach(t => console.log(`  - ${t.slug} (id: ${t.id})`));
    
    console.log(`\nRemaining auth users: ${authUsersToKeep.length}`);
    authUsersToKeep.forEach(u => console.log(`  - ${u.username} (${u.user_type}, tenant_id: ${u.tenant_id})`));

  } catch (err) {
    console.error('❌ Cleanup failed:', err);
    await db.exec('ROLLBACK');
    process.exit(1);
  } finally {
    await db.close();
  }
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});

