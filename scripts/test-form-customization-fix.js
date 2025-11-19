#!/usr/bin/env node
/**
 * Test script per verificare il fix degli endpoint form-customization
 * Testa sia le route legacy che quelle tenant-scoped
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');
const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';
const ADMIN_USERNAME = process.env.TEST_ADMIN_USER || 'mario123';
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD || 'admin123';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'coupons.db');

let adminSession = '';
let adminCsrfToken = '';
let tenant1Id = null;
let tenant1Slug = 'test-tenant-1';

function log(message) {
    console.log(`[TEST] ${message}`);
}

function makeRequest(method, path, options = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, BASE_URL);
        const client = url.protocol === 'https:' ? https : http;
        
        const reqOptions = {
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: url.pathname + url.search,
            method: method,
            headers: {
                'Cookie': options.cookie || adminSession,
                'X-CSRF-Token': options.csrfToken || adminCsrfToken,
                'Content-Type': 'application/json',
                ...options.headers
            }
        };
        
        const req = client.request(reqOptions, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                const cookies = res.headers['set-cookie'] || [];
                cookies.forEach(cookie => {
                    const match = cookie.match(/^([^=]+)=([^;]+)/);
                    if (match) {
                        if (adminSession && !adminSession.includes(match[1])) {
                            adminSession += `; ${match[1]}=${match[2]}`;
                        } else if (!adminSession) {
                            adminSession = `${match[1]}=${match[2]}`;
                        }
                    }
                });
                
                try {
                    const json = data ? JSON.parse(data) : null;
                    resolve({ status: res.statusCode, headers: res.headers, body: json || data, rawBody: data });
                } catch (e) {
                    resolve({ status: res.statusCode, headers: res.headers, body: data, rawBody: data });
                }
            });
        });
        
        req.on('error', reject);
        
        if (options.body) {
            req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
        }
        req.end();
    });
}

async function getCsrfToken(sessionCookie) {
    const res = await makeRequest('GET', '/api/csrf-token', {
        headers: { 'Cookie': sessionCookie }
    });
    
    if (res.status !== 200) {
        throw new Error(`Failed to get CSRF token: ${res.status}`);
    }
    
    if (!res.body || !res.body.csrfToken) {
        throw new Error('CSRF token not found in response');
    }
    
    return res.body.csrfToken;
}

async function login(username, password, userType = 'admin') {
    const res = await makeRequest('POST', '/api/login', {
        headers: { 'Content-Type': 'application/json' },
        body: { username, password, userType }
    });
    
    if (res.status !== 200) {
        throw new Error(`Login failed: ${res.status} - ${JSON.stringify(res.body)}`);
    }
    
    if (!res.body.success) {
        throw new Error(`Login failed: ${JSON.stringify(res.body)}`);
    }
    
    const cookies = res.headers['set-cookie'] || [];
    const sessionCookie = cookies.map(c => c.split(';')[0]).join('; ');
    
    return sessionCookie;
}

async function setupTestTenant() {
    const db = await open({
        filename: DB_PATH,
        driver: sqlite3.Database
    });
    
    // Crea tenant di test se non esiste
    let tenant = await db.get('SELECT * FROM tenants WHERE slug = ?', tenant1Slug);
    if (!tenant) {
        const result = await db.run(
            'INSERT INTO tenants (slug, name, email_from_name, email_from_address) VALUES (?, ?, ?, ?)',
            tenant1Slug, 'Test Tenant 1', 'Test Tenant', 'test@example.com'
        );
        tenant1Id = result.lastID;
        log(`Created test tenant: ${tenant1Slug} (ID: ${tenant1Id})`);
    } else {
        tenant1Id = tenant.id;
        log(`Using existing tenant: ${tenant1Slug} (ID: ${tenant1Id})`);
    }
    
    // Crea utente admin per il tenant se non esiste
    const username = `${ADMIN_USERNAME}_t1`;
    let user = await db.get('SELECT * FROM auth_users WHERE username = ?', username);
    if (!user) {
        const bcrypt = require('bcrypt');
        const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD, 10);
        await db.run(
            'INSERT INTO auth_users (username, password_hash, user_type, tenant_id, is_active) VALUES (?, ?, ?, ?, ?)',
            username, hashedPassword, 'admin', tenant1Id, 1
        );
        log(`Created test admin user: ${username}`);
    }
    
    await db.close();
}

async function test(name, fn) {
    try {
        await fn();
        log(`✅ PASS: ${name}`);
        return true;
    } catch (error) {
        log(`❌ FAIL: ${name} - ${error.message}`);
        if (error.stack) {
            log(`   Stack: ${error.stack.split('\n')[1]}`);
        }
        return false;
    }
}

async function waitForServer(maxAttempts = 10) {
    for (let i = 0; i < maxAttempts; i++) {
        try {
            const res = await makeRequest('GET', '/health');
            if (res.status === 200) {
                return true;
            }
        } catch (e) {
            // Server non ancora pronto
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error('Server non raggiungibile dopo ' + maxAttempts + ' tentativi');
}

async function runTests() {
    log('=== Test Fix Form Customization Endpoints ===\n');
    log(`Testing against: ${BASE_URL}\n`);
    
    try {
        // Attendi che il server sia pronto
        log('Attendo che il server sia pronto...');
        await waitForServer();
        log('Server pronto!\n');
        
        // Setup test data
        await setupTestTenant();
        
        // Login
        log('Effettuo login...');
        adminSession = await login(`${ADMIN_USERNAME}_t1`, ADMIN_PASSWORD, 'admin');
        adminCsrfToken = await getCsrfToken(adminSession);
        log('Login completato!\n');
        
        // Test 1: GET legacy endpoint
        log('=== TEST 1: GET /api/admin/form-customization (legacy) ===');
        await test('GET legacy endpoint returns 200', async () => {
            const res = await makeRequest('GET', '/api/admin/form-customization');
            if (res.status !== 200) {
                throw new Error(`Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
            }
            log(`   Response: ${JSON.stringify(res.body)}`);
        });
        
        // Test 2: GET tenant-scoped endpoint
        log('\n=== TEST 2: GET /t/:tenantSlug/api/admin/form-customization (tenant-scoped) ===');
        await test('GET tenant-scoped endpoint returns 200', async () => {
            const res = await makeRequest('GET', `/t/${tenant1Slug}/api/admin/form-customization`);
            if (res.status !== 200) {
                throw new Error(`Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
            }
            log(`   Response: ${JSON.stringify(res.body)}`);
        });
        
        // Test 3: POST legacy endpoint
        log('\n=== TEST 3: POST /api/admin/form-customization (legacy) ===');
        const testConfig = {
            primaryColor: '#FF5733',
            accentColor: '#33FF57',
            headerImageUrl: '/test/image.jpg'
        };
        await test('POST legacy endpoint saves config', async () => {
            const res = await makeRequest('POST', '/api/admin/form-customization', {
                body: testConfig
            });
            if (res.status !== 200) {
                throw new Error(`Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
            }
            if (!res.body.success) {
                throw new Error(`Expected success: true, got ${JSON.stringify(res.body)}`);
            }
            log(`   Config salvata: ${JSON.stringify(res.body)}`);
        });
        
        // Verifica che il config sia stato salvato
        await test('GET legacy endpoint returns saved config', async () => {
            const res = await makeRequest('GET', '/api/admin/form-customization');
            if (res.status !== 200) {
                throw new Error(`Expected 200, got ${res.status}`);
            }
            if (res.body.primaryColor !== testConfig.primaryColor) {
                throw new Error(`Expected primaryColor ${testConfig.primaryColor}, got ${res.body.primaryColor}`);
            }
            log(`   Config verificata: primaryColor = ${res.body.primaryColor}`);
        });
        
        // Test 4: POST tenant-scoped endpoint
        log('\n=== TEST 4: POST /t/:tenantSlug/api/admin/form-customization (tenant-scoped) ===');
        const testConfig2 = {
            primaryColor: '#3366FF',
            accentColor: '#FF6633',
            headerImageUrl: '/test/image2.jpg'
        };
        await test('POST tenant-scoped endpoint saves config', async () => {
            const res = await makeRequest('POST', `/t/${tenant1Slug}/api/admin/form-customization`, {
                body: testConfig2
            });
            if (res.status !== 200) {
                throw new Error(`Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
            }
            if (!res.body.success) {
                throw new Error(`Expected success: true, got ${JSON.stringify(res.body)}`);
            }
            log(`   Config salvata: ${JSON.stringify(res.body)}`);
        });
        
        // Verifica che il config sia stato salvato via tenant-scoped endpoint
        await test('GET tenant-scoped endpoint returns saved config', async () => {
            const res = await makeRequest('GET', `/t/${tenant1Slug}/api/admin/form-customization`);
            if (res.status !== 200) {
                throw new Error(`Expected 200, got ${res.status}`);
            }
            if (res.body.primaryColor !== testConfig2.primaryColor) {
                throw new Error(`Expected primaryColor ${testConfig2.primaryColor}, got ${res.body.primaryColor}`);
            }
            log(`   Config verificata: primaryColor = ${res.body.primaryColor}`);
        });
        
        log('\n=== Tutti i test completati! ===');
        
    } catch (error) {
        log(`\n❌ Errore fatale: ${error.message}`);
        if (error.stack) {
            log(`Stack: ${error.stack}`);
        }
        process.exit(1);
    }
}

// Esegui i test
runTests().then(() => {
    process.exit(0);
}).catch(error => {
    log(`Errore: ${error.message}`);
    process.exit(1);
});

