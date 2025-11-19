#!/usr/bin/env node
/**
 * Audit Logging Test Suite
 * Tests audit logging functionality for CRUD operations
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');
const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';
const ADMIN_USERNAME = process.env.TEST_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD || 'admin123';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'coupons.db');

let sessionCookie = '';
let csrfToken = '';
let tenantId = null;
let testResults = [];

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
        
        if (options.cookie) {
            requestOptions.headers['Cookie'] = options.cookie;
        }
        
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
        
        if (options.body) {
            req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
        }
        
        req.end();
    });
}

async function getCsrfToken(sessionCookie) {
    const res = await makeRequest('GET', '/api/csrf-token', {
        cookie: sessionCookie
    });
    
    if (res.status !== 200) {
        throw new Error(`Failed to get CSRF token: ${res.status}`);
    }
    
    if (!res.body || !res.body.csrfToken) {
        throw new Error('CSRF token not found in response');
    }
    
    return res.body.csrfToken;
}

async function login(username, userType = 'admin') {
    const res = await makeRequest('POST', '/api/login', {
        body: {
            username: username,
            password: ADMIN_PASSWORD,
            userType: userType
        }
    });
    
    if (res.status !== 200) {
        throw new Error(`Login failed with status ${res.status}: ${JSON.stringify(res.body)}`);
    }
    
    const cookies = res.headers['set-cookie'] || [];
    let sessionCookie = '';
    
    cookies.forEach(cookie => {
        if (cookie.startsWith('sessionId=') || cookie.startsWith('connect.sid=')) {
            sessionCookie = cookie.split(';')[0];
        }
    });
    
    if (!sessionCookie) {
        const cookieHeader = res.headers['cookie'];
        if (cookieHeader) {
            sessionCookie = cookieHeader;
        } else {
            throw new Error('No session cookie received');
        }
    }
    
    const csrfToken = await getCsrfToken(sessionCookie);
    
    return { sessionCookie, csrfToken };
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

async function runTests() {
    log('=== Audit Logging Test Suite ===\n');
    log(`Testing against: ${BASE_URL}\n`);
    
    try {
        // Login
        log('Logging in...');
        const loginResult = await login(ADMIN_USERNAME, 'admin');
        sessionCookie = loginResult.sessionCookie;
        csrfToken = loginResult.csrfToken;
        log('Login successful\n');
        
        // Get tenant ID from database
        const db = await open({
            filename: DB_PATH,
            driver: sqlite3.Database
        });
        const tenant = await db.get('SELECT id FROM tenants WHERE slug = ?', 'default');
        tenantId = tenant ? tenant.id : null;
        await db.close();
        
        if (!tenantId) {
            throw new Error('Default tenant not found');
        }
        
        // ===== TEST 1: Create Operation Logging =====
        log('=== TEST 1: Create Operation Logging ===');
        
        let campaignId = null;
        
        await test('Creating campaign logs audit entry', async () => {
            const res = await makeRequest('POST', '/api/admin/campaigns', {
                cookie: sessionCookie,
                headers: {
                    'X-CSRF-Token': csrfToken
                },
                body: {
                    name: 'Test Campaign Audit',
                    discount_type: 'percent',
                    discount_value: '10'
                }
            });
            
            if (res.status !== 200 && res.status !== 201) {
                throw new Error(`Expected 200/201, got ${res.status}: ${JSON.stringify(res.body)}`);
            }
            
            campaignId = res.body.id;
            
            // Check audit log
            const db = await open({
                filename: DB_PATH,
                driver: sqlite3.Database
            });
            
            const logEntry = await db.get(
                'SELECT * FROM system_logs WHERE action_type = ? AND tenant_id = ? ORDER BY timestamp DESC LIMIT 1',
                'create', tenantId
            );
            
            await db.close();
            
            if (!logEntry) {
                throw new Error('Audit log entry not found for campaign creation');
            }
            
            if (logEntry.action_type !== 'create') {
                throw new Error(`Expected action_type 'create', got '${logEntry.action_type}'`);
            }
            
            if (!logEntry.action_description.includes('Campaign created')) {
                throw new Error(`Expected description to include 'Campaign created', got '${logEntry.action_description}'`);
            }
            
            if (logEntry.level !== 'success') {
                throw new Error(`Expected level 'success', got '${logEntry.level}'`);
            }
        });
        
        // ===== TEST 2: Update Operation Logging =====
        log('\n=== TEST 2: Update Operation Logging ===');
        
        await test('Updating campaign logs audit entry', async () => {
            if (!campaignId) {
                throw new Error('campaignId not set from previous test');
            }
            
            const res = await makeRequest('PUT', `/api/admin/campaigns/${campaignId}`, {
                cookie: sessionCookie,
                headers: {
                    'X-CSRF-Token': csrfToken
                },
                body: {
                    name: 'Updated Campaign Audit'
                }
            });
            
            if (res.status !== 200) {
                throw new Error(`Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
            }
            
            // Check audit log
            const db = await open({
                filename: DB_PATH,
                driver: sqlite3.Database
            });
            
            const logEntry = await db.get(
                'SELECT * FROM system_logs WHERE action_type = ? AND tenant_id = ? ORDER BY timestamp DESC LIMIT 1',
                'update', tenantId
            );
            
            await db.close();
            
            if (!logEntry) {
                throw new Error('Audit log entry not found for campaign update');
            }
            
            if (logEntry.action_type !== 'update') {
                throw new Error(`Expected action_type 'update', got '${logEntry.action_type}'`);
            }
        });
        
        // ===== TEST 3: Delete Operation Logging =====
        log('\n=== TEST 3: Delete Operation Logging ===');
        
        await test('Deleting campaign logs audit entry', async () => {
            if (!campaignId) {
                throw new Error('campaignId not set from previous test');
            }
            
            const res = await makeRequest('DELETE', `/api/admin/campaigns/${campaignId}`, {
                cookie: sessionCookie,
                headers: {
                    'X-CSRF-Token': csrfToken
                }
            });
            
            if (res.status !== 200) {
                throw new Error(`Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
            }
            
            // Check audit log
            const db = await open({
                filename: DB_PATH,
                driver: sqlite3.Database
            });
            
            const logEntry = await db.get(
                'SELECT * FROM system_logs WHERE action_type = ? AND tenant_id = ? ORDER BY timestamp DESC LIMIT 1',
                'delete', tenantId
            );
            
            await db.close();
            
            if (!logEntry) {
                throw new Error('Audit log entry not found for campaign deletion');
            }
            
            if (logEntry.action_type !== 'delete') {
                throw new Error(`Expected action_type 'delete', got '${logEntry.action_type}'`);
            }
            
            if (logEntry.level !== 'warning') {
                throw new Error(`Expected level 'warning' for delete, got '${logEntry.level}'`);
            }
        });
        
        // ===== TEST 4: Logs Endpoint =====
        log('\n=== TEST 4: Logs Endpoint ===');
        
        await test('GET /api/admin/logs returns audit logs', async () => {
            const res = await makeRequest('GET', '/api/admin/logs?limit=10', {
                cookie: sessionCookie
            });
            
            if (res.status !== 200) {
                throw new Error(`Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
            }
            
            if (!res.body || !res.body.items) {
                throw new Error('Response missing items array');
            }
            
            if (!Array.isArray(res.body.items)) {
                throw new Error('items is not an array');
            }
            
            if (typeof res.body.total !== 'number') {
                throw new Error('total is not a number');
            }
        });
        
        await test('GET /api/admin/logs filters by actionType', async () => {
            const res = await makeRequest('GET', '/api/admin/logs?actionType=create&limit=10', {
                cookie: sessionCookie
            });
            
            if (res.status !== 200) {
                throw new Error(`Expected 200, got ${res.status}`);
            }
            
            // Verify all items have actionType = 'create'
            const wrongType = res.body.items.find(item => item.actionType !== 'create');
            if (wrongType) {
                throw new Error(`Found item with wrong actionType: ${wrongType.actionType}`);
            }
        });
        
        await test('GET /api/admin/logs filters by level', async () => {
            const res = await makeRequest('GET', '/api/admin/logs?level=success&limit=10', {
                cookie: sessionCookie
            });
            
            if (res.status !== 200) {
                throw new Error(`Expected 200, got ${res.status}`);
            }
            
            // Verify all items have level = 'success'
            const wrongLevel = res.body.items.find(item => item.level !== 'success');
            if (wrongLevel) {
                throw new Error(`Found item with wrong level: ${wrongLevel.level}`);
            }
        });
        
        // ===== TEST 5: Retention Policy =====
        log('\n=== TEST 5: Retention Policy ===');
        
        await test('cleanupOldLogs function exists and works', async () => {
            const { cleanupOldLogs } = require('../routes/auth');
            const { getDb } = require('../utils/db');
            
            if (typeof cleanupOldLogs !== 'function') {
                throw new Error('cleanupOldLogs is not a function');
            }
            
            const db = await getDb();
            const deleted = await cleanupOldLogs(db);
            
            if (typeof deleted !== 'number') {
                throw new Error(`cleanupOldLogs should return number, got ${typeof deleted}`);
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
        }
        
        if (failed > 0) {
            process.exit(1);
        } else {
            log('\n✅ All tests passed!');
            process.exit(0);
        }
        
    } catch (error) {
        log(`\n❌ Fatal error: ${error.message}`);
        console.error(error);
        process.exit(1);
    }
}

// Run tests
runTests();


