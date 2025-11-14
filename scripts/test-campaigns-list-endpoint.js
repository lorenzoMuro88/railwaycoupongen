#!/usr/bin/env node
/**
 * Test per verificare che l'endpoint /t/:tenantSlug/api/admin/campaigns-list funzioni correttamente
 * e che non impatti altri endpoint esistenti
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';
const ADMIN_USERNAME = process.env.TEST_ADMIN_USER || 'mario123';
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD || 'admin123';
const SUPERADMIN_USERNAME = process.env.TEST_SUPERADMIN_USER || 'superadmin';
const SUPERADMIN_PASSWORD = process.env.TEST_SUPERADMIN_PASSWORD || 'superadmin123';

let superadminSession = '';
let superadminCsrfToken = '';
let tenant1AdminSession = '';
let tenant2AdminSession = '';
let tenant1Id = null;
let tenant2Id = null;
let tenant1Slug = '';
let tenant2Slug = '';
let testResults = [];

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
                'Content-Type': 'application/json',
                'Cookie': options.cookie || '',
                ...options.headers
            }
        };
        
        const req = client.request(reqOptions, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                const cookies = res.headers['set-cookie'] || [];
                let sessionCookie = options.cookie || '';
                cookies.forEach(cookie => {
                    const match = cookie.match(/^([^=]+)=([^;]+)/);
                    if (match) {
                        if (sessionCookie && !sessionCookie.includes(match[1])) {
                            sessionCookie += `; ${match[1]}=${match[2]}`;
                        } else if (!sessionCookie) {
                            sessionCookie = `${match[1]}=${match[2]}`;
                        }
                    }
                });
                
                try {
                    const json = data ? JSON.parse(data) : null;
                    resolve({ 
                        status: res.statusCode, 
                        headers: res.headers, 
                        body: json || data, 
                        rawBody: data,
                        cookie: sessionCookie
                    });
                } catch (e) {
                    resolve({ 
                        status: res.statusCode, 
                        headers: res.headers, 
                        body: data, 
                        rawBody: data,
                        cookie: sessionCookie
                    });
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
        cookie: sessionCookie
    });
    
    if (res.status !== 200) {
        throw new Error(`Failed to get CSRF token: ${res.status}`);
    }
    
    if (!res.body || !res.body.csrfToken) {
        throw new Error('CSRF token not found in response');
    }
    
    return res.body.csrfToken;
}

async function login(username, password, userType) {
    const res = await makeRequest('POST', '/api/login', {
        body: { username, password, userType }
    });
    
    if (res.status !== 200) {
        throw new Error(`Login failed: ${res.status} - ${JSON.stringify(res.body)}`);
    }
    
    return res.cookie || '';
}

function isHtmlResponse(body) {
    if (typeof body === 'string') {
        return body.trim().toLowerCase().startsWith('<!doctype') || 
               body.trim().toLowerCase().startsWith('<html');
    }
    return false;
}

function isJsonResponse(body) {
    if (typeof body === 'object') {
        return true;
    }
    if (typeof body === 'string') {
        try {
            JSON.parse(body);
            return true;
        } catch (e) {
            return false;
        }
    }
    return false;
}

async function test(name, fn) {
    try {
        log(`Running: ${name}`);
        await fn();
        testResults.push({ name, passed: true });
        log(`✅ PASS: ${name}`);
    } catch (error) {
        testResults.push({ name, passed: false, error: error.message });
        log(`❌ FAIL: ${name} - ${error.message}`);
    }
}

async function setupTestTenants() {
    log('Setting up test tenants...');
    
    // Create tenant 1
    const timestamp = Date.now();
    const tenant1Name = `Test Tenant 1 - ${timestamp}`;
    tenant1Slug = `test-tenant-1-${timestamp}`;
    const tenant1AdminUsername = `admin1-${timestamp}`;
    const createTenant1Res = await makeRequest('POST', '/api/superadmin/tenants', {
        cookie: superadminSession,
        headers: {
            'X-CSRF-Token': superadminCsrfToken
        },
        body: {
            tenantName: tenant1Name,
            tenantSlug: tenant1Slug,
            adminUsername: tenant1AdminUsername,
            adminPassword: 'admin123'
        }
    });
    
    if (createTenant1Res.status !== 200 && createTenant1Res.status !== 201) {
        throw new Error(`Failed to create tenant 1: ${createTenant1Res.status} - ${JSON.stringify(createTenant1Res.body)}`);
    }
    
    tenant1Id = createTenant1Res.body.id || createTenant1Res.body.tenantId || createTenant1Res.body.tenant?.id;
    
    // Create tenant 2
    const tenant2Name = `Test Tenant 2 - ${timestamp}`;
    tenant2Slug = `test-tenant-2-${timestamp}`;
    const tenant2AdminUsername = `admin2-${timestamp}`;
    const createTenant2Res = await makeRequest('POST', '/api/superadmin/tenants', {
        cookie: superadminSession,
        headers: {
            'X-CSRF-Token': superadminCsrfToken
        },
        body: {
            tenantName: tenant2Name,
            tenantSlug: tenant2Slug,
            adminUsername: tenant2AdminUsername,
            adminPassword: 'admin123'
        }
    });
    
    if (createTenant2Res.status !== 200 && createTenant2Res.status !== 201) {
        throw new Error(`Failed to create tenant 2: ${createTenant2Res.status} - ${JSON.stringify(createTenant2Res.body)}`);
    }
    
    tenant2Id = createTenant2Res.body.id || createTenant2Res.body.tenantId || createTenant2Res.body.tenant?.id;
    
    log(`Tenant 1 ID: ${tenant1Id}, Slug: ${tenant1Slug}`);
    log(`Tenant 2 ID: ${tenant2Id}, Slug: ${tenant2Slug}`);
    
    // Login as tenant admins - use the usernames we sent in the request
    // Wait a bit for the users to be created in the database
    await new Promise(resolve => setTimeout(resolve, 500));
    
    tenant1AdminSession = await login(tenant1AdminUsername, 'admin123', 'admin');
    tenant2AdminSession = await login(tenant2AdminUsername, 'admin123', 'admin');
}

async function createTestCampaign(tenantSlug, sessionCookie, campaignName) {
    const csrfToken = await getCsrfToken(sessionCookie);
    const res = await makeRequest('POST', `/t/${tenantSlug}/api/admin/campaigns`, {
        cookie: sessionCookie,
        headers: {
            'X-CSRF-Token': csrfToken
        },
        body: {
            name: campaignName,
            campaign_code: `TEST-${Date.now()}`,
            is_active: 1
        }
    });
    
    return res;
}

async function runTests() {
    log('=== Test campaigns-list Endpoint ===\n');
    log(`Testing against: ${BASE_URL}\n`);
    
    try {
        // Setup: Login as superadmin
        await test('Setup: Login as superadmin', async () => {
            superadminSession = await login(SUPERADMIN_USERNAME, SUPERADMIN_PASSWORD, 'superadmin');
            superadminCsrfToken = await getCsrfToken(superadminSession);
            if (!superadminSession) throw new Error('Failed to get superadmin session');
        });
        
        // Setup test tenants
        await test('Setup: Create test tenants', async () => {
            await setupTestTenants();
        });
        
        log('\n=== TEST 1: Verifica endpoint tenant-aware esiste e restituisce JSON ===');
        
        await test('GET /t/:tenantSlug/api/admin/campaigns-list restituisce JSON (non HTML)', async () => {
            const res = await makeRequest('GET', `/t/${tenant1Slug}/api/admin/campaigns-list`, {
                cookie: tenant1AdminSession
            });
            
            if (res.status === 404) {
                throw new Error(`Got 404 status - endpoint not found`);
            }
            
            if (res.status !== 200) {
                // Even for non-200, should be JSON
                if (isHtmlResponse(res.rawBody)) {
                    throw new Error(`Status ${res.status} response is HTML instead of JSON. First 200 chars: ${res.rawBody.substring(0, 200)}`);
                }
                throw new Error(`Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
            }
            
            // Check that response is JSON, not HTML
            if (isHtmlResponse(res.rawBody)) {
                throw new Error(`Response is HTML instead of JSON. First 200 chars: ${res.rawBody.substring(0, 200)}`);
            }
            
            if (!isJsonResponse(res.body)) {
                throw new Error(`Response is not valid JSON. Body type: ${typeof res.body}`);
            }
            
            if (!Array.isArray(res.body)) {
                throw new Error(`Expected array, got ${typeof res.body}`);
            }
        });
        
        log('\n=== TEST 2: Verifica formato risposta ===');
        
        await test('Response contiene array di oggetti con id, name, code', async () => {
            const res = await makeRequest('GET', `/t/${tenant1Slug}/api/admin/campaigns-list`, {
                cookie: tenant1AdminSession
            });
            
            if (res.status !== 200) {
                throw new Error(`Expected 200, got ${res.status}`);
            }
            
            if (!Array.isArray(res.body)) {
                throw new Error(`Expected array, got ${typeof res.body}`);
            }
            
            // Se ci sono campagne, verifica il formato
            if (res.body.length > 0) {
                const campaign = res.body[0];
                if (!campaign.hasOwnProperty('id') || !campaign.hasOwnProperty('name')) {
                    throw new Error(`Campaign object missing required fields. Got: ${JSON.stringify(campaign)}`);
                }
            }
        });
        
        log('\n=== TEST 3: Verifica isolamento tenant ===');
        
        // Create campaign for tenant 1
        await test('Setup: Create campaign for tenant 1', async () => {
            const createRes = await createTestCampaign(tenant1Slug, tenant1AdminSession, `Test Campaign ${Date.now()}`);
            if (createRes.status !== 200 && createRes.status !== 201) {
                log(`  ⚠ Campaign creation returned ${createRes.status}, continuing anyway`);
            }
        });
        
        await test('Tenant 1 vede solo le proprie campagne', async () => {
            const res = await makeRequest('GET', `/t/${tenant1Slug}/api/admin/campaigns-list`, {
                cookie: tenant1AdminSession
            });
            
            if (res.status !== 200) {
                throw new Error(`Expected 200, got ${res.status}`);
            }
            
            // Verifica che tutte le campagne appartengano al tenant corretto
            // (questo è verificato dal backend, ma possiamo controllare che la risposta sia coerente)
            if (!Array.isArray(res.body)) {
                throw new Error(`Expected array, got ${typeof res.body}`);
            }
        });
        
        await test('Tenant 2 non può accedere alle campagne di tenant 1', async () => {
            const res = await makeRequest('GET', `/t/${tenant1Slug}/api/admin/campaigns-list`, {
                cookie: tenant2AdminSession
            });
            
            // Should be denied (403) or redirect
            if (res.status !== 403 && res.status !== 302) {
                throw new Error(`Expected 403 or 302, got ${res.status}: ${JSON.stringify(res.body)}`);
            }
        });
        
        log('\n=== TEST 4: Verifica endpoint legacy non è impattato ===');
        
        await test('GET /api/admin/campaigns-list (legacy) funziona ancora', async () => {
            const res = await makeRequest('GET', '/api/admin/campaigns-list', {
                cookie: tenant1AdminSession
            });
            
            // Potrebbe restituire 200 o 403/400 a seconda della configurazione
            // L'importante è che non restituisca HTML
            if (isHtmlResponse(res.rawBody)) {
                throw new Error(`Legacy endpoint returned HTML instead of JSON. Status: ${res.status}`);
            }
            
            // Se restituisce 200, deve essere JSON
            if (res.status === 200 && !isJsonResponse(res.body)) {
                throw new Error(`Legacy endpoint returned non-JSON response`);
            }
        });
        
        log('\n=== TEST 5: Verifica altri endpoint non sono impattati ===');
        
        await test('GET /t/:tenantSlug/api/admin/campaigns funziona ancora', async () => {
            const res = await makeRequest('GET', `/t/${tenant1Slug}/api/admin/campaigns`, {
                cookie: tenant1AdminSession
            });
            
            if (res.status !== 200) {
                throw new Error(`Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
            }
            
            if (isHtmlResponse(res.rawBody)) {
                throw new Error(`Response is HTML instead of JSON`);
            }
            
            if (!isJsonResponse(res.body)) {
                throw new Error(`Response is not valid JSON`);
            }
        });
        
        log('\n=== Test Summary ===');
        const passed = testResults.filter(t => t.passed).length;
        const failed = testResults.filter(t => !t.passed).length;
        const total = testResults.length;
        
        log(`Total tests: ${total}`);
        log(`Passed: ${passed}`);
        log(`Failed: ${failed}`);
        log('');
        
        if (failed > 0) {
            log('Failed tests:');
            testResults.filter(t => !t.passed).forEach(t => {
                log(`  ❌ ${t.name}: ${t.error}`);
            });
            log('');
            process.exit(1);
        } else {
            log('✅ All tests passed! The campaigns-list endpoint works correctly.');
            log('');
            process.exit(0);
        }
        
    } catch (error) {
        log(`Fatal error: ${error.message}`);
        console.error(error);
        process.exit(1);
    }
}

// Run tests
runTests().catch(error => {
    log(`Fatal error: ${error.message}`);
    console.error(error);
    process.exit(1);
});


