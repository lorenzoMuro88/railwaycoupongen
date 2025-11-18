#!/usr/bin/env node
/**
 * Platform Endpoints Test Suite
 * Tests platform endpoints that may not be fully covered by other test suites
 * 
 * This test suite covers:
 * - Superadmin statistics and tenant management endpoints
 * - Account management endpoints
 * - Store endpoints
 * - Health check endpoints (comprehensive)
 * - Other platform-level endpoints
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';
const SUPERADMIN_USERNAME = process.env.SUPERADMIN_USERNAME || 'admin';
const SUPERADMIN_PASSWORD = process.env.SUPERADMIN_PASSWORD;

const testResults = [];

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
        req.setTimeout(10000, () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
        
        if (options.body) {
            req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
        }
        
        req.end();
    });
}

async function test(name, fn) {
    try {
        await fn();
        testResults.push({ name, status: 'PASS', error: null });
        log(`✅ PASS: ${name}`);
    } catch (error) {
        testResults.push({ name, status: 'FAIL', error: error.message });
        log(`❌ FAIL: ${name} - ${error.message}`);
    }
}

async function getSessionCookie(response) {
    const cookies = response.headers['set-cookie'] || [];
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

async function runTests() {
    log('=== Platform Endpoints Test Suite ===\n');
    log(`Testing against: ${BASE_URL}\n`);
    
    let superadminSession = '';
    let testTenantId = null;
    
    // ===== TEST 1: Health Check Endpoints =====
    log('=== TEST 1: Health Check Endpoints ===');
    
    await test('GET /health returns ok: true', async () => {
        const res = await makeRequest('GET', '/health');
        if (res.status !== 200) {
            throw new Error(`Expected 200, got ${res.status}`);
        }
        if (!res.body || res.body.ok !== true) {
            throw new Error(`Expected { ok: true }, got ${JSON.stringify(res.body)}`);
        }
    });
    
    await test('GET /healthz returns healthy status', async () => {
        const res = await makeRequest('GET', '/healthz');
        if (res.status !== 200) {
            throw new Error(`Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
        }
        if (!res.body || res.body.ok !== true) {
            throw new Error(`Expected { ok: true }, got ${JSON.stringify(res.body)}`);
        }
        if (res.body.status !== 'healthy') {
            throw new Error(`Expected status 'healthy', got '${res.body.status}'`);
        }
    });
    
    await test('GET /healthz/detailed returns comprehensive health info', async () => {
        const res = await makeRequest('GET', '/healthz/detailed');
        if (res.status !== 200) {
            throw new Error(`Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
        }
        if (!res.body || typeof res.body.ok !== 'boolean') {
            throw new Error(`Expected { ok: boolean }, got ${JSON.stringify(res.body)}`);
        }
        if (!res.body.checks || !res.body.checks.database || !res.body.checks.memory) {
            throw new Error('Missing checks object or required checks');
        }
        if (typeof res.body.uptime !== 'number') {
            throw new Error('Missing or invalid uptime');
        }
    });
    
    // ===== TEST 2: Public Configuration =====
    log('\n=== TEST 2: Public Configuration ===');
    
    await test('GET /api/public-config returns configuration', async () => {
        const res = await makeRequest('GET', '/api/public-config');
        if (res.status !== 200) {
            throw new Error(`Expected 200, got ${res.status}`);
        }
        if (!res.body || typeof res.body !== 'object') {
            throw new Error('Expected object response');
        }
    });
    
    // ===== TEST 3: Superadmin Statistics =====
    log('\n=== TEST 3: Superadmin Statistics ===');
    
    if (SUPERADMIN_PASSWORD) {
        await test('Setup: Login as superadmin', async () => {
            const loginRes = await makeRequest('POST', '/api/superadmin/login', {
                body: {
                    username: SUPERADMIN_USERNAME,
                    password: SUPERADMIN_PASSWORD
                }
            });
            if (loginRes.status !== 200) {
                throw new Error(`Login failed: ${loginRes.status} - ${JSON.stringify(loginRes.body)}`);
            }
            superadminSession = await getSessionCookie(loginRes);
            if (!superadminSession) {
                throw new Error('Failed to get session cookie');
            }
        });
        
        await test('GET /api/superadmin/stats returns statistics', async () => {
            const res = await makeRequest('GET', '/api/superadmin/stats', {
                headers: { 'Cookie': superadminSession }
            });
            if (res.status !== 200) {
                throw new Error(`Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
            }
            if (!res.body || typeof res.body.totalTenants !== 'number') {
                throw new Error('Missing or invalid statistics');
            }
            // Verify all expected fields
            const requiredFields = ['totalTenants', 'totalUsers', 'totalCampaigns', 'totalCoupons'];
            for (const field of requiredFields) {
                if (typeof res.body[field] !== 'number') {
                    throw new Error(`Missing or invalid field: ${field}`);
                }
            }
        });
        
        await test('GET /api/superadmin/tenants returns tenant list', async () => {
            const res = await makeRequest('GET', '/api/superadmin/tenants', {
                headers: { 'Cookie': superadminSession }
            });
            if (res.status !== 200) {
                throw new Error(`Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
            }
            if (!Array.isArray(res.body)) {
                throw new Error('Expected array of tenants');
            }
            if (res.body.length > 0) {
                testTenantId = res.body[0].id;
            }
        });
        
        if (testTenantId) {
            await test('GET /api/superadmin/tenants/:id/email/resolve returns email config', async () => {
                const res = await makeRequest('GET', `/api/superadmin/tenants/${testTenantId}/email/resolve`, {
                    headers: { 'Cookie': superadminSession }
                });
                if (res.status !== 200) {
                    throw new Error(`Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
                }
                if (!res.body || typeof res.body.from !== 'string') {
                    throw new Error('Missing or invalid email configuration');
                }
            });
            
            await test('GET /api/superadmin/tenants/:id/email returns email settings', async () => {
                const res = await makeRequest('GET', `/api/superadmin/tenants/${testTenantId}/email`, {
                    headers: { 'Cookie': superadminSession }
                });
                if (res.status !== 200) {
                    throw new Error(`Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
                }
                if (!res.body || typeof res.body !== 'object') {
                    throw new Error('Expected object response');
                }
            });
            
            await test('GET /api/superadmin/tenants/:id/brand returns brand settings', async () => {
                const res = await makeRequest('GET', `/api/superadmin/tenants/${testTenantId}/brand`, {
                    headers: { 'Cookie': superadminSession }
                });
                if (res.status !== 200) {
                    throw new Error(`Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
                }
                if (!res.body || typeof res.body !== 'object') {
                    throw new Error('Expected object response');
                }
            });
        }
        
        await test('GET /api/superadmin/logs returns system logs', async () => {
            const res = await makeRequest('GET', '/api/superadmin/logs', {
                headers: { 'Cookie': superadminSession }
            });
            if (res.status !== 200) {
                throw new Error(`Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
            }
            if (!res.body || !Array.isArray(res.body.logs)) {
                throw new Error('Expected logs array');
            }
        });
    } else {
        log('⚠️  Skipping superadmin tests - SUPERADMIN_PASSWORD not set');
    }
    
    // ===== TEST 4: Account Management (requires auth) =====
    log('\n=== TEST 4: Account Management ===');
    
    await test('GET /api/account/profile without auth returns 401', async () => {
        const res = await makeRequest('GET', '/api/account/profile');
        if (res.status !== 401) {
            throw new Error(`Expected 401, got ${res.status}`);
        }
    });
    
    // ===== TEST 5: Store Brand Settings =====
    log('\n=== TEST 5: Store Brand Settings ===');
    
    await test('GET /api/store/brand-settings without auth returns 401/403 or empty', async () => {
        const res = await makeRequest('GET', '/api/store/brand-settings');
        // Can return 401, 403, or 200 with empty object depending on implementation
        if (res.status !== 401 && res.status !== 403 && res.status !== 200) {
            throw new Error(`Expected 401, 403, or 200, got ${res.status}`);
        }
    });
    
    // ===== TEST 6: Test Email Endpoint =====
    log('\n=== TEST 6: Test Email Endpoint ===');
    
    await test('GET /api/test-coupon-email returns endpoint (may require config)', async () => {
        const res = await makeRequest('GET', '/api/test-coupon-email');
        // Endpoint may return 200 (success) or 500 (if email not configured)
        // Both are acceptable - we just verify the endpoint exists
        if (res.status !== 200 && res.status !== 500) {
            throw new Error(`Expected 200 or 500, got ${res.status}`);
        }
        // Endpoint should return some response
        if (res.body === undefined || res.body === null) {
            throw new Error('Empty response body');
        }
    });
    
    // ===== TEST 7: Check Default Tenant =====
    log('\n=== TEST 7: Check Default Tenant ===');
    
    await test('GET /api/check-default-tenant returns tenant info', async () => {
        const res = await makeRequest('GET', '/api/check-default-tenant');
        if (res.status !== 200) {
            throw new Error(`Expected 200, got ${res.status}`);
        }
        if (!res.body || typeof res.body !== 'object') {
            throw new Error('Expected object response');
        }
    });
    
    // ===== SUMMARY =====
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
        process.exit(1);
    } else {
        log('\n✅ All tests passed!');
        process.exit(0);
    }
}

// Run tests
runTests().catch(error => {
    log(`\n❌ Fatal error: ${error.message}`);
    console.error(error);
    process.exit(1);
});

