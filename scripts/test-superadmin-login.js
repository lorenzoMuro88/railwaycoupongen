#!/usr/bin/env node
/**
 * Test rapido per verificare l'accesso superadmin
 */

'use strict';

const https = require('https');
const http = require('http');

const BASE_URL = process.env.TEST_URL || 'https://flycoupongen-app-production.up.railway.app';
const SUPERADMIN_USERNAME = process.env.SUPERADMIN_USERNAME || 'admin';
const SUPERADMIN_PASSWORD = process.env.SUPERADMIN_PASSWORD;

if (!SUPERADMIN_PASSWORD) {
    console.error('❌ ERRORE: SUPERADMIN_PASSWORD non configurata!');
    process.exit(1);
}

function makeRequest(method, path, options = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, BASE_URL);
        const isHttps = url.protocol === 'https:';
        const client = isHttps ? https : http;
        
        const requestOptions = {
            hostname: url.hostname,
            port: url.port || (isHttps ? 443 : 80),
            path: url.pathname + url.search,
            method: method,
            headers: {
                'Content-Type': 'application/json',
                ...(options.cookie ? { 'Cookie': options.cookie } : {}),
                ...options.headers
            }
        };
        
        const req = client.request(requestOptions, (res) => {
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
    console.log('🔐 Test Accesso SuperAdmin\n');
    console.log(`URL: ${BASE_URL}`);
    console.log(`Username: ${SUPERADMIN_USERNAME}`);
    console.log(`Password: [configurata da SUPERADMIN_PASSWORD]\n`);
    
    try {
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
            return false;
        } else {
            console.log(`⚠️  Status inaspettato: ${response.status}`);
            console.log(`   Response:`, JSON.stringify(response.body, null, 2));
            return false;
        }
    } catch (error) {
        console.error('❌ Errore durante il test:', error.message);
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

