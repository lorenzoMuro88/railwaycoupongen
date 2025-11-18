#!/usr/bin/env node
/**
 * Script per verificare e resettare le credenziali del superadmin
 * 
 * Questo script permette di:
 * 1. Verificare lo stato dell'utente superadmin nel database
 * 2. Resettare la password del superadmin usando SUPERADMIN_PASSWORD dalla variabile d'ambiente
 * 3. Attivare l'utente superadmin se è disattivato
 * 
 * Uso:
 *   node scripts/reset-superadmin.js [--reset] [--username admin]
 * 
 * Opzioni:
 *   --reset: Resetta la password del superadmin usando SUPERADMIN_PASSWORD
 *   --username: Username del superadmin da verificare/resettare (default: admin)
 */

'use strict';

const { getDb } = require('../utils/db');
const { hashPassword } = require('../routes/auth');
const logger = require('../utils/logger');

const SUPERADMIN_USERNAME = process.env.SUPERADMIN_USERNAME || 'admin';
const SUPERADMIN_PASSWORD = process.env.SUPERADMIN_PASSWORD;

async function checkSuperAdmin() {
    try {
        const db = await getDb();
        
        // Verifica se l'utente superadmin esiste
        const user = await db.get(
            'SELECT id, username, user_type, is_active, created_at, last_login FROM auth_users WHERE username = ? AND user_type = ?',
            SUPERADMIN_USERNAME,
            'superadmin'
        );
        
        if (!user) {
            console.log(`❌ Utente superadmin '${SUPERADMIN_USERNAME}' non trovato nel database.`);
            console.log('   Gli utenti di default vengono creati automaticamente al primo avvio.');
            return false;
        }
        
        console.log(`✅ Utente superadmin trovato:`);
        console.log(`   ID: ${user.id}`);
        console.log(`   Username: ${user.username}`);
        console.log(`   Tipo: ${user.user_type}`);
        console.log(`   Attivo: ${user.is_active ? '✅ Sì' : '❌ No'}`);
        console.log(`   Creato: ${user.created_at || 'N/A'}`);
        console.log(`   Ultimo login: ${user.last_login || 'Mai'}`);
        
        if (!user.is_active) {
            console.log(`\n⚠️  ATTENZIONE: L'utente superadmin è DISATTIVATO!`);
            console.log(`   Questo potrebbe essere il motivo per cui il login non funziona.`);
        }
        
        return user;
    } catch (error) {
        logger.error({ err: error }, 'Errore durante la verifica del superadmin');
        console.error('❌ Errore:', error.message);
        return null;
    }
}

async function resetSuperAdmin() {
    if (!SUPERADMIN_PASSWORD) {
        console.error('❌ ERRORE: SUPERADMIN_PASSWORD non è configurata nelle variabili d\'ambiente!');
        console.error('   Configura SUPERADMIN_PASSWORD prima di resettare la password.');
        process.exit(1);
    }
    
    try {
        const db = await getDb();
        
        // Verifica se l'utente esiste
        const user = await db.get(
            'SELECT id, username FROM auth_users WHERE username = ? AND user_type = ?',
            SUPERADMIN_USERNAME,
            'superadmin'
        );
        
        if (!user) {
            console.error(`❌ Utente superadmin '${SUPERADMIN_USERNAME}' non trovato.`);
            console.error('   Non è possibile resettare la password di un utente inesistente.');
            process.exit(1);
        }
        
        // Genera nuovo hash della password
        console.log('🔄 Generazione nuovo hash password...');
        const newHash = await hashPassword(SUPERADMIN_PASSWORD);
        
        // Aggiorna password e attiva utente
        console.log('🔄 Aggiornamento credenziali nel database...');
        await db.run(
            'UPDATE auth_users SET password_hash = ?, is_active = 1 WHERE id = ?',
            newHash,
            user.id
        );
        
        console.log(`✅ Password del superadmin '${SUPERADMIN_USERNAME}' resettata con successo!`);
        console.log(`✅ Utente attivato.`);
        console.log(`\n📝 Credenziali:`);
        console.log(`   Username: ${SUPERADMIN_USERNAME}`);
        console.log(`   Password: [dalla variabile d'ambiente SUPERADMIN_PASSWORD]`);
        console.log(`\n⚠️  Assicurati che SUPERADMIN_PASSWORD sia configurata correttamente su Railway!`);
        
    } catch (error) {
        logger.error({ err: error }, 'Errore durante il reset del superadmin');
        console.error('❌ Errore durante il reset:', error.message);
        process.exit(1);
    }
}

async function main() {
    const args = process.argv.slice(2);
    const shouldReset = args.includes('--reset');
    const customUsername = args.find(arg => arg.startsWith('--username='));
    const username = customUsername ? customUsername.split('=')[1] : SUPERADMIN_USERNAME;
    
    if (customUsername && username !== SUPERADMIN_USERNAME) {
        process.env.SUPERADMIN_USERNAME = username;
    }
    
    console.log('🔍 Verifica credenziali SuperAdmin\n');
    console.log(`Username: ${username}`);
    console.log(`SUPERADMIN_PASSWORD configurata: ${SUPERADMIN_PASSWORD ? '✅ Sì' : '❌ No'}\n`);
    
    const user = await checkSuperAdmin();
    
    if (shouldReset) {
        console.log('\n' + '='.repeat(60) + '\n');
        await resetSuperAdmin();
    } else if (user && !user.is_active) {
        console.log('\n💡 Suggerimento: Esegui con --reset per resettare la password e attivare l\'utente.');
        console.log('   Esempio: node scripts/reset-superadmin.js --reset\n');
    } else if (user && user.is_active) {
        console.log('\n✅ L\'utente superadmin è attivo e dovrebbe funzionare.');
        if (!SUPERADMIN_PASSWORD) {
            console.log('⚠️  ATTENZIONE: SUPERADMIN_PASSWORD non è configurata!');
            console.log('   Se il login non funziona, potrebbe essere perché la password nel database');
            console.log('   non corrisponde a quella che stai usando.');
            console.log('   Esegui: node scripts/reset-superadmin.js --reset\n');
        }
    }
}

if (require.main === module) {
    main().catch(error => {
        console.error('❌ Errore fatale:', error);
        process.exit(1);
    });
}

module.exports = { checkSuperAdmin, resetSuperAdmin };

