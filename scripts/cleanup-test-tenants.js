#!/usr/bin/env node

/**
 * Script per eliminare tenant e utenti di test
 * 
 * Mantiene invariati:
 * - Tenant 6 (Mario)
 * - Tenant di default (slug='default')
 * - Utenti admin (auth_users con user_type IN ('admin', 'superadmin'))
 * 
 * Elimina tutti gli altri tenant e i loro dati correlati.
 */

const path = require('path');
const { open } = require('sqlite');
const sqlite3 = require('sqlite3').verbose();

const DEFAULT_TENANT_SLUG = process.env.DEFAULT_TENANT_SLUG || 'default';

async function openDb() {
    const dbPath = path.resolve(__dirname, '..', 'data', 'coupons.db');
    const db = await open({ filename: dbPath, driver: sqlite3.Database });
    return db;
}

async function safeDelete(db, tableName, whereClause, params, fallbackQuery = null) {
    try {
        // Check if table exists
        const tableExists = await db.get(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
            tableName
        );
        
        if (!tableExists) {
            console.log(`  ⚠️  Tabella ${tableName} non esiste, skip`);
            return 0;
        }
        
        // Check if column exists for tenant_id queries
        if (whereClause.includes('tenant_id')) {
            const columns = await db.all(`PRAGMA table_info(${tableName})`);
            const hasTenantId = columns.some(col => col.name === 'tenant_id');
            if (!hasTenantId) {
                console.log(`  ⚠️  Tabella ${tableName} non ha tenant_id, skip`);
                return 0;
            }
        }
        
        const query = fallbackQuery || `DELETE FROM ${tableName} WHERE ${whereClause}`;
        const result = await db.run(query, params);
        return result.changes || 0;
    } catch (error) {
        console.error(`  ❌ Errore eliminando da ${tableName}:`, error.message);
        return 0;
    }
}

async function main() {
    const db = await openDb();
    
    try {
        console.log('🔍 Analisi tenant nel database...\n');
        
        // Get all tenants
        const allTenants = await db.all('SELECT id, slug, name FROM tenants ORDER BY id');
        console.log(`Trovati ${allTenants.length} tenant totali:\n`);
        allTenants.forEach(t => {
            console.log(`  - ID: ${t.id}, Slug: ${t.slug}, Nome: ${t.name || '(nessuno)'}`);
        });
        
        // Identify tenants to keep
        const defaultTenant = await db.get('SELECT id FROM tenants WHERE slug = ?', DEFAULT_TENANT_SLUG);
        const marioTenant = await db.get('SELECT id FROM tenants WHERE id = ?', 6);
        
        const tenantsToKeep = new Set();
        if (defaultTenant) {
            tenantsToKeep.add(defaultTenant.id);
            console.log(`\n✅ Tenant di default da preservare: ID ${defaultTenant.id} (slug: ${DEFAULT_TENANT_SLUG})`);
        } else {
            console.log(`\n⚠️  Tenant di default (slug: ${DEFAULT_TENANT_SLUG}) non trovato!`);
        }
        
        if (marioTenant) {
            tenantsToKeep.add(marioTenant.id);
            console.log(`✅ Tenant 6 (Mario) da preservare: ID ${marioTenant.id}`);
        } else {
            console.log(`⚠️  Tenant 6 (Mario) non trovato!`);
        }
        
        // Get admin users to preserve
        const adminUsers = await db.all(
            "SELECT id, username, user_type, tenant_id FROM auth_users WHERE user_type IN ('admin', 'superadmin')"
        );
        console.log(`\n✅ Utenti admin da preservare: ${adminUsers.length}`);
        adminUsers.forEach(u => {
            console.log(`  - ID: ${u.id}, Username: ${u.username}, Tipo: ${u.user_type}, Tenant ID: ${u.tenant_id || '(null)'}`);
        });
        
        // Identify tenants to delete
        const tenantsToDelete = allTenants.filter(t => !tenantsToKeep.has(t.id));
        
        if (tenantsToDelete.length === 0) {
            console.log('\n✅ Nessun tenant di test da eliminare. Tutti i tenant sono da preservare.');
            return;
        }
        
        console.log(`\n🗑️  Tenant da eliminare: ${tenantsToDelete.length}`);
        tenantsToDelete.forEach(t => {
            console.log(`  - ID: ${t.id}, Slug: ${t.slug}, Nome: ${t.name || '(nessuno)'}`);
        });
        
        // Confirm deletion (unless --force flag is present)
        const forceFlag = process.argv.includes('--force');
        
        if (!forceFlag) {
            console.log('\n⚠️  ATTENZIONE: Questa operazione eliminerà definitivamente i tenant di test e tutti i loro dati correlati.');
            console.log('   Premi Ctrl+C per annullare, oppure premi INVIO per continuare...');
            console.log('   (Usa --force per saltare la conferma)');
            
            // Wait for user confirmation
            await new Promise(resolve => {
                process.stdin.once('data', () => resolve());
            });
        } else {
            console.log('\n⚠️  Modalità --force: eliminazione senza conferma...');
        }
        
        console.log('\n🚀 Inizio eliminazione...\n');
        
        await db.exec('PRAGMA foreign_keys = OFF');
        await db.exec('BEGIN TRANSACTION');
        
        let totalDeleted = 0;
        
        for (const tenant of tenantsToDelete) {
            const tenantId = tenant.id;
            console.log(`\n🗑️  Eliminazione tenant ID ${tenantId} (${tenant.slug})...`);
            
            let deleted = 0;
            
            // 1. Delete form_links (depends on campaigns and coupons)
            deleted = await safeDelete(db, 'form_links', 'tenant_id = ?', [tenantId]);
            if (deleted > 0) console.log(`  ✓ Eliminati ${deleted} form_links`);
            
            // 2. Delete campaign_products (depends on campaigns)
            const campaigns = await db.all('SELECT id FROM campaigns WHERE tenant_id = ?', tenantId);
            if (campaigns.length > 0) {
                const campaignIds = campaigns.map(c => c.id);
                const placeholders = campaignIds.map(() => '?').join(',');
                deleted = await safeDelete(
                    db,
                    'campaign_products',
                    `campaign_id IN (${placeholders})`,
                    campaignIds
                );
                if (deleted > 0) console.log(`  ✓ Eliminati ${deleted} campaign_products`);
            }
            
            // 3. Delete user_custom_data (depends on users)
            deleted = await safeDelete(
                db,
                'user_custom_data',
                'tenant_id = ?',
                [tenantId],
                'DELETE FROM user_custom_data WHERE user_id IN (SELECT id FROM users WHERE tenant_id = ?)'
            );
            if (deleted > 0) console.log(`  ✓ Eliminati ${deleted} user_custom_data`);
            
            // 4. Delete coupons
            deleted = await safeDelete(db, 'coupons', 'tenant_id = ?', [tenantId]);
            if (deleted > 0) console.log(`  ✓ Eliminati ${deleted} coupons`);
            
            // 5. Delete campaigns
            deleted = await safeDelete(db, 'campaigns', 'tenant_id = ?', [tenantId]);
            if (deleted > 0) console.log(`  ✓ Eliminati ${deleted} campaigns`);
            
            // 6. Delete users (final users, not auth_users)
            deleted = await safeDelete(db, 'users', 'tenant_id = ?', [tenantId]);
            if (deleted > 0) console.log(`  ✓ Eliminati ${deleted} users`);
            
            // 7. Preserve admin users by migrating them to default tenant
            // First, get admin users for this tenant
            const adminUsersForTenant = await db.all(
                "SELECT id, username, user_type FROM auth_users WHERE tenant_id = ? AND user_type IN ('admin', 'superadmin')",
                tenantId
            );
            if (adminUsersForTenant.length > 0) {
                // Migrate admin users to default tenant (or set tenant_id to NULL for superadmin)
                const defaultTenantId = defaultTenant ? defaultTenant.id : null;
                for (const adminUser of adminUsersForTenant) {
                    if (adminUser.user_type === 'superadmin') {
                        // Superadmin can have NULL tenant_id
                        await db.run('UPDATE auth_users SET tenant_id = NULL WHERE id = ?', adminUser.id);
                        console.log(`  ✓ Preservato superadmin: ${adminUser.username} (tenant_id impostato a NULL)`);
                    } else if (defaultTenantId) {
                        // Admin users migrate to default tenant
                        await db.run('UPDATE auth_users SET tenant_id = ? WHERE id = ?', defaultTenantId, adminUser.id);
                        console.log(`  ✓ Preservato admin: ${adminUser.username} (migrato al tenant di default)`);
                    } else {
                        console.log(`  ⚠️  Admin ${adminUser.username} non può essere migrato (nessun tenant di default)`);
                    }
                }
            }
            
            // 8. Delete non-admin auth_users for this tenant
            const nonAdminUsers = await db.all(
                "SELECT id FROM auth_users WHERE tenant_id = ? AND user_type NOT IN ('admin', 'superadmin')",
                tenantId
            );
            if (nonAdminUsers.length > 0) {
                const userIds = nonAdminUsers.map(u => u.id);
                const placeholders = userIds.map(() => '?').join(',');
                deleted = await safeDelete(
                    db,
                    'auth_users',
                    `id IN (${placeholders})`,
                    userIds
                );
                if (deleted > 0) console.log(`  ✓ Eliminati ${deleted} auth_users (non-admin)`);
            }
            
            // 9. Delete products
            deleted = await safeDelete(db, 'products', 'tenant_id = ?', [tenantId]);
            if (deleted > 0) console.log(`  ✓ Eliminati ${deleted} products`);
            
            // 10. Delete email_template
            deleted = await safeDelete(db, 'email_template', 'tenant_id = ?', [tenantId]);
            if (deleted > 0) console.log(`  ✓ Eliminati ${deleted} email_template`);
            
            // 11. Delete tenant_brand_settings
            deleted = await safeDelete(db, 'tenant_brand_settings', 'tenant_id = ?', [tenantId]);
            if (deleted > 0) console.log(`  ✓ Eliminati ${deleted} tenant_brand_settings`);
            
            // 12. Delete form_customization
            deleted = await safeDelete(db, 'form_customization', 'tenant_id = ?', [tenantId]);
            if (deleted > 0) console.log(`  ✓ Eliminati ${deleted} form_customization`);
            
            // 13. Delete system_logs (optional, but good to clean up)
            deleted = await safeDelete(db, 'system_logs', 'tenant_id = ?', [tenantId]);
            if (deleted > 0) console.log(`  ✓ Eliminati ${deleted} system_logs`);
            
            // 14. Finally, delete the tenant itself
            deleted = await safeDelete(db, 'tenants', 'id = ?', [tenantId]);
            if (deleted > 0) {
                console.log(`  ✓ Eliminato tenant ID ${tenantId}`);
                totalDeleted++;
            }
        }
        
        await db.exec('COMMIT');
        await db.exec('PRAGMA foreign_keys = ON');
        
        // Vacuum to reclaim space
        console.log('\n🧹 Esecuzione VACUUM per recuperare spazio...');
        await db.exec('VACUUM');
        
        console.log(`\n✅ Completato! Eliminati ${totalDeleted} tenant di test.`);
        console.log('✅ Tenant preservati:');
        if (defaultTenant) {
            console.log(`   - Tenant di default (ID ${defaultTenant.id}, slug: ${DEFAULT_TENANT_SLUG})`);
        }
        if (marioTenant) {
            console.log(`   - Tenant 6 - Mario (ID ${marioTenant.id})`);
        }
        console.log(`✅ Utenti admin preservati: ${adminUsers.length}`);
        
    } catch (error) {
        console.error('\n❌ Errore durante l\'eliminazione:', error);
        try {
            await db.exec('ROLLBACK');
        } catch (rollbackError) {
            console.error('Errore durante rollback:', rollbackError);
        }
        process.exit(1);
    } finally {
        await db.close();
    }
}

// Run the script
main().catch(error => {
    console.error('Errore fatale:', error);
    process.exit(1);
});

