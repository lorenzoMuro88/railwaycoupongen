#!/usr/bin/env node
/**
 * Script per impostare le password degli utenti locali
 * 
 * Questo script permette di impostare le password per superadmin e store
 * nel database locale usando le variabili d'ambiente o parametri da linea di comando.
 * 
 * Uso:
 *   node scripts/set-local-passwords.js
 *   node scripts/set-local-passwords.js --superadmin-password=PASSWORD --store-password=PASSWORD
 */

'use strict';

const { getDb } = require('../utils/db');
const { hashPassword } = require('../routes/auth');
const logger = require('../utils/logger');

const SUPERADMIN_USERNAME = process.env.SUPERADMIN_USERNAME || 'admin';
const STORE_USERNAME = 'store';

function parseArgs() {
    const args = process.argv.slice(2);
    const result = {};
    
    args.forEach(arg => {
        if (arg.startsWith('--superadmin-password=')) {
            result.superadminPassword = arg.split('=')[1];
        } else if (arg.startsWith('--store-password=')) {
            result.storePassword = arg.split('=')[1];
        }
    });
    
    return result;
}

async function setPasswords() {
    try {
        const args = parseArgs();
        const superadminPassword = args.superadminPassword || process.env.SUPERADMIN_PASSWORD;
        const storePassword = args.storePassword || process.env.STORE_PASSWORD;
        
        if (!superadminPassword || !storePassword) {
            console.error('❌ ERRORE: Password non fornite!');
            console.error('\nOpzioni:');
            console.error('  1. Configura SUPERADMIN_PASSWORD e STORE_PASSWORD nel file .env');
            console.error('  2. Oppure passa le password come parametri:');
            console.error('     node scripts/set-local-passwords.js --superadmin-password=PASSWORD --store-password=PASSWORD');
            process.exit(1);
        }
        
        const db = await getDb();
        
        // Verifica che gli utenti esistano
        const superadmin = await db.get(
            'SELECT id, username FROM auth_users WHERE username = ? AND user_type = ?',
            SUPERADMIN_USERNAME,
            'superadmin'
        );
        
        const store = await db.get(
            'SELECT id, username FROM auth_users WHERE username = ? AND user_type = ?',
            STORE_USERNAME,
            'store'
        );
        
        if (!superadmin) {
            console.error(`❌ ERRORE: Utente superadmin '${SUPERADMIN_USERNAME}' non trovato!`);
            console.error('   Gli utenti vengono creati automaticamente al primo avvio del server.');
            process.exit(1);
        }
        
        if (!store) {
            console.error(`❌ ERRORE: Utente store '${STORE_USERNAME}' non trovato!`);
            console.error('   Gli utenti vengono creati automaticamente al primo avvio del server.');
            process.exit(1);
        }
        
        console.log('🔄 Impostazione password in corso...\n');
        
        // Genera hash delle password
        const superadminHash = await hashPassword(superadminPassword);
        const storeHash = await hashPassword(storePassword);
        
        // Aggiorna password e attiva utenti
        await db.run(
            'UPDATE auth_users SET password_hash = ?, is_active = 1 WHERE id = ?',
            superadminHash,
            superadmin.id
        );
        
        await db.run(
            'UPDATE auth_users SET password_hash = ?, is_active = 1 WHERE id = ?',
            storeHash,
            store.id
        );
        
        console.log('✅ Password impostate con successo!\n');
        console.log('📝 Credenziali:');
        console.log(`   SuperAdmin:`);
        console.log(`     Username: ${SUPERADMIN_USERNAME}`);
        console.log(`     Password: [configurata]`);
        console.log(`   Store:`);
        console.log(`     Username: ${STORE_USERNAME}`);
        console.log(`     Password: [configurata]`);
        
        logger.info({ 
            superadmin: SUPERADMIN_USERNAME,
            store: STORE_USERNAME 
        }, 'Local user passwords set');
        
    } catch (error) {
        logger.error({ err: error }, 'Error setting local passwords');
        console.error('❌ Errore durante l\'impostazione delle password:', error.message);
        process.exit(1);
    }
}

async function main() {
    console.log('🔐 Impostazione Password Utenti Locali\n');
    await setPasswords();
}

if (require.main === module) {
    main();
}

module.exports = { setPasswords };

