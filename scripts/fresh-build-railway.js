#!/usr/bin/env node
/**
 * Script per fare una build completa su Railway come se partissimo da zero
 * 
 * Questo script:
 * 1. Elimina tutti gli utenti dal database
 * 2. Opzionalmente elimina il volume del database (richiede conferma)
 * 3. Fa un nuovo deploy completo
 * 4. Verifica che tutto funzioni
 * 
 * Uso:
 *   node scripts/fresh-build-railway.js [--delete-volume] [--skip-deploy]
 * 
 * Opzioni:
 *   --delete-volume: Elimina anche il volume del database (ATTENZIONE: perde tutti i dati!)
 *   --skip-deploy: Salta il deploy (utile se vuoi solo pulire il database)
 */

'use strict';

const { execSync } = require('child_process');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function question(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

function runCommand(command, description) {
    console.log(`\n🔄 ${description}...`);
    try {
        const output = execSync(command, { 
            encoding: 'utf-8',
            stdio: 'pipe'
        });
        if (output) console.log(output);
        return true;
    } catch (error) {
        console.error(`❌ Errore: ${error.message}`);
        if (error.stdout) console.error(error.stdout);
        if (error.stderr) console.error(error.stderr);
        return false;
    }
}

async function deleteAllUsers() {
    console.log('\n📋 Step 1: Eliminazione utenti dal database');
    return runCommand(
        'railway run node scripts/delete-all-users.js --confirm',
        'Eliminazione tutti gli utenti'
    );
}

async function deleteVolume(confirm = false) {
    console.log('\n📋 Step 2: Eliminazione volume database');
    
    // Lista volumi
    console.log('\n📋 Volumi disponibili:');
    let volumeInfo = '';
    try {
        volumeInfo = execSync('railway volume list', { encoding: 'utf-8' });
        console.log(volumeInfo);
        
        // Estrai il nome del volume dalla lista
        const volumeMatch = volumeInfo.match(/Volume:\s+(\S+)/);
        if (!volumeMatch) {
            console.log('⚠️  Impossibile identificare il volume. Usa il dashboard Railway per eliminarlo manualmente.');
            return false;
        }
        
        const volumeName = volumeMatch[1];
        console.log(`\n📦 Volume identificato: ${volumeName}`);
        
        if (!confirm) {
            const answer = await question('\n⚠️  ATTENZIONE: Eliminare il volume eliminerà TUTTI i dati (database, uploads, ecc.)!\n   Sei sicuro? (scrivi "SI" per confermare): ');
            if (answer.trim().toUpperCase() !== 'SI') {
                console.log('❌ Operazione annullata. Il volume non verrà eliminato.');
                return false;
            }
        }
        
        console.log(`\n🗑️  Eliminazione volume ${volumeName}...`);
        console.log('💡 NOTA: L\'eliminazione del volume deve essere fatta manualmente dal dashboard Railway:');
        console.log('   1. Vai su Railway Dashboard → Il tuo progetto → Settings → Volumes');
        console.log('   2. Seleziona il volume da eliminare');
        console.log('   3. Clicca "Delete Volume"');
        console.log('\n   Dopo l\'eliminazione, il volume verrà ricreato automaticamente al prossimo deploy.');
        
        return true;
    } catch (error) {
        console.log('⚠️  Impossibile elencare i volumi:', error.message);
        console.log('\n💡 Per eliminare un volume, usa il dashboard Railway:');
        console.log('   1. Vai su Railway Dashboard → Il tuo progetto → Settings → Volumes');
        console.log('   2. Seleziona il volume da eliminare');
        console.log('   3. Clicca "Delete Volume"');
        return false;
    }
}

async function deploy() {
    console.log('\n📋 Step 3: Deploy completo su Railway');
    return runCommand(
        'railway up',
        'Deploy su Railway'
    );
}

async function verifyDeployment() {
    console.log('\n📋 Step 4: Verifica deployment');
    
    console.log('\n⏳ Attendere 30 secondi per il completamento del deploy...');
    await new Promise(resolve => setTimeout(resolve, 30000));
    
    // Verifica che gli utenti siano stati ricreati
    console.log('\n🔍 Verifica utenti ricreati...');
    const success = runCommand(
        'railway run npm run reset:superadmin-check',
        'Verifica utenti superadmin'
    );
    
    return success;
}

async function main() {
    const args = process.argv.slice(2);
    const deleteVolumeFlag = args.includes('--delete-volume');
    const skipDeploy = args.includes('--skip-deploy');
    
    console.log('🚀 Build Completa Railway - Partenza da Zero\n');
    console.log('Questo script eseguirà:');
    console.log('  1. Eliminazione tutti gli utenti dal database');
    if (deleteVolumeFlag) {
        console.log('  2. Eliminazione volume database (TUTTI i dati verranno persi!)');
    } else {
        console.log('  2. Volume database: mantenuto (solo utenti eliminati)');
    }
    if (!skipDeploy) {
        console.log('  3. Deploy completo su Railway');
        console.log('  4. Verifica che tutto funzioni');
    } else {
        console.log('  3. Deploy: saltato (usa --skip-deploy per saltare)');
    }
    
    // Step 1: Elimina utenti
    const usersDeleted = await deleteAllUsers();
    if (!usersDeleted) {
        console.error('\n❌ Errore durante l\'eliminazione degli utenti. Interruzione.');
        rl.close();
        process.exit(1);
    }
    
    // Step 2: Elimina volume (opzionale)
    if (deleteVolumeFlag) {
        await deleteVolume(false);
    }
    
    // Step 3: Deploy
    if (!skipDeploy) {
        const deploySuccess = await deploy();
        if (!deploySuccess) {
            console.error('\n❌ Errore durante il deploy. Verifica i log.');
            rl.close();
            process.exit(1);
        }
        
        // Step 4: Verifica
        await verifyDeployment();
    }
    
    console.log('\n✅ Build completa terminata!');
    console.log('\n📝 Prossimi passi:');
    console.log('  1. Verifica che SUPERADMIN_PASSWORD e STORE_PASSWORD siano configurate su Railway');
    console.log('  2. Testa il login superadmin: https://flycoupongen-app-production.up.railway.app/superadmin-login');
    console.log('  3. Verifica i log: railway logs');
    
    rl.close();
}

if (require.main === module) {
    main().catch(error => {
        console.error('❌ Errore fatale:', error);
        rl.close();
        process.exit(1);
    });
}

module.exports = { deleteAllUsers, deploy, verifyDeployment };

