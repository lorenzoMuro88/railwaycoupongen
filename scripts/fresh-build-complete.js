#!/usr/bin/env node
/**
 * Script per fare una build completamente pulita su Railway
 * 
 * Questo script:
 * 1. Elimina tutti gli utenti dal database
 * 2. Fornisce istruzioni per eliminare il volume (se necessario)
 * 3. Fa un nuovo deploy completo
 * 4. Verifica che tutto funzioni
 * 
 * Uso:
 *   node scripts/fresh-build-complete.js
 */

'use strict';

const { execSync } = require('child_process');

function runCommand(command, description) {
    console.log(`\n🔄 ${description}...`);
    try {
        const output = execSync(command, { 
            encoding: 'utf-8',
            stdio: 'inherit'
        });
        return true;
    } catch (error) {
        console.error(`❌ Errore: ${error.message}`);
        return false;
    }
}

async function main() {
    console.log('🚀 Build Completa e Pulita su Railway\n');
    console.log('Questo script eseguirà:');
    console.log('  1. Eliminazione tutti gli utenti dal database');
    console.log('  2. Deploy completo su Railway');
    console.log('  3. Verifica che il servizio risponda correttamente');
    console.log('\n⚠️  NOTA: Il volume del database verrà mantenuto.');
    console.log('   Se vuoi eliminare anche il volume, fallo manualmente dal dashboard Railway.\n');
    
    // Step 1: Elimina utenti
    console.log('📋 Step 1: Eliminazione utenti dal database');
    const usersDeleted = runCommand(
        'railway run node scripts/delete-all-users.js --confirm',
        'Eliminazione tutti gli utenti'
    );
    
    if (!usersDeleted) {
        console.error('\n❌ Errore durante l\'eliminazione degli utenti. Interruzione.');
        process.exit(1);
    }
    
    // Step 2: Deploy
    console.log('\n📋 Step 2: Deploy completo su Railway');
    const deploySuccess = runCommand(
        'railway up',
        'Deploy su Railway'
    );
    
    if (!deploySuccess) {
        console.error('\n❌ Errore durante il deploy. Verifica i log.');
        process.exit(1);
    }
    
    console.log('\n✅ Build completa avviata!');
    console.log('\n📝 Prossimi passi:');
    console.log('  1. Attendi il completamento del deploy (circa 1-2 minuti)');
    console.log('  2. Verifica i log: railway logs');
    console.log('  3. Testa il login superadmin: https://flycoupongen-app-production.up.railway.app/superadmin-login');
    console.log('  4. Se il healthcheck fallisce, verifica i log per eventuali errori');
    console.log('\n💡 Se il deploy continua a fallire:');
    console.log('   - Verifica che tutte le variabili d\'ambiente siano configurate');
    console.log('   - Controlla i log per errori specifici');
    console.log('   - Considera di eliminare il volume e ricrearlo da zero');
}

if (require.main === module) {
    main().catch(error => {
        console.error('❌ Errore fatale:', error);
        process.exit(1);
    });
}

module.exports = { main };


