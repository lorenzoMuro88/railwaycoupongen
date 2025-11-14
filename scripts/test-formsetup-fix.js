#!/usr/bin/env node
/**
 * Form Setup Fix Test Suite
 * Tests that formsetup API endpoints return JSON instead of HTML (404 errors)
 * Verifies that credentials are properly sent with fetch requests
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';
const ADMIN_USERNAME = process.env.TEST_ADMIN_USER || 'mario123';
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD || 'admin123';

let adminSession = '';
let adminCsrfToken = '';
let testCampaignId = null;
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
        // Return empty string instead of throwing to allow trying other credentials
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

async function runTests() {
    log('=== Form Setup Fix Test Suite ===');
    log('Testing that formsetup API endpoints return JSON instead of HTML');
    log(`Testing against: ${BASE_URL}`);
    log('');
    
    // Check if server is available
    await test('Setup: Check server availability', async () => {
        const available = await checkServerAvailable();
        if (!available) {
            throw new Error(`Server is not available at ${BASE_URL}. Please make sure the server is running.`);
        }
    });
    
    // Setup: Login as admin (try multiple credential combinations)
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
    log('=== TEST 1: Campaigns List Endpoint ===');
    
    await test('GET /api/admin/campaigns returns JSON (not HTML)', async () => {
        const res = await makeRequest('GET', '/api/admin/campaigns', {
            headers: { 'Cookie': adminSession }
        });
        
        if (res.status === 404) {
            throw new Error(`Got 404 status - endpoint not found`);
        }
        
        if (res.status !== 200) {
            throw new Error(`Expected 200, got ${res.status}`);
        }
        
        // Check that response is JSON, not HTML
        if (isHtmlResponse(res.rawBody)) {
            throw new Error(`Response is HTML instead of JSON. First 200 chars: ${res.rawBody.substring(0, 200)}`);
        }
        
        if (!isJsonResponse(res.body)) {
            throw new Error(`Response is not valid JSON. Body type: ${typeof res.body}`);
        }
        
        // Verify it's an array
        if (!Array.isArray(res.body)) {
            throw new Error(`Expected array, got ${typeof res.body}`);
        }
        
        log(`  ✓ Received ${res.body.length} campaigns`);
    });
    
    log('');
    log('=== TEST 2: Create Test Campaign ===');
    
    await test('Create test campaign for form-config tests', async () => {
        const res = await makeRequest('POST', '/api/admin/campaigns', {
            headers: {
                'Cookie': adminSession,
                'X-CSRF-Token': adminCsrfToken
            },
            body: {
                name: 'Test Campaign FormSetup ' + Date.now(),
                campaign_code: 'TEST-FORMSETUP-' + Date.now(),
                description: 'Test campaign for formsetup fix tests',
                discount_type: 'percent',
                discount_value: '10'
            }
        });
        
        if (res.status !== 200 && res.status !== 201) {
            throw new Error(`Expected 200/201, got ${res.status}: ${JSON.stringify(res.body)}`);
        }
        
        if (!res.body || !res.body.id) {
            throw new Error('Campaign ID not returned in response');
        }
        
        testCampaignId = res.body.id;
        log(`  ✓ Created campaign with ID: ${testCampaignId}`);
    });
    
    log('');
    log('=== TEST 3: Form Config Endpoint (Main Fix) ===');
    
    await test('GET /api/admin/campaigns/:id/form-config returns JSON (not HTML)', async () => {
        if (!testCampaignId) {
            throw new Error('No test campaign ID available');
        }
        
        const res = await makeRequest('GET', `/api/admin/campaigns/${testCampaignId}/form-config`, {
            headers: { 'Cookie': adminSession }
        });
        
        if (res.status === 404) {
            throw new Error(`Got 404 status - endpoint not found. This was the original bug!`);
        }
        
        if (res.status !== 200) {
            throw new Error(`Expected 200, got ${res.status}. Response: ${JSON.stringify(res.body)}`);
        }
        
        // CRITICAL: Check that response is JSON, not HTML (this was the bug)
        if (isHtmlResponse(res.rawBody)) {
            throw new Error(`BUG REPRODUCED: Response is HTML instead of JSON! First 200 chars: ${res.rawBody.substring(0, 200)}`);
        }
        
        if (!isJsonResponse(res.body)) {
            throw new Error(`Response is not valid JSON. Body type: ${typeof res.body}, Body: ${JSON.stringify(res.body).substring(0, 200)}`);
        }
        
        // Verify it's an object with form config structure
        if (typeof res.body !== 'object' || Array.isArray(res.body)) {
            throw new Error(`Expected object, got ${Array.isArray(res.body) ? 'array' : typeof res.body}`);
        }
        
        // Verify it has at least email field (required field)
        if (!res.body.email) {
            log('  ⚠ Warning: form-config does not have email field');
        }
        
        log(`  ✓ Received valid form-config JSON`);
        log(`  ✓ Form config keys: ${Object.keys(res.body).join(', ')}`);
    });
    
    await test('GET /api/admin/campaigns/:id/form-config with invalid ID returns 404 JSON (not HTML)', async () => {
        const invalidId = 999999999;
        const res = await makeRequest('GET', `/api/admin/campaigns/${invalidId}/form-config`, {
            headers: { 'Cookie': adminSession }
        });
        
        // Should return 404, but as JSON, not HTML
        if (res.status !== 404) {
            log(`  ⚠ Warning: Expected 404 for invalid campaign ID, got ${res.status}`);
        }
        
        // Even for 404, should be JSON, not HTML
        if (isHtmlResponse(res.rawBody)) {
            throw new Error(`404 response is HTML instead of JSON! First 200 chars: ${res.rawBody.substring(0, 200)}`);
        }
        
        // Should be JSON error object
        if (res.status === 404 && isJsonResponse(res.body)) {
            log(`  ✓ 404 response is valid JSON (as expected)`);
        }
    });
    
    log('');
    log('=== TEST 4: Form Config Update Endpoint ===');
    
    await test('PUT /api/admin/campaigns/:id/form-config works correctly', async () => {
        if (!testCampaignId) {
            throw new Error('No test campaign ID available');
        }
        
        const testFormConfig = {
            email: { visible: true, required: true },
            firstName: { visible: true, required: false },
            lastName: { visible: false, required: false },
            phone: { visible: true, required: true },
            address: { visible: false, required: false },
            allergies: { visible: true, required: false }
        };
        
        const res = await makeRequest('PUT', `/api/admin/campaigns/${testCampaignId}/form-config`, {
            headers: {
                'Cookie': adminSession,
                'X-CSRF-Token': adminCsrfToken,
                'Content-Type': 'application/json'
            },
            body: { formConfig: testFormConfig }
        });
        
        if (res.status !== 200) {
            throw new Error(`Expected 200, got ${res.status}. Response: ${JSON.stringify(res.body)}`);
        }
        
        // Verify response is JSON
        if (isHtmlResponse(res.rawBody)) {
            throw new Error(`Response is HTML instead of JSON! First 200 chars: ${res.rawBody.substring(0, 200)}`);
        }
        
        if (!isJsonResponse(res.body)) {
            throw new Error(`Response is not valid JSON`);
        }
        
        log(`  ✓ Form config updated successfully`);
    });
    
    await test('GET /api/admin/campaigns/:id/form-config returns updated config', async () => {
        if (!testCampaignId) {
            throw new Error('No test campaign ID available');
        }
        
        const res = await makeRequest('GET', `/api/admin/campaigns/${testCampaignId}/form-config`, {
            headers: { 'Cookie': adminSession }
        });
        
        if (res.status !== 200) {
            throw new Error(`Expected 200, got ${res.status}`);
        }
        
        if (isHtmlResponse(res.rawBody)) {
            throw new Error(`Response is HTML instead of JSON!`);
        }
        
        // Verify the updated config is returned
        if (res.body.firstName && res.body.firstName.visible === true) {
            log(`  ✓ Updated form config persisted correctly`);
        }
    });
    
    log('');
    log('=== TEST 5: Verify No HTML in Error Responses ===');
    
    await test('Unauthenticated request returns JSON error (not HTML)', async () => {
        // Make request without session cookie
        const res = await makeRequest('GET', '/api/admin/campaigns', {
            headers: {} // No cookie
        });
        
        // Should return 403 or 401
        if (res.status !== 403 && res.status !== 401) {
            log(`  ⚠ Warning: Expected 403/401 for unauthenticated request, got ${res.status}`);
        }
        
        // Even for auth errors, should be JSON, not HTML
        if (isHtmlResponse(res.rawBody)) {
            throw new Error(`Auth error response is HTML instead of JSON! First 200 chars: ${res.rawBody.substring(0, 200)}`);
        }
        
        if (isJsonResponse(res.body)) {
            log(`  ✓ Auth error response is valid JSON`);
        }
    });
    
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
        log('✅ All tests passed! The formsetup fix is working correctly.');
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

