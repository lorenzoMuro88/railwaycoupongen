#!/usr/bin/env node
/**
 * Admin Extended Test Suite
 * Tests extended admin functionality: CRUD campaigns, coupons, users, analytics
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
let testCouponId = null;
let testUserId = null;
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
    log('=== Admin Extended Test Suite ===');
    log(`Testing against: ${BASE_URL}`);
    log('');
    
    // Setup: Login as admin
    await test('Setup: Login as admin', async () => {
        adminSession = await login(ADMIN_USERNAME, ADMIN_PASSWORD, 'admin');
        adminCsrfToken = await getCsrfToken(adminSession);
        if (!adminSession) throw new Error('Failed to get admin session');
    });
    
    log('');
    log('=== TEST 1: Campaign CRUD ===');
    
    await test('Admin can create campaign', async () => {
        const res = await makeRequest('POST', '/api/admin/campaigns', {
            headers: {
                'Cookie': adminSession,
                'X-CSRF-Token': adminCsrfToken
            },
            body: {
                name: 'Test Campaign Extended ' + Date.now(),
                campaign_code: 'TEST-EXT-' + Date.now(),
                description: 'Test campaign for extended tests',
                discount_type: 'percent',
                discount_value: '15'
            }
        });
        if (res.status !== 200 && res.status !== 201) {
            throw new Error(`Expected 200/201, got ${res.status}: ${JSON.stringify(res.body)}`);
        }
        testCampaignId = res.body.id;
    });
    
    await test('Admin can update campaign', async () => {
        if (!testCampaignId) {
            log('  Skipping: No test campaign ID');
            return;
        }
        const res = await makeRequest('PUT', `/api/admin/campaigns/${testCampaignId}`, {
            headers: {
                'Cookie': adminSession,
                'X-CSRF-Token': adminCsrfToken
            },
            body: {
                name: 'Updated Test Campaign',
                description: 'Updated description'
            }
        });
        if (res.status !== 200) {
            throw new Error(`Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
        }
    });
    
    await test('Admin can activate campaign', async () => {
        if (!testCampaignId) {
            log('  Skipping: No test campaign ID');
            return;
        }
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
    
    await test('Admin can deactivate campaign', async () => {
        if (!testCampaignId) {
            log('  Skipping: No test campaign ID');
            return;
        }
        const res = await makeRequest('PUT', `/api/admin/campaigns/${testCampaignId}/deactivate`, {
            headers: {
                'Cookie': adminSession,
                'X-CSRF-Token': adminCsrfToken
            }
        });
        if (res.status !== 200) {
            throw new Error(`Expected 200, got ${res.status}`);
        }
    });
    
    await test('Admin can get campaign form config', async () => {
        if (!testCampaignId) {
            log('  Skipping: No test campaign ID');
            return;
        }
        const res = await makeRequest('GET', `/api/admin/campaigns/${testCampaignId}/form-config`, {
            headers: { 'Cookie': adminSession }
        });
        if (res.status !== 200) {
            throw new Error(`Expected 200, got ${res.status}`);
        }
    });
    
    log('');
    log('=== TEST 2: Coupon Management ===');
    
    await test('Admin can get list of coupons', async () => {
        const res = await makeRequest('GET', '/api/admin/coupons', {
            headers: { 'Cookie': adminSession }
        });
        if (res.status !== 200) {
            throw new Error(`Expected 200, got ${res.status}`);
        }
        if (!Array.isArray(res.body)) {
            throw new Error('Expected array of coupons');
        }
    });
    
    await test('Admin can search coupons', async () => {
        const res = await makeRequest('GET', '/api/admin/coupons/search?q=TEST', {
            headers: { 'Cookie': adminSession }
        });
        if (res.status !== 200) {
            throw new Error(`Expected 200, got ${res.status}`);
        }
        if (!Array.isArray(res.body)) {
            throw new Error('Expected array of coupons');
        }
    });
    
    log('');
    log('=== TEST 3: User Management ===');
    
    await test('Admin can get list of users', async () => {
        const res = await makeRequest('GET', '/api/admin/users', {
            headers: { 'Cookie': adminSession }
        });
        if (res.status !== 200) {
            throw new Error(`Expected 200, got ${res.status}`);
        }
        if (!Array.isArray(res.body)) {
            throw new Error('Expected array of users');
        }
        if (res.body.length > 0) {
            testUserId = res.body[0].id;
        }
    });
    
    await test('Admin can get user details', async () => {
        if (!testUserId) {
            log('  Skipping: No test user ID');
            return;
        }
        const res = await makeRequest('GET', `/api/admin/users/${testUserId}`, {
            headers: { 'Cookie': adminSession }
        });
        if (res.status !== 200) {
            throw new Error(`Expected 200, got ${res.status}`);
        }
    });
    
    await test('Admin can get user coupons', async () => {
        if (!testUserId) {
            log('  Skipping: No test user ID');
            return;
        }
        const res = await makeRequest('GET', `/api/admin/users/${testUserId}/coupons`, {
            headers: { 'Cookie': adminSession }
        });
        if (res.status !== 200) {
            throw new Error(`Expected 200, got ${res.status}`);
        }
        if (!Array.isArray(res.body)) {
            throw new Error('Expected array of coupons');
        }
    });
    
    log('');
    log('=== TEST 4: Analytics ===');
    
    await test('Admin can get analytics summary', async () => {
        const res = await makeRequest('GET', '/api/admin/analytics/summary', {
            headers: { 'Cookie': adminSession }
        });
        if (res.status !== 200) {
            throw new Error(`Expected 200, got ${res.status}`);
        }
    });
    
    await test('Admin can get campaign analytics', async () => {
        const res = await makeRequest('GET', '/api/admin/analytics/campaigns', {
            headers: { 'Cookie': adminSession }
        });
        if (res.status !== 200) {
            throw new Error(`Expected 200, got ${res.status}`);
        }
    });
    
    await test('Admin can get temporal analytics', async () => {
        const res = await makeRequest('GET', '/api/admin/analytics/temporal', {
            headers: { 'Cookie': adminSession }
        });
        if (res.status !== 200) {
            throw new Error(`Expected 200, got ${res.status}`);
        }
    });
    
    log('');
    log('=== TEST 5: Configuration ===');
    
    await test('Admin can get email template', async () => {
        const res = await makeRequest('GET', '/api/admin/email-template', {
            headers: { 'Cookie': adminSession }
        });
        if (res.status !== 200) {
            throw new Error(`Expected 200, got ${res.status}`);
        }
    });
    
    await test('Admin can get brand settings', async () => {
        const res = await makeRequest('GET', '/api/admin/brand-settings', {
            headers: { 'Cookie': adminSession }
        });
        if (res.status !== 200) {
            throw new Error(`Expected 200, got ${res.status}`);
        }
    });
    
    log('');
    log('=== TEST 6: Cleanup ===');
    
    await test('Admin can delete test campaign', async () => {
        if (!testCampaignId) {
            log('  Skipping: No test campaign ID');
            return;
        }
        const res = await makeRequest('DELETE', `/api/admin/campaigns/${testCampaignId}`, {
            headers: {
                'Cookie': adminSession,
                'X-CSRF-Token': adminCsrfToken
            }
        });
        if (res.status !== 200 && res.status !== 204) {
            throw new Error(`Expected 200/204, got ${res.status}`);
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

