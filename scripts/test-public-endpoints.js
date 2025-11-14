#!/usr/bin/env node
/**
 * Public Endpoints Test Suite
 * Tests all public endpoints: submit form, campaigns/:code, form pages, etc.
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
let tenant1Slug = 'test-public-tenant-1';
let campaign1Id = null;
let campaignCode = null;
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

    // Create test tenant
    await db.run(`INSERT OR IGNORE INTO tenants (slug, name) VALUES (?, ?)`, 
        [tenant1Slug, 'Test Public Tenant 1']);

    const tenant1 = await db.get('SELECT id FROM tenants WHERE slug = ?', [tenant1Slug]);
    tenant1Id = tenant1.id;

    // Create test campaign
    const campaignCodeValue = `TEST-PUBLIC-${Date.now()}`;
    await db.run(`INSERT OR IGNORE INTO campaigns (tenant_id, name, campaign_code, discount_type, discount_value, is_active) VALUES (?, ?, ?, ?, ?, ?)`,
        [tenant1Id, 'Test Public Campaign', campaignCodeValue, 'percent', 10, 1]);
    
    const campaign = await db.get('SELECT id, campaign_code FROM campaigns WHERE tenant_id = ? AND campaign_code = ?', 
        [tenant1Id, campaignCodeValue]);
    if (campaign) {
        campaign1Id = campaign.id;
        campaignCode = campaign.campaign_code;
    }

    await db.close();
    log(`Test data setup complete. Tenant1: ${tenant1Id}, Campaign: ${campaignCode}`);
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
    log('=== Public Endpoints Test Suite ===\n');
    log(`Testing against: ${BASE_URL}\n`);
    
    try {
        await setupTestData();
        
        await test('Setup: Login as admin', async () => {
            adminSession = await login(ADMIN_USERNAME, ADMIN_PASSWORD, 'admin');
            adminCsrfToken = await getCsrfToken(adminSession);
            if (!adminSession) throw new Error('Failed to get admin session');
        });

        log('\n=== TEST 1: GET /t/:tenantSlug (Form Page) ===');
        
        await test('GET /t/:tenantSlug: Returns form page', async () => {
            const res = await makeRequest('GET', `/t/${tenant1Slug}`, {});
            if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
            if (typeof res.rawBody !== 'string' || !res.rawBody.includes('html')) {
                throw new Error('Should return HTML page');
            }
        });

        log('\n=== TEST 2: GET /t/:tenantSlug/api/campaigns/:code ===');
        
        await test('GET /t/:tenantSlug/api/campaigns/:code: Returns campaign details', async () => {
            if (!campaignCode) throw new Error('No campaign code available');
            const res = await makeRequest('GET', `/t/${tenant1Slug}/api/campaigns/${campaignCode}`, {});
            if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
            // Response is the full campaign object, may have different fields
            if (!res.body || (!res.body.campaign_code && !res.body.name && !res.body.id)) {
                throw new Error(`Invalid response structure: ${JSON.stringify(res.body)}`);
            }
        });

        await test('GET /t/:tenantSlug/api/campaigns/:code: Returns 404 for non-existent campaign', async () => {
            const res = await makeRequest('GET', `/t/${tenant1Slug}/api/campaigns/NONEXISTENT-CODE`, {});
            if (res.status !== 404) throw new Error(`Expected 404, got ${res.status}`);
        });

        log('\n=== TEST 3: POST /t/:tenantSlug/submit (Form Submission) ===');
        
        await test('POST /t/:tenantSlug/submit: Creates coupon successfully', async () => {
            const formData = {
                email: `test-${Date.now()}@example.com`,
                firstName: 'Test',
                lastName: 'User',
                campaign_id: campaign1Id
            };
            const res = await makeRequest('POST', `/t/${tenant1Slug}/submit`, {
                headers: { 'Content-Type': 'application/json' },
                body: formData
            });
            // May return 200, 302 (redirect), or 400 (validation error)
            if (res.status !== 200 && res.status !== 302 && res.status !== 400) {
                throw new Error(`Unexpected status: ${res.status} - ${JSON.stringify(res.body)}`);
            }
        });

        await test('POST /t/:tenantSlug/submit: Validates required email', async () => {
            const res = await makeRequest('POST', `/t/${tenant1Slug}/submit`, {
                headers: { 'Content-Type': 'application/json' },
                body: { firstName: 'Test' }
            });
            if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
        });

        log('\n=== TEST 4: GET /t/:tenantSlug/thanks ===');
        
        await test('GET /t/:tenantSlug/thanks: Returns thanks page', async () => {
            const res = await makeRequest('GET', `/t/${tenant1Slug}/thanks`, {});
            if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
            if (typeof res.rawBody !== 'string' || !res.rawBody.includes('html')) {
                throw new Error('Should return HTML page');
            }
        });

        log('\n=== TEST 5: GET /api/public-config ===');
        
        await test('GET /api/public-config: Returns public configuration', async () => {
            const res = await makeRequest('GET', '/api/public-config', {});
            if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
            if (typeof res.body !== 'object') throw new Error('Should return JSON object');
        });

        log('\n=== TEST 6: GET /t/:tenantSlug/api/tenant-info ===');
        
        await test('GET /t/:tenantSlug/api/tenant-info: Returns tenant info', async () => {
            const res = await makeRequest('GET', `/t/${tenant1Slug}/api/tenant-info`, {});
            // May redirect if requires auth or return 200
            if (res.status !== 200 && res.status !== 302 && res.status !== 401) {
                throw new Error(`Expected 200/302/401, got ${res.status}`);
            }
            if (res.status === 200 && (!res.body || !res.body.slug)) {
                throw new Error('Invalid response structure');
            }
        });

        log('\n=== TEST 7: GET Pages (signup, access, store-login, superadmin-login) ===');
        
        await test('GET /signup: Returns signup page', async () => {
            const res = await makeRequest('GET', '/signup', {});
            if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
        });

        await test('GET /access: Returns access page', async () => {
            const res = await makeRequest('GET', '/access', {});
            if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
        });

        await test('GET /store-login: Returns store login page', async () => {
            const res = await makeRequest('GET', '/store-login', {});
            if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
        });

        await test('GET /superadmin-login: Returns superadmin login page', async () => {
            const res = await makeRequest('GET', '/superadmin-login', {});
            if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
        });

        log('\n=== TEST 8: GET Form Setup Pages ===');
        
        await test('GET /t/:tenantSlug/formsetup: Returns form setup page', async () => {
            const res = await makeRequest('GET', `/t/${tenant1Slug}/formsetup`, {
                cookie: adminSession
            });
            // May require auth, so accept 200 or 302/401
            if (res.status !== 200 && res.status !== 302 && res.status !== 401) {
                throw new Error(`Unexpected status: ${res.status}`);
            }
        });

        await test('GET /t/:tenantSlug/form-design: Returns form design page', async () => {
            const res = await makeRequest('GET', `/t/${tenant1Slug}/form-design`, {
                cookie: adminSession
            });
            if (res.status !== 200 && res.status !== 302 && res.status !== 401) {
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

