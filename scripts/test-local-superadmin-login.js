#!/usr/bin/env node
/**
 * Test rapido per verificare l'accesso superadmin locale
 */

'use strict';

const http = require('http');

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';
const SUPERADMIN_USERNAME = process.env.SUPERADMIN_USERNAME || 'admin';
const SUPERADMIN_PASSWORD = process.env.SUPERADMIN_PASSWORD || 'q2%iizUtAZQF5H%L';

function makeRequest(method, path, options = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, BASE_URL);
        
        const requestOptions = {
            hostname: url.hostname,
            port: url.port || 3000,
            path: url.pathname + url.search,
            method: method,
            headers: {
                'Content-Type': 'application/json',
                ...(options.cookie ? { 'Cookie': options.cookie } : {}),
                ...options.headers
            }
        };
        
        const req = http.request(requestOptions, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                let body;
                try {
                    body = JSON.parse(data);
                } catch {
                    body = data;
                }
                resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    body: body,
                    rawBody: data
                });
            });
        });
        
        req.on('error', reject);
        
        if (options.body) {
            req.write(JSON.stringify(options.body));
        }
        
        req.end();
    });
}

async function testSuperAdminLogin() {
    console.log('🔐 Test Accesso SuperAdmin Locale\n');
    console.log(`URL: ${BASE_URL}`);
    console.log(`Username: ${SUPERADMIN_USERNAME}`);
    console.log(`Password: ${SUPERADMIN_PASSWORD}\n`);
    
    try {
        // Prima verifica che il server sia in esecuzione
        console.log('🔄 Verifica server in esecuzione...');
        try {
            const healthCheck = await makeRequest('GET', '/');
            console.log(`   Server risponde (status: ${healthCheck.status})\n`);
        } catch (error) {
            console.error('❌ ERRORE: Il server non è in esecuzione!');
            console.error(`   Avvia il server con: npm start`);
            console.error(`   Oppure: npm run dev`);
            process.exit(1);
        }
        
        console.log('🔄 Tentativo di login...');
        const response = await makeRequest('POST', '/api/superadmin/login', {
            body: {
                username: SUPERADMIN_USERNAME,
                password: SUPERADMIN_PASSWORD
            }
        });
        
        console.log(`\n📊 Risultato:`);
        console.log(`   Status: ${response.status}`);
        
        if (response.status === 200) {
            console.log('✅ Login riuscito!');
            console.log(`   Response:`, JSON.stringify(response.body, null, 2));
            
            // Verifica se c'è un cookie di sessione
            const setCookie = response.headers['set-cookie'];
            if (setCookie) {
                console.log(`\n🍪 Cookie di sessione ricevuto:`);
                setCookie.forEach(cookie => {
                    console.log(`   ${cookie.split(';')[0]}`);
                });
            }
            
            return true;
        } else if (response.status === 401) {
            console.log('❌ Login fallito: Credenziali non valide');
            console.log(`   Response:`, JSON.stringify(response.body, null, 2));
            console.log('\n💡 Possibili cause:');
            console.log('   - Password nel database non corrisponde');
            console.log('   - Username errato');
            console.log('   - Utente disattivato');
            console.log('\n   Prova a resettare la password:');
            console.log('   npm run reset:superadmin');
            return false;
        } else {
            console.log(`⚠️  Status inaspettato: ${response.status}`);
            console.log(`   Response:`, JSON.stringify(response.body, null, 2));
            return false;
        }
    } catch (error) {
        console.error('❌ Errore durante il test:', error.message);
        if (error.code === 'ECONNREFUSED') {
            console.error('\n💡 Il server non è in esecuzione!');
            console.error('   Avvia il server con: npm start');
        }
        return false;
    }
}

async function main() {
    const success = await testSuperAdminLogin();
    process.exit(success ? 0 : 1);
}

if (require.main === module) {
    main();
}

module.exports = { testSuperAdminLogin };

