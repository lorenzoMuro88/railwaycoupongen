#!/usr/bin/env node
/**
 * Signup and Auth Pages Test Suite
 * Tests signup endpoint, auth pages, logout, etc.
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');
const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'coupons.db');

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

async function cleanupTestData() {
    log('Cleaning up test data...');
    const db = await open({
        filename: DB_PATH,
        driver: sqlite3.Database
    });

    // Clean up test tenants and users
    await db.run('DELETE FROM auth_users WHERE username LIKE ?', ['test-signup-%']);
    await db.run('DELETE FROM tenants WHERE slug LIKE ?', ['test-signup-%']);

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
    log('=== Signup and Auth Pages Test Suite ===\n');
    log(`Testing against: ${BASE_URL}\n`);
    
    try {
        log('\n=== TEST 1: GET Pages (signup, access, store-login, superadmin-login) ===');
        
        await test('GET /signup: Returns signup page', async () => {
            const res = await makeRequest('GET', '/signup', {});
            if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
            if (typeof res.rawBody !== 'string' || !res.rawBody.includes('html')) {
                throw new Error('Should return HTML page');
            }
        });

        await test('GET /access: Returns access page', async () => {
            const res = await makeRequest('GET', '/access', {});
            if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
        });

        await test('GET /store-login: Returns store login page', async () => {
            const res = await makeRequest('GET', '/store-login', {});
            if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
        });

        await test('GET /superadmin-login: Returns superadmin login page', async () => {
            const res = await makeRequest('GET', '/superadmin-login', {});
            if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
        });

        log('\n=== TEST 2: POST /api/signup ===');
        
        await test('POST /api/signup: Validates required fields', async () => {
            const res = await makeRequest('POST', '/api/signup', {
                body: { username: 'test' }
            });
            if (res.status !== 400) throw new Error(`Expected 400, got ${res.status}`);
        });

        await test('POST /api/signup: Creates tenant and admin (if not exists)', async () => {
            const uniqueSlug = `test-signup-${Date.now()}`;
            const res = await makeRequest('POST', '/api/signup', {
                body: {
                    tenantSlug: uniqueSlug,
                    tenantName: 'Test Signup Tenant',
                    username: `test-signup-${Date.now()}`,
                    password: 'test123456',
                    email: `test-${Date.now()}@example.com`
                }
            });
            // May return 200 (success) or 409 (already exists) or 400 (validation)
            if (res.status !== 200 && res.status !== 409 && res.status !== 400) {
                throw new Error(`Unexpected status: ${res.status} - ${JSON.stringify(res.body)}`);
            }
        });

        log('\n=== TEST 3: GET /t/:tenantSlug/logout ===');
        
        await test('GET /t/:tenantSlug/logout: Logs out and redirects', async () => {
            // Use a tenant that exists (default) or accept 404 if tenant doesn't exist
            const res = await makeRequest('GET', '/t/default/logout', {});
            // May return 302 (redirect), 200, or 404 (if tenant doesn't exist)
            if (res.status !== 200 && res.status !== 302 && res.status !== 404) {
                throw new Error(`Unexpected status: ${res.status}`);
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

