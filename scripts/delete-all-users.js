#!/usr/bin/env node
/**
 * Script per eliminare tutti gli utenti dal database
 * 
 * Questo script elimina tutti gli utenti dalla tabella auth_users.
 * Al prossimo avvio del server, gli utenti di default verranno ricreati
 * automaticamente usando SUPERADMIN_PASSWORD e STORE_PASSWORD dalle variabili d'ambiente.
 * 
 * ⚠️ ATTENZIONE: Questo script elimina TUTTI gli utenti, inclusi superadmin, admin e store.
 * 
 * Uso:
 *   node scripts/delete-all-users.js [--confirm]
 * 
 * Opzioni:
 *   --confirm: Conferma l'eliminazione senza prompt interattivo
 */

'use strict';

const { getDb } = require('../utils/db');
const logger = require('../utils/logger');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function question(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

async function deleteAllUsers(confirm = false) {
    try {
        const db = await getDb();
        
        // Conta gli utenti prima dell'eliminazione
        const countBefore = await db.get('SELECT COUNT(*) as count FROM auth_users');
        const userCount = countBefore.count;
        
        if (userCount === 0) {
            console.log('✅ Nessun utente trovato nel database. Niente da eliminare.');
            return;
        }
        
        // Mostra gli utenti che verranno eliminati
        const users = await db.all('SELECT id, username, user_type, is_active FROM auth_users ORDER BY user_type, username');
        
        console.log('\n📋 Utenti trovati nel database:');
        console.log('─'.repeat(60));
        users.forEach(user => {
            console.log(`  - ${user.username} (${user.user_type}) ${user.is_active ? '✅ Attivo' : '❌ Disattivato'}`);
        });
        console.log('─'.repeat(60));
        console.log(`\n⚠️  ATTENZIONE: Verranno eliminati ${userCount} utente/i dal database.`);
        console.log('   Al prossimo avvio del server, gli utenti di default verranno ricreati');
        console.log('   usando SUPERADMIN_PASSWORD e STORE_PASSWORD dalle variabili d\'ambiente.\n');
        
        // Richiedi conferma se non è stata fornita
        if (!confirm) {
            const answer = await question('Sei sicuro di voler procedere? (scrivi "SI" per confermare): ');
            if (answer.trim().toUpperCase() !== 'SI') {
                console.log('❌ Operazione annullata.');
                return;
            }
        }
        
        // Elimina tutti gli utenti
        console.log('\n🔄 Eliminazione utenti in corso...');
        const result = await db.run('DELETE FROM auth_users');
        
        console.log(`✅ Eliminati ${result.changes} utente/i dal database.`);
        console.log('\n📝 Prossimi passi:');
        console.log('   1. Assicurati che SUPERADMIN_PASSWORD e STORE_PASSWORD siano configurate');
        console.log('   2. Riavvia il server');
        console.log('   3. Gli utenti di default verranno creati automaticamente con le password dalle variabili d\'ambiente');
        console.log('\n   Credenziali di default:');
        console.log(`   - Username: admin (superadmin)`);
        console.log(`   - Password: [da SUPERADMIN_PASSWORD]`);
        console.log(`   - Username: store (store)`);
        console.log(`   - Password: [da STORE_PASSWORD]`);
        
        logger.info({ deletedCount: result.changes }, 'All users deleted from database');
        
    } catch (error) {
        logger.error({ err: error }, 'Error deleting all users');
        console.error('❌ Errore durante l\'eliminazione:', error.message);
        process.exit(1);
    } finally {
        rl.close();
    }
}

async function main() {
    const args = process.argv.slice(2);
    const confirm = args.includes('--confirm');
    
    // Verifica ambiente
    const isProduction = process.env.NODE_ENV === 'production';
    const isRailway = !!process.env.RAILWAY_ENVIRONMENT;
    
    if (isProduction || isRailway) {
        console.log('🌐 Ambiente: Railway/Produzione');
    } else {
        console.log('💻 Ambiente: Sviluppo locale');
    }
    
    console.log('\n🗑️  Eliminazione Tutti gli Utenti dal Database\n');
    
    await deleteAllUsers(confirm);
}

if (require.main === module) {
    main().catch(error => {
        console.error('❌ Errore fatale:', error);
        process.exit(1);
    });
}

module.exports = { deleteAllUsers };

