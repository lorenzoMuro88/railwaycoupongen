#!/usr/bin/env node
/**
 * Script per creare/aggiornare gli utenti locali con le stesse password di Railway
 * 
 * Questo script:
 * 1. Elimina tutti gli utenti esistenti
 * 2. Crea gli utenti di default usando SUPERADMIN_PASSWORD e STORE_PASSWORD dal file .env
 * 
 * Uso:
 *   node scripts/create-local-users.js
 * 
 * Requisiti:
 *   - SUPERADMIN_PASSWORD e STORE_PASSWORD devono essere configurate nel file .env
 */

'use strict';

require('dotenv').config();
const { getDb } = require('../utils/db');
const { hashPassword } = require('../routes/auth');
const logger = require('../utils/logger');

const SUPERADMIN_USERNAME = process.env.SUPERADMIN_USERNAME || 'admin';
const STORE_USERNAME = 'store';
const SUPERADMIN_PASSWORD = process.env.SUPERADMIN_PASSWORD;
const STORE_PASSWORD = process.env.STORE_PASSWORD;

async function createLocalUsers() {
    try {
        if (!SUPERADMIN_PASSWORD || !STORE_PASSWORD) {
            console.error('❌ ERRORE: SUPERADMIN_PASSWORD e/o STORE_PASSWORD non configurate nel file .env!');
            console.error('\n📝 Configura le password nel file .env:');
            console.error('   SUPERADMIN_PASSWORD=tua_password_superadmin');
            console.error('   STORE_PASSWORD=tua_password_store');
            console.error('\n💡 Usa le stesse password che hai configurato su Railway per avere credenziali identiche.');
            process.exit(1);
        }
        
        const db = await getDb();
        
        // Ottieni il tenant di default
        const defaultTenant = await db.get('SELECT id FROM tenants WHERE slug = ?', 'default');
        if (!defaultTenant) {
            console.error('❌ ERRORE: Tenant di default non trovato!');
            process.exit(1);
        }
        const defaultTenantId = defaultTenant.id;
        
        console.log('🔄 Creazione/aggiornamento utenti locali...\n');
        
        // Elimina utenti esistenti se ci sono
        const existingSuperadmin = await db.get(
            'SELECT id FROM auth_users WHERE username = ? AND user_type = ?',
            SUPERADMIN_USERNAME,
            'superadmin'
        );
        
        const existingStore = await db.get(
            'SELECT id FROM auth_users WHERE username = ? AND user_type = ?',
            STORE_USERNAME,
            'store'
        );
        
        if (existingSuperadmin) {
            console.log(`🗑️  Eliminazione utente superadmin esistente...`);
            await db.run('DELETE FROM auth_users WHERE id = ?', existingSuperadmin.id);
        }
        
        if (existingStore) {
            console.log(`🗑️  Eliminazione utente store esistente...`);
            await db.run('DELETE FROM auth_users WHERE id = ?', existingStore.id);
        }
        
        // Genera hash delle password
        console.log('🔐 Generazione hash password...');
        const superadminHash = await hashPassword(SUPERADMIN_PASSWORD);
        const storeHash = await hashPassword(STORE_PASSWORD);
        
        // Crea nuovi utenti
        console.log('👤 Creazione utenti...');
        await db.run(`
            INSERT INTO auth_users (username, password_hash, user_type, tenant_id, is_active) 
            VALUES (?, ?, 'superadmin', ?, 1)
        `, SUPERADMIN_USERNAME, superadminHash, defaultTenantId);
        
        await db.run(`
            INSERT INTO auth_users (username, password_hash, user_type, tenant_id, is_active) 
            VALUES (?, ?, 'store', ?, 1)
        `, STORE_USERNAME, storeHash, defaultTenantId);
        
        console.log('\n✅ Utenti creati con successo!\n');
        console.log('📝 Credenziali:');
        console.log(`   SuperAdmin:`);
        console.log(`     Username: ${SUPERADMIN_USERNAME}`);
        console.log(`     Password: [da SUPERADMIN_PASSWORD nel file .env]`);
        console.log(`   Store:`);
        console.log(`     Username: ${STORE_USERNAME}`);
        console.log(`     Password: [da STORE_PASSWORD nel file .env]`);
        console.log('\n💡 Per avere le stesse credenziali di Railway, usa le stesse password nel file .env');
        
        logger.info({ 
            superadmin: SUPERADMIN_USERNAME,
            store: STORE_USERNAME,
            passwordsFromEnv: true
        }, 'Local users created');
        
    } catch (error) {
        logger.error({ err: error }, 'Error creating local users');
        console.error('❌ Errore durante la creazione degli utenti:', error.message);
        process.exit(1);
    }
}

async function main() {
    console.log('🔐 Creazione Utenti Locali\n');
    await createLocalUsers();
}

if (require.main === module) {
    main();
}

module.exports = { createLocalUsers };

