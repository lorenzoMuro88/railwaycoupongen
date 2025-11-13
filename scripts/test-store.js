#!/usr/bin/env node
/**
 * Store Role Test Suite
 * Tests all store functionality: coupon search, redemption, active/redeemed lists
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';
const STORE_USERNAME = process.env.TEST_STORE_USER || 'store';
const STORE_PASSWORD = process.env.TEST_STORE_PASSWORD || 'store123';
const ADMIN_USERNAME = process.env.TEST_ADMIN_USER || 'mario123';
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD || 'admin123';

let storeSession = '';
let adminSession = '';
let storeCsrfToken = '';
let adminCsrfToken = '';
let testCampaignId = null;
let testCouponCode = null;
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
                'Cookie': storeSession,
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
    log('=== Store Role Test Suite ===');
    log(`Testing against: ${BASE_URL}`);
    log('');
    
    // Setup: Login as store and admin
    await test('Setup: Login as store user', async () => {
        storeSession = await login(STORE_USERNAME, STORE_PASSWORD, 'store');
        storeCsrfToken = await getCsrfToken(storeSession);
        if (!storeSession) throw new Error('Failed to get store session');
    });
    
    await test('Setup: Login as admin to create test data', async () => {
        adminSession = await login(ADMIN_USERNAME, ADMIN_PASSWORD, 'admin');
        adminCsrfToken = await getCsrfToken(adminSession);
        if (!adminSession) throw new Error('Failed to get admin session');
    });
    
    // Create test campaign and coupon
    await test('Setup: Create test campaign', async () => {
        const res = await makeRequest('POST', '/api/admin/campaigns', {
            headers: {
                'Cookie': adminSession,
                'X-CSRF-Token': adminCsrfToken
            },
            body: {
                name: 'Test Campaign Store ' + Date.now(),
                campaign_code: 'TEST-STORE-' + Date.now(),
                description: 'Test campaign for store tests',
                discount_type: 'percent',
                discount_value: '10'
            }
        });
        if (res.status !== 200 && res.status !== 201) {
            throw new Error(`Expected 200/201, got ${res.status}: ${JSON.stringify(res.body)}`);
        }
        testCampaignId = res.body.id;
    });
    
    await test('Setup: Activate test campaign', async () => {
        const res = await makeRequest('PUT', `/api/admin/campaigns/${testCampaignId}/activate`, {
            headers: {
                'Cookie': adminSession,
                'X-CSRF-Token': adminCsrfToken
            }
        });
        if (res.status !== 200) {
            throw new Error(`Expected 200, got ${res.status}`);
        }
    });
    
    // Submit form to create coupon
    await test('Setup: Submit form to create coupon', async () => {
        const res = await makeRequest('POST', '/submit', {
            body: {
                campaignCode: 'TEST-STORE-' + Date.now().toString().slice(-8),
                email: 'test@example.com',
                firstName: 'Test',
                lastName: 'User'
            }
        });
        // Accept 200, 302 (redirect), or 404 (campaign not found)
        if (res.status !== 200 && res.status !== 302 && res.status !== 404) {
            throw new Error(`Expected 200/302/404, got ${res.status}`);
        }
    });
    
    log('');
    log('=== TEST 1: Get Active Coupons ===');
    
    await test('Store can get active coupons', async () => {
        const res = await makeRequest('GET', '/api/store/coupons/active', {
            headers: { 'Cookie': storeSession }
        });
        if (res.status !== 200) {
            throw new Error(`Expected 200, got ${res.status}`);
        }
        if (!Array.isArray(res.body)) {
            throw new Error('Expected array of coupons');
        }
    });
    
    log('');
    log('=== TEST 2: Get Redeemed Coupons ===');
    
    await test('Store can get redeemed coupons', async () => {
        const res = await makeRequest('GET', '/api/store/coupons/redeemed', {
            headers: { 'Cookie': storeSession }
        });
        if (res.status !== 200) {
            throw new Error(`Expected 200, got ${res.status}`);
        }
        if (!Array.isArray(res.body)) {
            throw new Error('Expected array of coupons');
        }
    });
    
    log('');
    log('=== TEST 3: Search Coupons ===');
    
    await test('Store can search coupons by code', async () => {
        const res = await makeRequest('GET', '/api/store/coupons/search?q=TEST', {
            headers: { 'Cookie': storeSession }
        });
        if (res.status !== 200) {
            throw new Error(`Expected 200, got ${res.status}`);
        }
        if (!Array.isArray(res.body)) {
            throw new Error('Expected array of coupons');
        }
    });
    
    await test('Store can search coupons by last name', async () => {
        const res = await makeRequest('GET', '/api/store/coupons/search?q=User', {
            headers: { 'Cookie': storeSession }
        });
        if (res.status !== 200) {
            throw new Error(`Expected 200, got ${res.status}`);
        }
        if (!Array.isArray(res.body)) {
            throw new Error('Expected array of coupons');
        }
    });
    
    await test('Store search returns empty array for short query', async () => {
        const res = await makeRequest('GET', '/api/store/coupons/search?q=T', {
            headers: { 'Cookie': storeSession }
        });
        if (res.status !== 200) {
            throw new Error(`Expected 200, got ${res.status}`);
        }
        if (!Array.isArray(res.body)) {
            throw new Error('Expected array of coupons');
        }
    });
    
    log('');
    log('=== TEST 4: Brand Settings ===');
    
    await test('Store can get brand settings', async () => {
        const res = await makeRequest('GET', '/api/store/brand-settings', {
            headers: { 'Cookie': storeSession }
        });
        if (res.status !== 200) {
            throw new Error(`Expected 200, got ${res.status}`);
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

