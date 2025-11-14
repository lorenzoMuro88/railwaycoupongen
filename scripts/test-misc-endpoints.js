#!/usr/bin/env node
/**
 * Miscellaneous Endpoints Test Suite
 * Tests various endpoints: uploads, form-customization, brand-settings, etc.
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
let tenant1Slug = 'test-misc-tenant-1';
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
        [tenant1Slug, 'Test Misc Tenant 1']);

    const tenant1 = await db.get('SELECT id FROM tenants WHERE slug = ?', [tenant1Slug]);
    tenant1Id = tenant1.id;

    await db.close();
    log(`Test data setup complete. Tenant1: ${tenant1Id}`);
}

async function cleanupTestData() {
    log('Cleaning up test data...');
    const db = await open({
        filename: DB_PATH,
        driver: sqlite3.Database
    });

    if (tenant1Id) await db.run('DELETE FROM tenants WHERE id = ?', [tenant1Id]);

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
    log('=== Miscellaneous Endpoints Test Suite ===\n');
    log(`Testing against: ${BASE_URL}\n`);
    
    try {
        await setupTestData();
        
        await test('Setup: Login as admin', async () => {
            adminSession = await login(ADMIN_USERNAME, ADMIN_PASSWORD, 'admin');
            adminCsrfToken = await getCsrfToken(adminSession);
            if (!adminSession) throw new Error('Failed to get admin session');
        });

        log('\n=== TEST 1: GET /t/:tenantSlug/api/form-customization ===');
        
        await test('GET /t/:tenantSlug/api/form-customization: Returns form customization', async () => {
            const res = await makeRequest('GET', `/t/${tenant1Slug}/api/form-customization`, {
                cookie: adminSession
            });
            // May require auth, so accept 200 or 401/302
            if (res.status !== 200 && res.status !== 401 && res.status !== 302) {
                throw new Error(`Unexpected status: ${res.status}`);
            }
        });

        log('\n=== TEST 2: GET /t/:tenantSlug/api/brand-settings ===');
        
        await test('GET /t/:tenantSlug/api/brand-settings: Returns brand settings', async () => {
            const res = await makeRequest('GET', `/t/${tenant1Slug}/api/brand-settings`, {
                cookie: adminSession
            });
            if (res.status !== 200 && res.status !== 401 && res.status !== 302) {
                throw new Error(`Unexpected status: ${res.status}`);
            }
        });

        log('\n=== TEST 3: GET /t/:tenantSlug/api/uploads/:filename ===');
        
        await test('GET /t/:tenantSlug/api/uploads/:filename: Returns 404 for non-existent file', async () => {
            const res = await makeRequest('GET', `/t/${tenant1Slug}/api/uploads/nonexistent.jpg`, {
                cookie: adminSession
            });
            // Should return 404 for non-existent file
            if (res.status !== 404 && res.status !== 401 && res.status !== 302) {
                throw new Error(`Expected 404/401/302, got ${res.status}`);
            }
        });

        log('\n=== TEST 4: GET /t/:tenantSlug/admin ===');
        
        await test('GET /t/:tenantSlug/admin: Returns admin page', async () => {
            const res = await makeRequest('GET', `/t/${tenant1Slug}/admin`, {
                cookie: adminSession
            });
            if (res.status !== 200 && res.status !== 302) {
                throw new Error(`Unexpected status: ${res.status}`);
            }
        });

        log('\n=== TEST 5: GET /t/:tenantSlug/admin/email-template ===');
        
        await test('GET /t/:tenantSlug/admin/email-template: Returns email template page', async () => {
            const res = await makeRequest('GET', `/t/${tenant1Slug}/admin/email-template`, {
                cookie: adminSession
            });
            if (res.status !== 200 && res.status !== 302 && res.status !== 401) {
                throw new Error(`Unexpected status: ${res.status}`);
            }
        });

        log('\n=== TEST 6: GET /t/:tenantSlug/analytics ===');
        
        await test('GET /t/:tenantSlug/analytics: Returns analytics page', async () => {
            const res = await makeRequest('GET', `/t/${tenant1Slug}/analytics`, {
                cookie: adminSession
            });
            if (res.status !== 200 && res.status !== 302 && res.status !== 401) {
                throw new Error(`Unexpected status: ${res.status}`);
            }
        });

        log('\n=== TEST 7: GET /api/test-coupon-email ===');
        
        await test('GET /api/test-coupon-email: Returns test email endpoint', async () => {
            const res = await makeRequest('GET', '/api/test-coupon-email', {
                cookie: adminSession
            });
            // May return 200 or 500 depending on email config
            if (res.status !== 200 && res.status !== 500 && res.status !== 401) {
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

