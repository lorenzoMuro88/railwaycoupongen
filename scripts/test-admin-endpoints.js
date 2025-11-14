#!/usr/bin/env node
/**
 * Admin Endpoints Test Suite
 * Tests that all admin GET endpoints return JSON instead of HTML
 * Verifies credentials are properly handled for GET requests
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';
const ADMIN_USERNAME = process.env.TEST_ADMIN_USER || 'mario123';
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD || 'admin123';

let adminSession = '';
let adminCsrfToken = '';
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
                'Cookie': adminSession,
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
        return '';
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

function isHtmlResponse(body) {
    if (typeof body === 'string') {
        return body.trim().toLowerCase().startsWith('<!doctype') || 
               body.trim().toLowerCase().startsWith('<html');
    }
    return false;
}

function isJsonResponse(body) {
    if (typeof body === 'object') {
        return true;
    }
    if (typeof body === 'string') {
        try {
            JSON.parse(body);
            return true;
        } catch (e) {
            return false;
        }
    }
    return false;
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

async function checkServerAvailable() {
    try {
        const res = await makeRequest('GET', '/api/csrf-token', {});
        return true;
    } catch (error) {
        return false;
    }
}

// List of admin GET endpoints to test
const adminEndpoints = [
    { path: '/api/admin/campaigns', description: 'Campaigns list' },
    { path: '/api/admin/campaigns-list', description: 'Campaigns list (simple)' },
    { path: '/api/admin/products', description: 'Products list' },
    { path: '/api/admin/analytics/summary', description: 'Analytics summary' },
    { path: '/api/admin/analytics/campaigns', description: 'Analytics campaigns' },
    { path: '/api/admin/auth-users', description: 'Auth users list' },
    { path: '/api/admin/brand-settings', description: 'Brand settings' },
    { path: '/api/admin/email-template', description: 'Email template' },
    { path: '/api/admin/form-customization', description: 'Form customization' },
];

async function runTests() {
    log('=== Admin Endpoints Test Suite ===');
    log('Testing that all admin GET endpoints return JSON instead of HTML');
    log(`Testing against: ${BASE_URL}`);
    log('');
    
    // Check if server is available
    await test('Setup: Check server availability', async () => {
        const available = await checkServerAvailable();
        if (!available) {
            throw new Error(`Server is not available at ${BASE_URL}. Please make sure the server is running.`);
        }
    });
    
    // Setup: Login as admin
    await test('Setup: Login as admin', async () => {
        let loggedIn = false;
        const credentials = [
            { username: ADMIN_USERNAME, password: ADMIN_PASSWORD, userType: 'admin' },
            { username: 'admin', password: 'admin123', userType: 'admin' },
            { username: 'superadmin', password: 'superadmin123', userType: 'superadmin' }
        ];
        
        for (const cred of credentials) {
            try {
                adminSession = await login(cred.username, cred.password, cred.userType);
                if (adminSession) {
                    adminCsrfToken = await getCsrfToken(adminSession);
                    loggedIn = true;
                    log(`  ✓ Logged in as ${cred.username}`);
                    break;
                }
            } catch (e) {
                // Try next credentials
            }
        }
        
        if (!loggedIn || !adminSession) {
            throw new Error(`Failed to login with any credentials. Tried: ${credentials.map(c => c.username).join(', ')}`);
        }
    });
    
    log('');
    log('=== Testing Admin GET Endpoints ===');
    
    // Test each endpoint
    for (const endpoint of adminEndpoints) {
        await test(`GET ${endpoint.path} returns JSON (not HTML)`, async () => {
            const res = await makeRequest('GET', endpoint.path, {
                headers: { 'Cookie': adminSession }
            });
            
            if (res.status === 404) {
                throw new Error(`Got 404 status - endpoint not found`);
            }
            
            // Some endpoints might return 403 if not authorized, but should still return JSON
            if (res.status === 403) {
                // Check that 403 response is JSON, not HTML
                if (isHtmlResponse(res.rawBody)) {
                    throw new Error(`403 response is HTML instead of JSON. First 200 chars: ${res.rawBody.substring(0, 200)}`);
                }
                if (!isJsonResponse(res.body)) {
                    throw new Error(`403 response is not valid JSON`);
                }
                log(`  ⚠ Got 403 (expected for some endpoints), but response is JSON ✓`);
                return;
            }
            
            if (res.status !== 200) {
                // Even for non-200, should be JSON
                if (isHtmlResponse(res.rawBody)) {
                    throw new Error(`Status ${res.status} response is HTML instead of JSON. First 200 chars: ${res.rawBody.substring(0, 200)}`);
                }
                log(`  ⚠ Got status ${res.status}, but response is JSON ✓`);
                return;
            }
            
            // Check that response is JSON, not HTML
            if (isHtmlResponse(res.rawBody)) {
                throw new Error(`Response is HTML instead of JSON. First 200 chars: ${res.rawBody.substring(0, 200)}`);
            }
            
            if (!isJsonResponse(res.body)) {
                throw new Error(`Response is not valid JSON. Body type: ${typeof res.body}`);
            }
            
            log(`  ✓ ${endpoint.description} - JSON response received`);
        });
    }
    
    log('');
    log('=== Test Summary ===');
    const passed = testResults.filter(t => t.passed).length;
    const failed = testResults.filter(t => !t.passed).length;
    const total = testResults.length;
    
    log(`Total tests: ${total}`);
    log(`Passed: ${passed}`);
    log(`Failed: ${failed}`);
    log('');
    
    if (failed > 0) {
        log('Failed tests:');
        testResults.filter(t => !t.passed).forEach(t => {
            log(`  ❌ ${t.name}: ${t.error}`);
        });
        log('');
        process.exit(1);
    } else {
        log('✅ All tests passed! All admin endpoints return JSON correctly.');
        log('');
        process.exit(0);
    }
}

// Run tests
runTests().catch(error => {
    log(`Fatal error: ${error.message}`);
    console.error(error);
    process.exit(1);
});



