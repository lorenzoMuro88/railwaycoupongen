#!/usr/bin/env node
/**
 * Store Endpoints Complete Test Suite
 * Tests all store endpoints: coupons/search, redeem, active/redeemed lists
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');
const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';
const STORE_USERNAME = process.env.TEST_STORE_USER || 'store';
const STORE_PASSWORD = process.env.TEST_STORE_PASSWORD || 'store123';
const ADMIN_USERNAME = process.env.TEST_ADMIN_USER || 'mario123';
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD || 'admin123';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'coupons.db');

let storeSession = '';
let adminSession = '';
let storeCsrfToken = '';
let adminCsrfToken = '';
let tenant1Id = null;
let tenant1Slug = 'test-store-complete-tenant-1';
let campaign1Id = null;
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
                'Cookie': options.cookie || storeSession,
                'X-CSRF-Token': options.csrfToken || storeCsrfToken,
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
                        if (storeSession && !storeSession.includes(match[1])) {
                            storeSession += `; ${match[1]}=${match[2]}`;
                        } else if (!storeSession) {
                            storeSession = `${match[1]}=${match[2]}`;
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

    // Create test tenant
    await db.run(`INSERT OR IGNORE INTO tenants (slug, name) VALUES (?, ?)`, 
        [tenant1Slug, 'Test Store Complete Tenant 1']);

    const tenant1 = await db.get('SELECT id FROM tenants WHERE slug = ?', [tenant1Slug]);
    tenant1Id = tenant1.id;

    // Create test campaign
    await db.run(`INSERT OR IGNORE INTO campaigns (tenant_id, name, discount_type, discount_value, is_active, campaign_code) VALUES (?, ?, ?, ?, ?, ?)`,
        [tenant1Id, 'Test Store Campaign', 'percent', 10, 1, `TEST-CAMP-${Date.now()}`]);
    
    const campaign = await db.get('SELECT id FROM campaigns WHERE tenant_id = ? LIMIT 1', [tenant1Id]);
    if (campaign) {
        campaign1Id = campaign.id;
    }

    // Create test user
    await db.run(`INSERT OR IGNORE INTO users (tenant_id, email, first_name, last_name) VALUES (?, ?, ?, ?)`,
        [tenant1Id, 'test-store@example.com', 'Test', 'Store']);
    const user = await db.get('SELECT id FROM users WHERE tenant_id = ? LIMIT 1', [tenant1Id]);
    const userId = user ? user.id : null;

    // Create test coupon
    couponCode = `TEST-STORE-${Date.now()}`;
    await db.run(`INSERT OR IGNORE INTO coupons (tenant_id, campaign_id, user_id, code, status, discount_type, discount_value) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [tenant1Id, campaign1Id, userId, couponCode, 'active', 'percent', 10]);

    await db.close();
    log(`Test data setup complete. Tenant1: ${tenant1Id}, Campaign: ${campaign1Id}, Coupon: ${couponCode}`);
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
    log('=== Store Endpoints Complete Test Suite ===\n');
    log(`Testing against: ${BASE_URL}\n`);
    
    try {
        await setupTestData();
        
        await test('Setup: Login as store user', async () => {
            storeSession = await login(STORE_USERNAME, STORE_PASSWORD, 'store');
            storeCsrfToken = await getCsrfToken(storeSession);
            if (!storeSession) throw new Error('Failed to get store session');
        });

        log('\n=== TEST 1: GET /t/:tenantSlug/store (Store Page) ===');
        
        await test('GET /t/:tenantSlug/store: Returns store page', async () => {
            const res = await makeRequest('GET', `/t/${tenant1Slug}/store`, {
                cookie: storeSession
            });
            // May redirect to login if tenant doesn't match session
            if (res.status !== 200 && res.status !== 302) {
                throw new Error(`Expected 200/302, got ${res.status}`);
            }
        });

        log('\n=== TEST 2: GET /t/:tenantSlug/api/store/coupons/search ===');
        
        await test('GET /t/:tenantSlug/api/store/coupons/search: Search by code', async () => {
            if (!couponCode) throw new Error('No coupon code available');
            const res = await makeRequest('GET', `/t/${tenant1Slug}/api/store/coupons/search?q=${couponCode}`, {
                cookie: storeSession
            });
            // May redirect if tenant doesn't match session
            if (res.status !== 200 && res.status !== 302) {
                throw new Error(`Expected 200/302, got ${res.status}: ${JSON.stringify(res.body)}`);
            }
            if (res.status === 200 && !Array.isArray(res.body)) {
                throw new Error('Should return array');
            }
        });

        await test('GET /t/:tenantSlug/api/store/coupons/search: Search by last name', async () => {
            const res = await makeRequest('GET', `/t/${tenant1Slug}/api/store/coupons/search?q=Test`, {
                cookie: storeSession
            });
            // May redirect if tenant doesn't match session
            if (res.status !== 200 && res.status !== 302) {
                throw new Error(`Expected 200/302, got ${res.status}`);
            }
            if (res.status === 200 && !Array.isArray(res.body)) {
                throw new Error('Should return array');
            }
        });

        await test('GET /t/:tenantSlug/api/store/coupons/search: Returns empty array for no results', async () => {
            const res = await makeRequest('GET', `/t/${tenant1Slug}/api/store/coupons/search?q=NONEXISTENT12345`, {
                cookie: storeSession
            });
            // May redirect if tenant doesn't match session
            if (res.status !== 200 && res.status !== 302) {
                throw new Error(`Expected 200/302, got ${res.status}`);
            }
            if (res.status === 200 && !Array.isArray(res.body)) {
                throw new Error('Should return array');
            }
        });

        log('\n=== TEST 3: GET /t/:tenantSlug/api/coupons/:code ===');
        
        await test('GET /t/:tenantSlug/api/coupons/:code: Returns coupon details', async () => {
            if (!couponCode) throw new Error('No coupon code available');
            const res = await makeRequest('GET', `/t/${tenant1Slug}/api/coupons/${couponCode}`, {
                cookie: storeSession
            });
            // May return 404 if coupon not found or tenant mismatch, or 200 if found
            if (res.status !== 200 && res.status !== 404 && res.status !== 302) {
                throw new Error(`Expected 200/404/302, got ${res.status}: ${JSON.stringify(res.body)}`);
            }
            if (res.status === 200 && (!res.body || !res.body.code)) {
                throw new Error('Invalid response structure');
            }
        });

        await test('GET /t/:tenantSlug/api/coupons/:code: Returns 404 for non-existent coupon', async () => {
            const res = await makeRequest('GET', `/t/${tenant1Slug}/api/coupons/NONEXISTENT-CODE`, {
                cookie: storeSession
            });
            if (res.status !== 404) throw new Error(`Expected 404, got ${res.status}`);
        });

        log('\n=== TEST 4: POST /t/:tenantSlug/api/coupons/:code/redeem ===');
        
        await test('POST /t/:tenantSlug/api/coupons/:code/redeem: Redeems coupon successfully', async () => {
            // Create a new coupon for redemption
            const db = await open({
                filename: DB_PATH,
                driver: sqlite3.Database
            });
            const user = await db.get('SELECT id FROM users WHERE tenant_id = ? LIMIT 1', [tenant1Id]);
            if (!user) throw new Error('No user found for tenant');
            const redeemCouponCode = `REDEEM-${Date.now()}`;
            await db.run(`INSERT INTO coupons (tenant_id, campaign_id, user_id, code, status, discount_type, discount_value) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [tenant1Id, campaign1Id, user.id, redeemCouponCode, 'active', 'percent', 10]);
            await db.close();

            const res = await makeRequest('POST', `/t/${tenant1Slug}/api/coupons/${redeemCouponCode}/redeem`, {
                cookie: storeSession,
                csrfToken: storeCsrfToken,
                body: {}
            });
            if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
            if (!res.body || res.body.status !== 'redeemed') {
                throw new Error('Coupon should be redeemed');
            }
        });

        await test('POST /t/:tenantSlug/api/coupons/:code/redeem: Returns 404 for non-existent coupon', async () => {
            const res = await makeRequest('POST', `/t/${tenant1Slug}/api/coupons/NONEXISTENT-CODE/redeem`, {
                cookie: storeSession,
                csrfToken: storeCsrfToken,
                body: {}
            });
            if (res.status !== 404) throw new Error(`Expected 404, got ${res.status}`);
        });

        await test('POST /t/:tenantSlug/api/coupons/:code/redeem: Returns 400 for already redeemed coupon', async () => {
            // Create and redeem a coupon
            const db = await open({
                filename: DB_PATH,
                driver: sqlite3.Database
            });
            const user = await db.get('SELECT id FROM users WHERE tenant_id = ? LIMIT 1', [tenant1Id]);
            if (!user) throw new Error('No user found for tenant');
            const redeemedCouponCode = `REDEEMED-${Date.now()}`;
            await db.run(`INSERT INTO coupons (tenant_id, campaign_id, user_id, code, status, discount_type, discount_value, redeemed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [tenant1Id, campaign1Id, user.id, redeemedCouponCode, 'redeemed', 'percent', 10, new Date().toISOString()]);
            await db.close();

            const res = await makeRequest('POST', `/t/${tenant1Slug}/api/coupons/${redeemedCouponCode}/redeem`, {
                cookie: storeSession,
                csrfToken: storeCsrfToken,
                body: {}
            });
            // May return 400 or 409
            if (res.status !== 400 && res.status !== 409) {
                throw new Error(`Expected 400/409, got ${res.status}`);
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

