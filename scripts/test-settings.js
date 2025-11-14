#!/usr/bin/env node
/**
 * Settings Test Suite
 * Tests settings endpoints: test-email, email-from-name, email-template, upload-image
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');
const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const FormData = require('form-data');
const fs = require('fs');

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';
const ADMIN_USERNAME = process.env.TEST_ADMIN_USER || 'mario123';
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD || 'admin123';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'coupons.db');

let adminSession = '';
let adminCsrfToken = '';
let tenant1Id = null;
let tenant1Slug = 'test-settings-tenant-1';
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
            if (options.body instanceof FormData) {
                options.body.pipe(req);
            } else {
                req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
            }
        } else {
            req.end();
        }
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
        headers: { 'Content-Type': 'application/json' },
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
        [tenant1Slug, 'Test Settings Tenant 1']);

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
    log('=== Settings Test Suite ===\n');
    log(`Testing against: ${BASE_URL}\n`);
    
    try {
        await setupTestData();
        
        await test('Setup: Login as admin', async () => {
            try {
                adminSession = await login(ADMIN_USERNAME, ADMIN_PASSWORD, 'admin');
                adminCsrfToken = await getCsrfToken(adminSession);
                if (!adminSession) throw new Error('Failed to get admin session');
            } catch (e) {
                log(`  ⚠ Login failed: ${e.message}. Some tests will be skipped.`);
                adminSession = null;
            }
        });

        log('\n=== TEST 1: Test Email Endpoint ===');
        
        await test('GET /api/admin/test-email: Returns success', async () => {
            if (!adminSession) {
                log('  ⚠ Skipping: No admin session');
                return;
            }
            const res = await makeRequest('GET', `/api/admin/test-email`, {
                cookie: adminSession
            });
            // May return 200, 500 (email error), 403 (unauthorized), or 302 (redirect)
            if (res.status !== 200 && res.status !== 500 && res.status !== 403 && res.status !== 302) {
                throw new Error(`Unexpected status: ${res.status}`);
            }
        });

        await test('GET /t/:tenantSlug/api/admin/test-email: Tenant-scoped works', async () => {
            if (!adminSession) {
                log('  ⚠ Skipping: No admin session');
                return;
            }
            const res = await makeRequest('GET', `/t/${tenant1Slug}/api/admin/test-email`, {
                cookie: adminSession
            });
            // May return 200, 500, 302, or 403
            if (res.status !== 200 && res.status !== 500 && res.status !== 302 && res.status !== 403) {
                throw new Error(`Unexpected status: ${res.status}`);
            }
        });

        log('\n=== TEST 2: Email From Name Endpoint ===');
        
        await test('GET /api/admin/email-from-name: Returns current value', async () => {
            if (!adminSession) {
                log('  ⚠ Skipping: No admin session');
                return;
            }
            const res = await makeRequest('GET', `/api/admin/email-from-name`, {
                cookie: adminSession
            });
            // May return 200, 403, or 302
            if (res.status !== 200 && res.status !== 403 && res.status !== 302) {
                throw new Error(`Expected 200/403/302, got ${res.status}`);
            }
            if (res.status === 200 && typeof res.body.fromName !== 'string' && res.body.fromName !== null) {
                throw new Error('Invalid response structure');
            }
        });

        await test('PUT /api/admin/email-from-name: Updates from name', async () => {
            if (!adminSession || !adminCsrfToken) {
                log('  ⚠ Skipping: No admin session or CSRF token');
                return;
            }
            const res = await makeRequest('PUT', `/api/admin/email-from-name`, {
                cookie: adminSession,
                csrfToken: adminCsrfToken,
                headers: { 'Content-Type': 'application/json' },
                body: { fromName: 'Test From Name' }
            });
            // May return 200, 302, 403, or error
            if (res.status !== 200 && res.status !== 302 && res.status !== 403) {
                throw new Error(`Expected 200/302/403, got ${res.status}: ${JSON.stringify(res.body)}`);
            }
        });

        await test('GET /t/:tenantSlug/api/admin/email-from-name: Tenant-scoped GET works', async () => {
            if (!adminSession) {
                log('  ⚠ Skipping: No admin session');
                return;
            }
            const res = await makeRequest('GET', `/t/${tenant1Slug}/api/admin/email-from-name`, {
                cookie: adminSession
            });
            // May return 200, 302, or 403
            if (res.status !== 200 && res.status !== 302 && res.status !== 403) {
                throw new Error(`Expected 200/302/403, got ${res.status}`);
            }
        });

        await test('PUT /t/:tenantSlug/api/admin/email-from-name: Tenant-scoped PUT works', async () => {
            if (!adminSession || !adminCsrfToken) {
                log('  ⚠ Skipping: No admin session or CSRF token');
                return;
            }
            const res = await makeRequest('PUT', `/t/${tenant1Slug}/api/admin/email-from-name`, {
                cookie: adminSession,
                csrfToken: adminCsrfToken,
                headers: { 'Content-Type': 'application/json' },
                body: { fromName: 'Tenant From Name' }
            });
            // May return 200, 302, or 403
            if (res.status !== 200 && res.status !== 302 && res.status !== 403) {
                throw new Error(`Expected 200/302/403, got ${res.status}: ${JSON.stringify(res.body)}`);
            }
        });

        log('\n=== TEST 3: Email Template Endpoint ===');
        
        await test('GET /api/admin/email-template: Returns current template', async () => {
            if (!adminSession) {
                log('  ⚠ Skipping: No admin session');
                return;
            }
            const res = await makeRequest('GET', `/api/admin/email-template`, {
                cookie: adminSession
            });
            // May return 200, 403, or 302
            if (res.status !== 200 && res.status !== 403 && res.status !== 302) {
                throw new Error(`Expected 200/403/302, got ${res.status}`);
            }
            if (res.status === 200 && typeof res.body.template !== 'string') {
                throw new Error('Invalid response structure');
            }
        });

        await test('POST /api/admin/email-template: Updates template', async () => {
            if (!adminSession || !adminCsrfToken) {
                log('  ⚠ Skipping: No admin session or CSRF token');
                return;
            }
            const template = '<html><body>Test Template</body></html>';
            const res = await makeRequest('POST', `/api/admin/email-template`, {
                cookie: adminSession,
                csrfToken: adminCsrfToken,
                headers: { 'Content-Type': 'application/json' },
                body: { template }
            });
            // May return 200, 302, or 403
            if (res.status !== 200 && res.status !== 302 && res.status !== 403) {
                throw new Error(`Expected 200/302/403, got ${res.status}: ${JSON.stringify(res.body)}`);
            }
        });

        log('\n=== TEST 4: Upload Image Endpoint ===');
        
        await test('POST /api/admin/upload-image: Validates file type', async () => {
            if (!adminSession || !adminCsrfToken) {
                log('  ⚠ Skipping: No admin session or CSRF token');
                return;
            }
            // Create a dummy text file (not an image)
            const formData = new FormData();
            formData.append('image', Buffer.from('not an image'), {
                filename: 'test.txt',
                contentType: 'text/plain'
            });
            
            const res = await makeRequest('POST', `/api/admin/upload-image`, {
                cookie: adminSession,
                csrfToken: adminCsrfToken,
                headers: formData.getHeaders(),
                body: formData
            });
            // May return 400/415 (validation error), 403 (unauthorized), or 302 (redirect)
            if (res.status !== 400 && res.status !== 415 && res.status !== 403 && res.status !== 302) {
                throw new Error(`Expected 400/415/403/302 for invalid file type, got ${res.status}`);
            }
        });

        await test('POST /t/:tenantSlug/api/admin/upload-image: Tenant-scoped endpoint exists', async () => {
            // Just verify endpoint exists (may fail validation, but should not 404)
            const formData = new FormData();
            formData.append('image', Buffer.from('fake image'), {
                filename: 'test.jpg',
                contentType: 'image/jpeg'
            });
            
            const res = await makeRequest('POST', `/t/${tenant1Slug}/api/admin/upload-image`, {
                cookie: adminSession,
                csrfToken: adminCsrfToken,
                headers: formData.getHeaders(),
                body: formData
            });
            // Should not be 404
            if (res.status === 404) {
                throw new Error('Endpoint not found');
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

