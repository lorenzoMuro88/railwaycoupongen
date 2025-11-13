#!/usr/bin/env node
/**
 * SuperAdmin Test Suite
 * Tests all superadmin functionality: tenant management, admin users, brand/email config
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';
const SUPERADMIN_USERNAME = process.env.SUPERADMIN_USERNAME || 'superadmin';
const SUPERADMIN_PASSWORD = process.env.SUPERADMIN_PASSWORD || 'superadmin123';

let superadminSession = '';
let superadminCsrfToken = '';
let testTenantId = null;
let testAdminUserId = null;
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
                'Cookie': superadminSession,
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
                        if (superadminSession && !superadminSession.includes(match[1])) {
                            superadminSession += `; ${match[1]}=${match[2]}`;
                        } else if (!superadminSession) {
                            superadminSession = `${match[1]}=${match[2]}`;
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
        body: { username, password, userType }
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
    log('=== SuperAdmin Test Suite ===');
    log(`Testing against: ${BASE_URL}`);
    log('');
    
    // Setup: Login as superadmin
    await test('Setup: Login as superadmin', async () => {
        superadminSession = await login(SUPERADMIN_USERNAME, SUPERADMIN_PASSWORD, 'superadmin');
        superadminCsrfToken = await getCsrfToken(superadminSession);
        if (!superadminSession) throw new Error('Failed to get superadmin session');
    });
    
    log('');
    log('=== TEST 1: Tenant Management ===');
    
    await test('SuperAdmin can get list of tenants', async () => {
        const res = await makeRequest('GET', '/api/superadmin/tenants', {
            headers: { 'Cookie': superadminSession }
        });
        if (res.status !== 200) {
            throw new Error(`Expected 200, got ${res.status}`);
        }
        if (!Array.isArray(res.body)) {
            throw new Error('Expected array of tenants');
        }
    });
    
    await test('SuperAdmin can create new tenant', async () => {
        const tenantName = 'Test Tenant ' + Date.now();
        const tenantSlug = 'test-tenant-' + Date.now();
        const res = await makeRequest('POST', '/api/superadmin/tenants', {
            headers: {
                'Cookie': superadminSession,
                'X-CSRF-Token': superadminCsrfToken
            },
            body: {
                name: tenantName,
                slug: tenantSlug,
                adminUsername: 'admin-' + Date.now(),
                adminPassword: 'admin123'
            }
        });
        if (res.status !== 200 && res.status !== 201) {
            throw new Error(`Expected 200/201, got ${res.status}: ${JSON.stringify(res.body)}`);
        }
        testTenantId = res.body.id || res.body.tenantId;
    });
    
    await test('SuperAdmin can get tenant brand settings', async () => {
        if (!testTenantId) {
            log('  Skipping: No test tenant ID');
            return;
        }
        const res = await makeRequest('GET', `/api/superadmin/tenants/${testTenantId}/brand`, {
            headers: { 'Cookie': superadminSession }
        });
        if (res.status !== 200) {
            throw new Error(`Expected 200, got ${res.status}`);
        }
    });
    
    await test('SuperAdmin can update tenant brand settings', async () => {
        if (!testTenantId) {
            log('  Skipping: No test tenant ID');
            return;
        }
        const res = await makeRequest('POST', `/api/superadmin/tenants/${testTenantId}/brand`, {
            headers: {
                'Cookie': superadminSession,
                'X-CSRF-Token': superadminCsrfToken
            },
            body: {
                primaryColor: '#FF0000',
                secondaryColor: '#00FF00',
                logoUrl: 'https://example.com/logo.png'
            }
        });
        if (res.status !== 200) {
            throw new Error(`Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
        }
    });
    
    await test('SuperAdmin can get tenant email config', async () => {
        if (!testTenantId) {
            log('  Skipping: No test tenant ID');
            return;
        }
        const res = await makeRequest('GET', `/api/superadmin/tenants/${testTenantId}/email`, {
            headers: { 'Cookie': superadminSession }
        });
        if (res.status !== 200) {
            throw new Error(`Expected 200, got ${res.status}`);
        }
    });
    
    await test('SuperAdmin can update tenant email config', async () => {
        if (!testTenantId) {
            log('  Skipping: No test tenant ID');
            return;
        }
        const res = await makeRequest('PUT', `/api/superadmin/tenants/${testTenantId}/email`, {
            headers: {
                'Cookie': superadminSession,
                'X-CSRF-Token': superadminCsrfToken
            },
            body: {
                email_from_name: 'Test From Name',
                email_from_address: 'test@example.com'
            }
        });
        if (res.status !== 200) {
            throw new Error(`Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
        }
    });
    
    log('');
    log('=== TEST 2: Admin Users Management ===');
    
    await test('SuperAdmin can get list of admin users', async () => {
        const res = await makeRequest('GET', '/api/superadmin/admin-users', {
            headers: { 'Cookie': superadminSession }
        });
        if (res.status !== 200) {
            throw new Error(`Expected 200, got ${res.status}`);
        }
        if (!Array.isArray(res.body)) {
            throw new Error('Expected array of admin users');
        }
    });
    
    await test('SuperAdmin can create admin user', async () => {
        const username = 'admin-test-' + Date.now();
        const res = await makeRequest('POST', '/api/admin/auth-users', {
            headers: {
                'Cookie': superadminSession,
                'X-CSRF-Token': superadminCsrfToken
            },
            body: {
                username: username,
                password: 'admin123',
                user_type: 'admin'
            }
        });
        if (res.status !== 200 && res.status !== 201) {
            throw new Error(`Expected 200/201, got ${res.status}: ${JSON.stringify(res.body)}`);
        }
        testAdminUserId = res.body.id;
    });
    
    await test('SuperAdmin can update admin user', async () => {
        if (!testAdminUserId) {
            log('  Skipping: No test admin user ID');
            return;
        }
        const res = await makeRequest('PUT', `/api/superadmin/admin-users/${testAdminUserId}`, {
            headers: {
                'Cookie': superadminSession,
                'X-CSRF-Token': superadminCsrfToken
            },
            body: {
                is_active: true
            }
        });
        if (res.status !== 200) {
            throw new Error(`Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
        }
    });
    
    log('');
    log('=== TEST 3: Statistics ===');
    
    await test('SuperAdmin can get global statistics', async () => {
        const res = await makeRequest('GET', '/api/superadmin/stats', {
            headers: { 'Cookie': superadminSession }
        });
        if (res.status !== 200) {
            throw new Error(`Expected 200, got ${res.status}`);
        }
    });
    
    log('');
    log('=== TEST 4: System Logs ===');
    
    await test('SuperAdmin can get system logs', async () => {
        const res = await makeRequest('GET', '/api/superadmin/logs', {
            headers: { 'Cookie': superadminSession }
        });
        if (res.status !== 200) {
            throw new Error(`Expected 200, got ${res.status}`);
        }
        if (!Array.isArray(res.body)) {
            throw new Error('Expected array of logs');
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


