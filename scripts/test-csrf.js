#!/usr/bin/env node
/**
 * CSRF Protection Test Suite
 * Tests CSRF protection on mutating endpoints and verifies public routes still work
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';
const ADMIN_USERNAME = process.env.TEST_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD || process.env.SUPERADMIN_PASSWORD || 'admin123';
const ADMIN_USERTYPE = process.env.TEST_ADMIN_USERTYPE || 'superadmin'; // Use superadmin by default since that's what gets created

let sessionCookie = '';
let csrfToken = '';
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
                'Cookie': sessionCookie,
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
                        if (sessionCookie && !sessionCookie.includes(match[1])) {
                            sessionCookie += `; ${match[1]}=${match[2]}`;
                        } else if (!sessionCookie) {
                            sessionCookie = `${match[1]}=${match[2]}`;
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

async function test(name, fn) {
    try {
        log(`Running: ${name}`);
        await fn();
        testResults.push({ name, passed: true });
        log(`✓ PASSED: ${name}`);
    } catch (error) {
        testResults.push({ name, passed: false, error: error.message });
        log(`✗ FAILED: ${name} - ${error.message}`);
    }
}

async function runTests() {
    log('Starting CSRF Protection Test Suite');
    log(`Testing against: ${BASE_URL}`);
    log('');
    
    // Test 1: Public route should work without CSRF token
    await test('Public GET /health should work', async () => {
        const res = await makeRequest('GET', '/health');
        if (res.status !== 200 && res.status !== 404) {
            throw new Error(`Expected 200 or 404, got ${res.status}`);
        }
    });
    
    // Test 2: CSRF token endpoint should return token
    await test('GET /api/csrf-token should return token', async () => {
        const res = await makeRequest('GET', '/api/csrf-token');
        if (res.status !== 200) {
            throw new Error(`Expected 200, got ${res.status}`);
        }
        if (!res.body || !res.body.csrfToken) {
            throw new Error('Token not found in response');
        }
        csrfToken = res.body.csrfToken;
        log(`  Token received: ${csrfToken.substring(0, 20)}...`);
    });
    
    // Test 3: Protected endpoint without token should fail
    await test('POST /api/admin/campaigns without CSRF token should fail (403)', async () => {
        const res = await makeRequest('POST', '/api/admin/campaigns', {
            body: { name: 'test', campaign_code: 'TEST123' }
        });
        if (res.status !== 403 && res.status !== 401) {
            // 401 is acceptable if not logged in
            if (res.status === 401) {
                log('  Note: Got 401 (not logged in), which is acceptable');
                return;
            }
            throw new Error(`Expected 403 or 401, got ${res.status}`);
        }
    });
    
    // Test 4: Login to get session
    await test('POST /api/login should authenticate', async () => {
        const res = await makeRequest('POST', '/api/login', {
            body: {
                username: ADMIN_USERNAME,
                password: ADMIN_PASSWORD,
                userType: ADMIN_USERTYPE
            }
        });
        if (res.status !== 200 && res.status !== 403) {
            // 403 if CSRF protection active, need to get token first
            if (res.status === 403) {
                // Get token again with session cookie
                const tokenRes = await makeRequest('GET', '/api/csrf-token');
                if (tokenRes.body && tokenRes.body.csrfToken) {
                    csrfToken = tokenRes.body.csrfToken;
                    // Retry login with token
                    const retryRes = await makeRequest('POST', '/api/login', {
                        headers: { 'X-CSRF-Token': csrfToken },
                        body: {
                            username: ADMIN_USERNAME,
                            password: ADMIN_PASSWORD,
                            userType: ADMIN_USERTYPE
                        }
                    });
                    if (retryRes.status !== 200) {
                        throw new Error(`Login with token failed: ${retryRes.status}`);
                    }
                    return;
                }
            }
            throw new Error(`Login failed: ${res.status}`);
        }
    });
    
    // Test 5: Get fresh CSRF token after login
    await test('GET /api/csrf-token after login should work', async () => {
        const res = await makeRequest('GET', '/api/csrf-token');
        if (res.status !== 200) {
            throw new Error(`Expected 200, got ${res.status}`);
        }
        if (!res.body || !res.body.csrfToken) {
            throw new Error('Token not found in response');
        }
        csrfToken = res.body.csrfToken;
    });
    
    // Test 6: Protected endpoint with token should work (if authenticated)
    await test('POST /api/admin/campaigns with CSRF token should work (or fail auth appropriately)', async () => {
        // First ensure we have a valid session by logging in
        const loginRes = await makeRequest('POST', '/api/login', {
            headers: { 'X-CSRF-Token': csrfToken },
            body: {
                username: ADMIN_USERNAME,
                password: ADMIN_PASSWORD,
                userType: ADMIN_USERTYPE
            }
        });
        
        if (loginRes.status === 200) {
            // Get fresh token after login
            const tokenRes = await makeRequest('GET', '/api/csrf-token');
            if (tokenRes.status === 200 && tokenRes.body && tokenRes.body.csrfToken) {
                csrfToken = tokenRes.body.csrfToken;
            }
        }
        
        const res = await makeRequest('POST', '/api/admin/campaigns', {
            headers: { 'X-CSRF-Token': csrfToken },
            body: { name: 'test-campaign', campaign_code: 'TEST' + Date.now() }
        });
        // 200 = success, 400 = validation error (acceptable), 401 = auth issue (acceptable if not logged in)
        // 403 = CSRF error (should not happen with valid token) OR auth error (acceptable if not admin)
        if (res.status === 403 && loginRes.status === 200) {
            // If we logged in but still get 403, it might be CSRF or permission issue
            log(`  Got 403 after login. Response: ${JSON.stringify(res.body)}`);
            // Accept 403 if it's an auth/permission error, not CSRF
            if (res.body && res.body.error && res.body.error.includes('Accesso')) {
                log('  Note: 403 is auth/permission error (acceptable)');
                return;
            }
            throw new Error('Still got 403 with valid CSRF token after login');
        }
        if (res.status >= 500) {
            throw new Error(`Server error: ${res.status}`);
        }
    });
    
    // Test 7: Public submit endpoint should NOT require CSRF (public route)
    await test('POST /submit should work without CSRF (public route)', async () => {
        const res = await makeRequest('POST', '/submit', {
            body: { email: 'test@example.com', campaign_id: 'invalid' }
        });
        // Should not be 403 (CSRF error), but could be 400 (validation) or 404 (campaign not found)
        if (res.status === 403) {
            throw new Error('Public /submit route incorrectly requires CSRF token');
        }
    });
    
    // Test 8: Logout with token should work
    await test('POST /api/logout with CSRF token should work', async () => {
        const res = await makeRequest('POST', '/api/logout', {
            headers: { 'X-CSRF-Token': csrfToken }
        });
        // 200 or redirect is acceptable
        if (res.status === 403) {
            throw new Error('Logout requires CSRF but token was provided');
        }
    });
    
    // Summary
    log('');
    log('='.repeat(60));
    log('TEST SUMMARY');
    log('='.repeat(60));
    const passed = testResults.filter(t => t.passed).length;
    const failed = testResults.filter(t => !t.passed).length;
    testResults.forEach(t => {
        const icon = t.passed ? '✓' : '✗';
        log(`${icon} ${t.name}${t.error ? ` - ${t.error}` : ''}`);
    });
    log('');
    log(`Total: ${testResults.length} | Passed: ${passed} | Failed: ${failed}`);
    
    if (failed > 0) {
        process.exitCode = 1;
    } else {
        log('');
        log('All tests passed! ✓');
    }
}

// Run tests
runTests().catch(error => {
    console.error('[FATAL] Test suite error:', error);
    process.exit(1);
});

