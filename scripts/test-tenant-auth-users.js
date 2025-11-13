#!/usr/bin/env node
/**
 * Tenant-Aware Auth Users Test Suite
 * Tests that tenant-scoped auth-users routes work correctly for both admin and superadmin
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');
const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';
const SUPERADMIN_USERNAME = process.env.SUPERADMIN_USERNAME || 'superadmin';
const SUPERADMIN_PASSWORD = process.env.SUPERADMIN_PASSWORD || 'superadmin123';
const ADMIN_USERNAME = process.env.TEST_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD || 'admin123';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'coupons.db');

let superadminSession = '';
let tenant1AdminSession = '';
let tenant2AdminSession = '';
let superadminCsrfToken = '';
let tenant1AdminCsrfToken = '';
let tenant2AdminCsrfToken = '';
let tenant1Id = null;
let tenant2Id = null;
let tenant1Slug = 'test-tenant-1';
let tenant2Slug = 'test-tenant-2';
let testResults = [];

function log(message) {
    console.log(`[TEST] ${message}`);
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
                ...options.headers
            }
        };
        
        if (options.cookie) {
            requestOptions.headers['Cookie'] = options.cookie;
        }
        
        const req = client.request(requestOptions, (res) => {
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
                let parsedBody;
                try {
                    parsedBody = JSON.parse(body);
                } catch (e) {
                    parsedBody = body;
                }
                resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    body: parsedBody
                });
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

async function login(username, password, userType = 'admin') {
    // Use superadmin endpoint for superadmin login
    const endpoint = userType === 'superadmin' ? '/api/superadmin/login' : '/api/login';
    const body = userType === 'superadmin' 
        ? { username, password }  // Superadmin endpoint doesn't need userType
        : { username, password, userType };
    
    const res = await makeRequest('POST', endpoint, {
        body: body
    });
    
    if (res.status !== 200) {
        throw new Error(`Login failed: ${res.status} - ${JSON.stringify(res.body)}`);
    }
    
    const cookies = res.headers['set-cookie'] || [];
    const sessionCookie = cookies.map(c => c.split(';')[0]).join('; ');
    
    return sessionCookie;
}

async function test(name, fn) {
    try {
        await fn();
        testResults.push({ name, status: 'PASS' });
        log(`✅ PASS: ${name}`);
    } catch (error) {
        testResults.push({ name, status: 'FAIL', error: error.message });
        log(`❌ FAIL: ${name} - ${error.message}`);
    }
}

async function cleanupTestData() {
    try {
        const db = await open({
            filename: DB_PATH,
            driver: sqlite3.Database
        });
        
        // Clean up test users
        await db.run(`DELETE FROM auth_users WHERE username LIKE 'test-user-%'`);
        
        await db.close();
        log('Test data cleaned up');
    } catch (error) {
        log(`Warning: Could not clean up test data: ${error.message}`);
    }
}

async function setupTestTenants() {
    const db = await open({
        filename: DB_PATH,
        driver: sqlite3.Database
    });
    
    // Get or create test tenants
    let tenant1 = await db.get('SELECT id, slug FROM tenants WHERE slug = ?', tenant1Slug);
    if (!tenant1) {
        await db.run('INSERT INTO tenants (slug, name) VALUES (?, ?)', tenant1Slug, 'Test Tenant 1');
        tenant1 = await db.get('SELECT id, slug FROM tenants WHERE slug = ?', tenant1Slug);
    }
    tenant1Id = tenant1.id;
    
    let tenant2 = await db.get('SELECT id, slug FROM tenants WHERE slug = ?', tenant2Slug);
    if (!tenant2) {
        await db.run('INSERT INTO tenants (slug, name) VALUES (?, ?)', tenant2Slug, 'Test Tenant 2');
        tenant2 = await db.get('SELECT id, slug FROM tenants WHERE slug = ?', tenant2Slug);
    }
    tenant2Id = tenant2.id;
    
    await db.close();
    log(`Tenant 1 ID: ${tenant1Id}, Slug: ${tenant1Slug}`);
    log(`Tenant 2 ID: ${tenant2Id}, Slug: ${tenant2Slug}`);
}

async function runTests() {
    log('=== Tenant-Aware Auth Users Test Suite ===\n');
    log(`Testing against: ${BASE_URL}\n`);
    
    try {
        // Setup test tenants
        await setupTestTenants();
        
        // Login as superadmin - try both endpoints
        log('Logging in as superadmin...');
        try {
            superadminSession = await login(SUPERADMIN_USERNAME, SUPERADMIN_PASSWORD, 'superadmin');
        } catch (e) {
            // Fallback to regular admin login if superadmin endpoint fails
            log('Superadmin endpoint failed, trying regular admin login...');
            superadminSession = await login(SUPERADMIN_USERNAME, SUPERADMIN_PASSWORD, 'admin');
        }
        superadminCsrfToken = await getCsrfToken(superadminSession);
        log('Superadmin login successful');
        
        // Create test admin users for each tenant
        log('Creating test admin users...');
        const testUser1 = `test-user-${Date.now()}-1`;
        const testUser2 = `test-user-${Date.now()}-2`;
        
        // Create admin user for tenant 1
        const createUser1Res = await makeRequest('POST', '/api/admin/auth-users', {
            cookie: superadminSession,
            headers: {
                'X-CSRF-Token': superadminCsrfToken
            },
            body: {
                username: testUser1,
                password: 'testpass123',
                user_type: 'admin',
                tenant_id: tenant1Id
            }
        });
        
        if (createUser1Res.status !== 200) {
            throw new Error(`Failed to create test user 1: ${createUser1Res.status} - ${JSON.stringify(createUser1Res.body)}`);
        }
        
        // Create admin user for tenant 2
        const createUser2Res = await makeRequest('POST', '/api/admin/auth-users', {
            cookie: superadminSession,
            headers: {
                'X-CSRF-Token': superadminCsrfToken
            },
            body: {
                username: testUser2,
                password: 'testpass123',
                user_type: 'admin',
                tenant_id: tenant2Id
            }
        });
        
        if (createUser2Res.status !== 200) {
            throw new Error(`Failed to create test user 2: ${createUser2Res.status} - ${JSON.stringify(createUser2Res.body)}`);
        }
        
        // Login as tenant 1 admin
        log('Logging in as tenant 1 admin...');
        tenant1AdminSession = await login(testUser1, 'testpass123', 'admin');
        tenant1AdminCsrfToken = await getCsrfToken(tenant1AdminSession);
        log('Tenant 1 admin login successful');
        
        // Login as tenant 2 admin
        log('Logging in as tenant 2 admin...');
        tenant2AdminSession = await login(testUser2, 'testpass123', 'admin');
        tenant2AdminCsrfToken = await getCsrfToken(tenant2AdminSession);
        log('Tenant 2 admin login successful');
        
        log('\n=== TEST 1: Superadmin can access tenant-scoped auth-users routes ===');
        
        await test('Superadmin can GET /t/:tenantSlug/api/admin/auth-users for tenant 1', async () => {
            const res = await makeRequest('GET', `/t/${tenant1Slug}/api/admin/auth-users`, {
                cookie: superadminSession
            });
            
            if (res.status !== 200) {
                throw new Error(`Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
            }
            
            if (!Array.isArray(res.body)) {
                throw new Error(`Expected array, got ${typeof res.body}`);
            }
            
            // Should see at least the test user we created
            const foundUser = res.body.find(u => u.username === testUser1);
            if (!foundUser) {
                throw new Error(`Test user ${testUser1} not found in response`);
            }
        });
        
        await test('Superadmin can GET /t/:tenantSlug/api/admin/auth-users for tenant 2', async () => {
            const res = await makeRequest('GET', `/t/${tenant2Slug}/api/admin/auth-users`, {
                cookie: superadminSession
            });
            
            if (res.status !== 200) {
                throw new Error(`Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
            }
            
            if (!Array.isArray(res.body)) {
                throw new Error(`Expected array, got ${typeof res.body}`);
            }
            
            // Should see at least the test user we created
            const foundUser = res.body.find(u => u.username === testUser2);
            if (!foundUser) {
                throw new Error(`Test user ${testUser2} not found in response`);
            }
        });
        
        log('\n=== TEST 2: Tenant admin can access their own tenant auth-users ===');
        
        await test('Tenant 1 admin can GET /t/:tenantSlug/api/admin/auth-users for their tenant', async () => {
            const res = await makeRequest('GET', `/t/${tenant1Slug}/api/admin/auth-users`, {
                cookie: tenant1AdminSession
            });
            
            if (res.status !== 200) {
                throw new Error(`Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
            }
            
            if (!Array.isArray(res.body)) {
                throw new Error(`Expected array, got ${typeof res.body}`);
            }
        });
        
        await test('Tenant 2 admin can GET /t/:tenantSlug/api/admin/auth-users for their tenant', async () => {
            const res = await makeRequest('GET', `/t/${tenant2Slug}/api/admin/auth-users`, {
                cookie: tenant2AdminSession
            });
            
            if (res.status !== 200) {
                throw new Error(`Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
            }
            
            if (!Array.isArray(res.body)) {
                throw new Error(`Expected array, got ${typeof res.body}`);
            }
        });
        
        log('\n=== TEST 3: Tenant isolation - admin cannot access other tenant ===');
        
        await test('Tenant 1 admin cannot GET /t/:tenantSlug/api/admin/auth-users for tenant 2', async () => {
            const res = await makeRequest('GET', `/t/${tenant2Slug}/api/admin/auth-users`, {
                cookie: tenant1AdminSession
            });
            
            // Should be denied (403) or redirect
            if (res.status !== 403 && res.status !== 302) {
                throw new Error(`Expected 403 or 302, got ${res.status}: ${JSON.stringify(res.body)}`);
            }
        });
        
        await test('Tenant 2 admin cannot GET /t/:tenantSlug/api/admin/auth-users for tenant 1', async () => {
            const res = await makeRequest('GET', `/t/${tenant1Slug}/api/admin/auth-users`, {
                cookie: tenant2AdminSession
            });
            
            // Should be denied (403) or redirect
            if (res.status !== 403 && res.status !== 302) {
                throw new Error(`Expected 403 or 302, got ${res.status}: ${JSON.stringify(res.body)}`);
            }
        });
        
        log('\n=== TEST 4: Superadmin can create users via tenant-scoped route ===');
        
        const newTestUser = `test-user-${Date.now()}-new`;
        await test('Superadmin can POST /t/:tenantSlug/api/admin/auth-users', async () => {
            const res = await makeRequest('POST', `/t/${tenant1Slug}/api/admin/auth-users`, {
                cookie: superadminSession,
                headers: {
                    'X-CSRF-Token': superadminCsrfToken
                },
                body: {
                    username: newTestUser,
                    password: 'testpass123',
                    user_type: 'store'
                }
            });
            
            if (res.status !== 200) {
                throw new Error(`Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
            }
            
            if (!res.body.id || !res.body.username) {
                throw new Error(`Invalid response: ${JSON.stringify(res.body)}`);
            }
        });
        
        log('\n=== TEST 5: Tenant admin can create users in their tenant ===');
        
        const tenant1NewUser = `test-user-${Date.now()}-tenant1`;
        await test('Tenant 1 admin can POST /t/:tenantSlug/api/admin/auth-users', async () => {
            const res = await makeRequest('POST', `/t/${tenant1Slug}/api/admin/auth-users`, {
                cookie: tenant1AdminSession,
                headers: {
                    'X-CSRF-Token': tenant1AdminCsrfToken
                },
                body: {
                    username: tenant1NewUser,
                    password: 'testpass123',
                    user_type: 'store'
                }
            });
            
            if (res.status !== 200) {
                throw new Error(`Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
            }
        });
        
        log('\n=== TEST SUMMARY ===');
        const passed = testResults.filter(r => r.status === 'PASS').length;
        const failed = testResults.filter(r => r.status === 'FAIL').length;
        const total = testResults.length;
        
        log(`Total tests: ${total}`);
        log(`Passed: ${passed}`);
        log(`Failed: ${failed}`);
        
        if (failed > 0) {
            log('\nFailed tests:');
            testResults.filter(r => r.status === 'FAIL').forEach(r => {
                log(`  - ${r.name}: ${r.error}`);
            });
        }
        
        // Cleanup
        await cleanupTestData();
        
        if (failed > 0) {
            process.exit(1);
        } else {
            log('\n✅ All tests passed!');
            process.exit(0);
        }
        
    } catch (error) {
        log(`\n❌ Fatal error: ${error.message}`);
        console.error(error);
        await cleanupTestData();
        process.exit(1);
    }
}

// Run tests
runTests();

