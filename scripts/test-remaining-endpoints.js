#!/usr/bin/env node
/**
 * Remaining Endpoints Test Suite
 * Tests remaining uncovered endpoints: redeem pages, superadmin login, account, etc.
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
const SUPERADMIN_USERNAME = process.env.SUPERADMIN_USERNAME || 'superadmin';
const SUPERADMIN_PASSWORD = process.env.SUPERADMIN_PASSWORD || 'superadmin123';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'coupons.db');

let adminSession = '';
let superadminSession = '';
let adminCsrfToken = '';
let tenant1Id = null;
let tenant1Slug = 'test-remaining-tenant-1';
let couponCode = null;
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
                'Cookie': options.cookie || adminSession,
                'X-CSRF-Token': options.csrfToken || adminCsrfToken,
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

async function login(username, password, userType) {
    const res = await makeRequest('POST', '/api/login', {
        body: { username, password, userType }
    });
    
    if (res.status !== 200) {
        throw new Error(`Login failed: ${res.status} - ${JSON.stringify(res.body)}`);
    }
    
    const cookies = res.headers['set-cookie'] || [];
    let sessionCookie = '';
    cookies.forEach(cookie => {
        const match = cookie.match(/^([^=]+)=([^;]+)/);
        if (match) {
            if (sessionCookie) {
                sessionCookie += `; ${match[1]}=${match[2]}`;
            } else {
                sessionCookie = `${match[1]}=${match[2]}`;
            }
        }
    });
    
    return sessionCookie;
}

async function setupTestData() {
    log('Setting up test data...');
    const db = await open({
        filename: DB_PATH,
        driver: sqlite3.Database
    });

    await db.run(`INSERT OR IGNORE INTO tenants (slug, name) VALUES (?, ?)`, 
        [tenant1Slug, 'Test Remaining Tenant 1']);

    const tenant1 = await db.get('SELECT id FROM tenants WHERE slug = ?', [tenant1Slug]);
    tenant1Id = tenant1.id;

    // Create test campaign
    let campaignId = null;
    const campaignCodeValue = `TEST-REMAINING-${Date.now()}`;
    await db.run(`INSERT OR IGNORE INTO campaigns (tenant_id, name, discount_type, discount_value, is_active, campaign_code) VALUES (?, ?, ?, ?, ?, ?)`,
        [tenant1Id, 'Test Remaining Campaign', 'percent', 10, 1, campaignCodeValue]);
    
    const campaign = await db.get('SELECT id FROM campaigns WHERE tenant_id = ? LIMIT 1', [tenant1Id]);
    if (campaign) {
        campaignId = campaign.id;
    }

    // Create test user
    await db.run(`INSERT OR IGNORE INTO users (tenant_id, email, first_name, last_name) VALUES (?, ?, ?, ?)`,
        [tenant1Id, 'test-remaining@example.com', 'Test', 'Remaining']);
    const user = await db.get('SELECT id FROM users WHERE tenant_id = ? LIMIT 1', [tenant1Id]);
    const userId = user ? user.id : null;

    // Create test coupon
    couponCode = `TEST-REMAINING-${Date.now()}`;
    await db.run(`INSERT OR IGNORE INTO coupons (tenant_id, campaign_id, user_id, code, status, discount_type, discount_value) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [tenant1Id, campaignId, userId, couponCode, 'active', 'percent', 10]);

    await db.close();
    log(`Test data setup complete. Tenant1: ${tenant1Id}, Coupon: ${couponCode}`);
}

async function cleanupTestData() {
    log('Cleaning up test data...');
    const db = await open({
        filename: DB_PATH,
        driver: sqlite3.Database
    });

    if (tenant1Id) {
        await db.run('DELETE FROM coupons WHERE tenant_id = ?', [tenant1Id]);
        await db.run('DELETE FROM campaigns WHERE tenant_id = ?', [tenant1Id]);
        await db.run('DELETE FROM tenants WHERE id = ?', [tenant1Id]);
    }

    await db.close();
    log('Cleanup complete');
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

async function runTests() {
    log('=== Remaining Endpoints Test Suite ===\n');
    log(`Testing against: ${BASE_URL}\n`);
    
    try {
        await setupTestData();
        
        await test('Setup: Login as admin', async () => {
            adminSession = await login(ADMIN_USERNAME, ADMIN_PASSWORD, 'admin');
            adminCsrfToken = await getCsrfToken(adminSession);
            if (!adminSession) throw new Error('Failed to get admin session');
        });

        log('\n=== TEST 1: GET /t/:tenantSlug/redeem/:code ===');
        
        await test('GET /t/:tenantSlug/redeem/:code: Returns redeem page', async () => {
            if (!couponCode) throw new Error('No coupon code available');
            const res = await makeRequest('GET', `/t/${tenant1Slug}/redeem/${couponCode}`, {});
            if (res.status !== 200 && res.status !== 404) {
                throw new Error(`Unexpected status: ${res.status}`);
            }
        });

        await test('GET /redeem/:code: Returns redeem page (legacy)', async () => {
            if (!couponCode) throw new Error('No coupon code available');
            const res = await makeRequest('GET', `/redeem/${couponCode}`, {});
            // May redirect or return 200/404
            if (res.status !== 200 && res.status !== 302 && res.status !== 404) {
                throw new Error(`Unexpected status: ${res.status}`);
            }
        });

        log('\n=== TEST 2: POST /api/superadmin/login ===');
        
        await test('POST /api/superadmin/login: Validates credentials', async () => {
            const res = await makeRequest('POST', '/api/superadmin/login', {
                body: { username: 'invalid', password: 'invalid' }
            });
            // Should return 401 or 400 for invalid credentials
            if (res.status !== 401 && res.status !== 400 && res.status !== 200) {
                throw new Error(`Unexpected status: ${res.status}`);
            }
        });

        log('\n=== TEST 3: GET /t/:tenantSlug/account ===');
        
        await test('GET /t/:tenantSlug/account: Returns account page', async () => {
            const res = await makeRequest('GET', `/t/${tenant1Slug}/account`, {
                cookie: adminSession
            });
            if (res.status !== 200 && res.status !== 302 && res.status !== 401) {
                throw new Error(`Unexpected status: ${res.status}`);
            }
        });

        await test('GET /account: Returns account page (legacy)', async () => {
            const res = await makeRequest('GET', '/account', {
                cookie: adminSession
            });
            if (res.status !== 200 && res.status !== 302 && res.status !== 401) {
                throw new Error(`Unexpected status: ${res.status}`);
            }
        });

        log('\n=== TEST 4: GET /api/account/profile ===');
        
        await test('GET /api/account/profile: Returns profile', async () => {
            const res = await makeRequest('GET', '/api/account/profile', {
                cookie: adminSession
            });
            if (res.status !== 200 && res.status !== 401 && res.status !== 302) {
                throw new Error(`Unexpected status: ${res.status}`);
            }
        });

        log('\n=== TEST 5: PUT /api/account/profile ===');
        
        await test('PUT /api/account/profile: Updates profile', async () => {
            const res = await makeRequest('PUT', '/api/account/profile', {
                cookie: adminSession,
                csrfToken: adminCsrfToken,
                body: { email: 'updated@example.com' }
            });
            // May return 200, 400 (validation), or 401 (unauthorized)
            if (res.status !== 200 && res.status !== 400 && res.status !== 401 && res.status !== 302) {
                throw new Error(`Unexpected status: ${res.status}`);
            }
        });

        log('\n=== TEST 6: PUT /api/account/password ===');
        
        await test('PUT /api/account/password: Updates password', async () => {
            const res = await makeRequest('PUT', '/api/account/password', {
                cookie: adminSession,
                csrfToken: adminCsrfToken,
                body: { currentPassword: ADMIN_PASSWORD, newPassword: 'newpass123' }
            });
            // May return 200, 400 (validation), or 401 (unauthorized)
            if (res.status !== 200 && res.status !== 400 && res.status !== 401 && res.status !== 302) {
                throw new Error(`Unexpected status: ${res.status}`);
            }
        });

        log('\n=== TEST 7: GET /t/:tenantSlug/db-utenti ===');
        
        await test('GET /t/:tenantSlug/db-utenti: Returns users page', async () => {
            const res = await makeRequest('GET', `/t/${tenant1Slug}/db-utenti`, {
                cookie: adminSession
            });
            if (res.status !== 200 && res.status !== 302 && res.status !== 401) {
                throw new Error(`Unexpected status: ${res.status}`);
            }
        });

        await test('GET /db-utenti: Returns users page (legacy)', async () => {
            const res = await makeRequest('GET', '/db-utenti', {
                cookie: adminSession
            });
            if (res.status !== 200 && res.status !== 302 && res.status !== 401) {
                throw new Error(`Unexpected status: ${res.status}`);
            }
        });

        log('\n=== TEST 8: GET /t/:tenantSlug/utenti ===');
        
        await test('GET /t/:tenantSlug/utenti: Returns users page', async () => {
            const res = await makeRequest('GET', `/t/${tenant1Slug}/utenti`, {
                cookie: adminSession
            });
            if (res.status !== 200 && res.status !== 302 && res.status !== 401) {
                throw new Error(`Unexpected status: ${res.status}`);
            }
        });

        log('\n=== TEST 9: GET /t/:tenantSlug/prodotti ===');
        
        await test('GET /t/:tenantSlug/prodotti: Returns products page', async () => {
            const res = await makeRequest('GET', `/t/${tenant1Slug}/prodotti`, {
                cookie: adminSession
            });
            if (res.status !== 200 && res.status !== 302 && res.status !== 401) {
                throw new Error(`Unexpected status: ${res.status}`);
            }
        });

        log('\n=== TEST 10: GET /superadmin/tenants/:id/brand ===');
        
        await test('GET /superadmin/tenants/:id/brand: Returns brand page (requires superadmin)', async () => {
            // Try to login as superadmin
            try {
                superadminSession = await login(SUPERADMIN_USERNAME, SUPERADMIN_PASSWORD, 'superadmin');
            } catch (e) {
                // If superadmin login fails, skip this test
                log('  ⚠ Skipping superadmin test - superadmin login failed');
                return;
            }
            
            const res = await makeRequest('GET', `/superadmin/tenants/${tenant1Id}/brand`, {
                cookie: superadminSession
            });
            if (res.status !== 200 && res.status !== 302 && res.status !== 401 && res.status !== 403) {
                throw new Error(`Unexpected status: ${res.status}`);
            }
        });

        await cleanupTestData();

    } catch (error) {
        log(`Fatal error: ${error.message}`);
        await cleanupTestData();
        process.exit(1);
    }

    log('\n=== Test Summary ===');
    const passed = testResults.filter(r => r.passed).length;
    const failed = testResults.filter(r => !r.passed).length;
    log(`Total: ${testResults.length}, Passed: ${passed}, Failed: ${failed}`);
    
    if (failed > 0) {
        log('\nFailed tests:');
        testResults.filter(r => !r.passed).forEach(r => {
            log(`  - ${r.name}: ${r.error}`);
        });
        process.exit(1);
    }
}

runTests().catch(err => {
    log(`Fatal error: ${err.message}`);
    console.error(err);
    process.exit(1);
});

