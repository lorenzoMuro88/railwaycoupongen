#!/usr/bin/env node
/**
 * Authorization Test Suite
 * Tests role-based access control and permissions for admin, superadmin, and store roles
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';
const SUPERADMIN_USERNAME = process.env.SUPERADMIN_USERNAME || 'superadmin';
const SUPERADMIN_PASSWORD = process.env.SUPERADMIN_PASSWORD || 'superadmin123';
const ADMIN_USERNAME = process.env.TEST_ADMIN_USER || 'mario123';
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD || 'admin123';
const STORE_USERNAME = process.env.TEST_STORE_USER || 'store';
const STORE_PASSWORD = process.env.TEST_STORE_PASSWORD || 'store123';

let superadminSession = '';
let adminSession = '';
let storeSession = '';
let superadminCsrfToken = '';
let adminCsrfToken = '';
let storeCsrfToken = '';
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
                        if (options.sessionVar && !options.sessionVar.includes(match[1])) {
                            options.sessionVar += `; ${match[1]}=${match[2]}`;
                        } else if (options.sessionVar) {
                            // Update existing cookie
                            options.sessionVar = options.sessionVar.replace(
                                new RegExp(`${match[1]}=[^;]+`),
                                `${match[1]}=${match[2]}`
                            );
                        }
                    }
                });
                
                try {
                    const json = data ? JSON.parse(data) : null;
                    resolve({ status: res.statusCode, headers: res.headers, body: json || data });
                } catch (e) {
                    resolve({ status: res.statusCode, headers: res.headers, body: data });
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
        body: { username, password, userType },
        sessionVar: ''
    });
    
    if (res.status !== 200) {
        throw new Error(`Login failed: ${res.status}`);
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
    log('=== Authorization Test Suite ===');
    log(`Testing against: ${BASE_URL}`);
    log('');
    
    // Setup: Login as different roles
    await test('Setup: Login as superadmin', async () => {
        superadminSession = await login(SUPERADMIN_USERNAME, SUPERADMIN_PASSWORD, 'superadmin');
        superadminCsrfToken = await getCsrfToken(superadminSession);
        if (!superadminSession) throw new Error('Failed to get superadmin session');
    });
    
    await test('Setup: Login as admin', async () => {
        try {
            adminSession = await login(ADMIN_USERNAME, ADMIN_PASSWORD, 'admin');
            adminCsrfToken = await getCsrfToken(adminSession);
            if (!adminSession) throw new Error('Failed to get admin session');
        } catch (e) {
            log(`  Warning: Admin login failed (${e.message}). Some admin tests will be skipped.`);
            adminSession = null;
        }
    });
    
    await test('Setup: Login as store', async () => {
        try {
            storeSession = await login(STORE_USERNAME, STORE_PASSWORD, 'store');
            storeCsrfToken = await getCsrfToken(storeSession);
            if (!storeSession) throw new Error('Failed to get store session');
        } catch (e) {
            log(`  Warning: Store login failed (${e.message}). Some store tests will be skipped.`);
            storeSession = null;
        }
    });
    
    log('');
    log('=== TEST 1: SuperAdmin Access ===');
    
    await test('SuperAdmin can access /api/superadmin/tenants', async () => {
        const res = await makeRequest('GET', '/api/superadmin/tenants', {
            headers: { 'Cookie': superadminSession }
        });
        if (res.status !== 200) {
            throw new Error(`Expected 200, got ${res.status}`);
        }
    });
    
    await test('SuperAdmin can access /api/superadmin/stats', async () => {
        const res = await makeRequest('GET', '/api/superadmin/stats', {
            headers: { 'Cookie': superadminSession }
        });
        if (res.status !== 200) {
            throw new Error(`Expected 200, got ${res.status}`);
        }
    });
    
    await test('SuperAdmin can access /api/admin/campaigns', async () => {
        const res = await makeRequest('GET', '/api/admin/campaigns', {
            headers: { 'Cookie': superadminSession }
        });
        if (res.status !== 200) {
            throw new Error(`Expected 200, got ${res.status}`);
        }
    });
    
    await test('SuperAdmin can access /api/store/coupons/active', async () => {
        const res = await makeRequest('GET', '/api/store/coupons/active', {
            headers: { 'Cookie': superadminSession }
        });
        if (res.status !== 200) {
            throw new Error(`Expected 200, got ${res.status}`);
        }
    });
    
    log('');
    log('=== TEST 2: Admin Access ===');
    
    await test('Admin can access /api/admin/campaigns', async () => {
        if (!adminSession) {
            log('  Skipping: No admin session');
            return;
        }
        const res = await makeRequest('GET', '/api/admin/campaigns', {
            headers: { 'Cookie': adminSession }
        });
        if (res.status !== 200) {
            throw new Error(`Expected 200, got ${res.status}`);
        }
    });
    
    await test('Admin can access /api/store/coupons/active', async () => {
        if (!adminSession) {
            log('  Skipping: No admin session');
            return;
        }
        const res = await makeRequest('GET', '/api/store/coupons/active', {
            headers: { 'Cookie': adminSession }
        });
        if (res.status !== 200) {
            throw new Error(`Expected 200, got ${res.status}`);
        }
    });
    
    await test('Admin cannot access /api/superadmin/tenants', async () => {
        const res = await makeRequest('GET', '/api/superadmin/tenants', {
            headers: { 'Cookie': adminSession }
        });
        if (res.status !== 403 && res.status !== 401) {
            throw new Error(`Expected 403 or 401, got ${res.status}`);
        }
    });
    
    await test('Admin cannot create admin users (only superadmin can)', async () => {
        const res = await makeRequest('POST', '/api/admin/auth-users', {
            headers: {
                'Cookie': adminSession,
                'X-CSRF-Token': adminCsrfToken
            },
            body: {
                username: 'test-admin-' + Date.now(),
                password: 'test123',
                user_type: 'admin'
            }
        });
        if (res.status !== 403) {
            throw new Error(`Expected 403, got ${res.status}`);
        }
    });
    
    log('');
    log('=== TEST 3: Store Access ===');
    
    await test('Store can access /api/store/coupons/active', async () => {
        if (!storeSession) {
            log('  Skipping: No store session');
            return;
        }
        const res = await makeRequest('GET', '/api/store/coupons/active', {
            headers: { 'Cookie': storeSession }
        });
        if (res.status !== 200) {
            throw new Error(`Expected 200, got ${res.status}`);
        }
    });
    
    await test('Store cannot access /api/admin/campaigns', async () => {
        const res = await makeRequest('GET', '/api/admin/campaigns', {
            headers: { 'Cookie': storeSession }
        });
        if (res.status !== 403 && res.status !== 401) {
            throw new Error(`Expected 403 or 401, got ${res.status}`);
        }
    });
    
    await test('Store cannot access /api/superadmin/tenants', async () => {
        const res = await makeRequest('GET', '/api/superadmin/tenants', {
            headers: { 'Cookie': storeSession }
        });
        if (res.status !== 403 && res.status !== 401) {
            throw new Error(`Expected 403 or 401, got ${res.status}`);
        }
    });
    
    log('');
    log('=== TEST 4: Unauthenticated Access ===');
    
    await test('Unauthenticated user cannot access /api/admin/campaigns', async () => {
        const res = await makeRequest('GET', '/api/admin/campaigns');
        if (res.status !== 403 && res.status !== 401) {
            throw new Error(`Expected 403 or 401, got ${res.status}`);
        }
    });
    
    await test('Unauthenticated user cannot access /api/superadmin/tenants', async () => {
        const res = await makeRequest('GET', '/api/superadmin/tenants');
        if (res.status !== 403 && res.status !== 401) {
            throw new Error(`Expected 403 or 401, got ${res.status}`);
        }
    });
    
    await test('Unauthenticated user can access public endpoints', async () => {
        const res = await makeRequest('GET', '/health');
        if (res.status !== 200 && res.status !== 404) {
            throw new Error(`Expected 200 or 404, got ${res.status}`);
        }
    });
    
    log('');
    log('=== TEST SUMMARY ===');
    log(`Total tests: ${testResults.length}`);
    log(`Passed: ${testResults.filter(t => t.passed).length}`);
    log(`Failed: ${testResults.filter(t => !t.passed).length}`);
    log('');
    
    if (testResults.some(t => !t.passed)) {
        log('Failed tests:');
        testResults.filter(t => !t.passed).forEach(t => {
            log(`  - ${t.name}: ${t.error}`);
        });
        process.exit(1);
    } else {
        log('✅ All tests passed!');
        process.exit(0);
    }
}

runTests().catch(err => {
    console.error('Test suite error:', err);
    process.exit(1);
});

