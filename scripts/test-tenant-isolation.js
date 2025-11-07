#!/usr/bin/env node
/**
 * Tenant Isolation Test Suite
 * Tests complete isolation of tenant data after multi-tenant modifications
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

let tenant1Session = '';
let tenant2Session = '';
let tenant1CsrfToken = '';
let tenant2CsrfToken = '';
let tenant1Id = null;
let tenant2Id = null;
let tenant1Slug = 'test-tenant-1';
let tenant2Slug = 'test-tenant-2';
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
    
    // Extract session cookie from response
    const cookies = res.headers['set-cookie'] || [];
    let sessionCookie = '';
    
    cookies.forEach(cookie => {
        if (cookie.startsWith('connect.sid=')) {
            sessionCookie = cookie.split(';')[0];
        }
    });
    
    if (!sessionCookie) {
        // Try to get from headers if not in set-cookie
        const cookieHeader = res.headers['cookie'];
        if (cookieHeader) {
            sessionCookie = cookieHeader;
        } else {
            throw new Error('No session cookie received');
        }
    }
    
    // Get CSRF token after login
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

async function setupTestTenants() {
    log('Setting up test tenants...');
    
    // Get database connection
    const db = await open({
        filename: DB_PATH,
        driver: sqlite3.Database
    });
    
    // Create or get test tenants
    let tenant1 = await db.get('SELECT * FROM tenants WHERE slug = ?', tenant1Slug);
    if (!tenant1) {
        const result = await db.run('INSERT INTO tenants (slug, name) VALUES (?, ?)', tenant1Slug, 'Test Tenant 1');
        tenant1 = await db.get('SELECT * FROM tenants WHERE id = ?', result.lastID);
    }
    tenant1Id = tenant1.id;
    
    let tenant2 = await db.get('SELECT * FROM tenants WHERE slug = ?', tenant2Slug);
    if (!tenant2) {
        const result = await db.run('INSERT INTO tenants (slug, name) VALUES (?, ?)', tenant2Slug, 'Test Tenant 2');
        tenant2 = await db.get('SELECT * FROM tenants WHERE id = ?', result.lastID);
    }
    tenant2Id = tenant2.id;
    
    // Create test admin users for each tenant
    const bcrypt = require('bcrypt');
    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
    
    let user1 = await db.get('SELECT * FROM auth_users WHERE username = ? AND tenant_id = ?', `${ADMIN_USERNAME}_t1`, tenant1Id);
    if (!user1) {
        await db.run(
            'INSERT INTO auth_users (username, password_hash, user_type, tenant_id) VALUES (?, ?, ?, ?)',
            `${ADMIN_USERNAME}_t1`, passwordHash, 'admin', tenant1Id
        );
    }
    
    let user2 = await db.get('SELECT * FROM auth_users WHERE username = ? AND tenant_id = ?', `${ADMIN_USERNAME}_t2`, tenant2Id);
    if (!user2) {
        await db.run(
            'INSERT INTO auth_users (username, password_hash, user_type, tenant_id) VALUES (?, ?, ?, ?)',
            `${ADMIN_USERNAME}_t2`, passwordHash, 'admin', tenant2Id
        );
    }
    
    await db.close();
    
    log(`Tenant 1 ID: ${tenant1Id}, Slug: ${tenant1Slug}`);
    log(`Tenant 2 ID: ${tenant2Id}, Slug: ${tenant2Slug}`);
}

async function cleanupTestData() {
    log('Cleaning up test data...');
    const db = await open({
        filename: DB_PATH,
        driver: sqlite3.Database
    });
    
    // Clean up test data
    await db.run('DELETE FROM form_customization WHERE tenant_id IN (?, ?)', tenant1Id, tenant2Id);
    await db.run('DELETE FROM campaigns WHERE tenant_id IN (?, ?)', tenant1Id, tenant2Id);
    await db.run('DELETE FROM coupons WHERE tenant_id IN (?, ?)', tenant1Id, tenant2Id);
    await db.run('DELETE FROM users WHERE tenant_id IN (?, ?)', tenant1Id, tenant2Id);
    
    await db.close();
}

async function runTests() {
    log('=== Tenant Isolation Test Suite ===\n');
    log(`Testing against: ${BASE_URL}\n`);
    
    try {
        await setupTestTenants();
        
        // Login to both tenants
        log('Logging in to tenants...');
        const login1 = await login(`${ADMIN_USERNAME}_t1`, 'admin');
        tenant1Session = login1.sessionCookie;
        tenant1CsrfToken = login1.csrfToken;
        
        const login2 = await login(`${ADMIN_USERNAME}_t2`, 'admin');
        tenant2Session = login2.sessionCookie;
        tenant2CsrfToken = login2.csrfToken;
        log('Login successful\n');
        
        // ===== TEST 1: Form Customization Isolation =====
        log('=== TEST 1: Form Customization Isolation ===');
        
        await test('Tenant 1 can save form customization', async () => {
            const config1 = {
                primaryColor: '#FF0000',
                accentColor: '#00FF00',
                headerImageUrl: '/api/uploads/test-tenant-1/test-image.jpg'
            };
            
            const res = await makeRequest('POST', '/api/admin/form-customization', {
                cookie: tenant1Session,
                headers: {
                    'X-CSRF-Token': tenant1CsrfToken
                },
                body: config1
            });
            
            if (res.status !== 200) {
                throw new Error(`Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
            }
        });
        
        await test('Tenant 2 can save different form customization', async () => {
            const config2 = {
                primaryColor: '#0000FF',
                accentColor: '#FFFF00',
                headerImageUrl: '/api/uploads/test-tenant-2/test-image.jpg'
            };
            
            const res = await makeRequest('POST', '/api/admin/form-customization', {
                cookie: tenant2Session,
                headers: {
                    'X-CSRF-Token': tenant2CsrfToken
                },
                body: config2
            });
            
            if (res.status !== 200) {
                throw new Error(`Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
            }
        });
        
        await test('Tenant 1 retrieves only its own customization', async () => {
            const res = await makeRequest('GET', '/api/admin/form-customization', {
                cookie: tenant1Session
            });
            
            if (res.status !== 200) {
                throw new Error(`Expected 200, got ${res.status}`);
            }
            
            if (res.body.primaryColor !== '#FF0000') {
                throw new Error(`Expected primaryColor #FF0000, got ${res.body.primaryColor}`);
            }
        });
        
        await test('Tenant 2 retrieves only its own customization', async () => {
            const res = await makeRequest('GET', '/api/admin/form-customization', {
                cookie: tenant2Session
            });
            
            if (res.status !== 200) {
                throw new Error(`Expected 200, got ${res.status}`);
            }
            
            if (res.body.primaryColor !== '#0000FF') {
                throw new Error(`Expected primaryColor #0000FF, got ${res.body.primaryColor}`);
            }
        });
        
        await test('Tenant-scoped public endpoint returns correct customization', async () => {
            const res = await makeRequest('GET', `/t/${tenant1Slug}/api/form-customization`);
            
            if (res.status !== 200) {
                throw new Error(`Expected 200, got ${res.status}`);
            }
            
            if (res.body.primaryColor !== '#FF0000') {
                throw new Error(`Expected primaryColor #FF0000, got ${res.body.primaryColor}`);
            }
        });
        
        // ===== TEST 2: Campaign Code Uniqueness Per Tenant =====
        log('\n=== TEST 2: Campaign Code Uniqueness Per Tenant ===');
        
        let campaign1Code = null;
        let campaign2Code = null;
        
        await test('Tenant 1 can create campaign', async () => {
            const res = await makeRequest('POST', `/t/${tenant1Slug}/api/admin/campaigns`, {
                cookie: tenant1Session,
                headers: {
                    'X-CSRF-Token': tenant1CsrfToken
                },
                body: {
                    name: 'Test Campaign 1',
                    discount_type: 'percent',
                    discount_value: '10'
                }
            });
            
            if (res.status !== 200 && res.status !== 201) {
                throw new Error(`Expected 200/201, got ${res.status}: ${JSON.stringify(res.body)}`);
            }
            
            if (!res.body.campaign_code) {
                throw new Error('campaign_code not returned in response');
            }
            
            campaign1Code = res.body.campaign_code;
        });
        
        await test('Tenant 2 can create campaign', async () => {
            const res = await makeRequest('POST', `/t/${tenant2Slug}/api/admin/campaigns`, {
                cookie: tenant2Session,
                headers: {
                    'X-CSRF-Token': tenant2CsrfToken
                },
                body: {
                    name: 'Test Campaign 2',
                    discount_type: 'percent',
                    discount_value: '20'
                }
            });
            
            if (res.status !== 200 && res.status !== 201) {
                throw new Error(`Expected 200/201, got ${res.status}: ${JSON.stringify(res.body)}`);
            }
            
            if (!res.body.campaign_code) {
                throw new Error('campaign_code not returned in response');
            }
            
            campaign2Code = res.body.campaign_code;
        });
        
        await test('Tenant 1 can activate and retrieve its own campaign by code', async () => {
            if (!campaign1Code) {
                throw new Error('campaign1Code not set');
            }
            
            // First, get the campaign ID and activate it
            const db = await open({
                filename: DB_PATH,
                driver: sqlite3.Database
            });
            
            const campaign = await db.get('SELECT id FROM campaigns WHERE campaign_code = ? AND tenant_id = ?', campaign1Code, tenant1Id);
            if (!campaign) {
                await db.close();
                throw new Error('Campaign not found in database');
            }
            
            // Activate the campaign
            await db.run('UPDATE campaigns SET is_active = 1 WHERE id = ?', campaign.id);
            await db.close();
            
            // Now retrieve it
            const res = await makeRequest('GET', `/t/${tenant1Slug}/api/campaigns/${campaign1Code}`);
            
            if (res.status !== 200) {
                throw new Error(`Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
            }
            
            if (res.body.discount_value !== '10') {
                throw new Error(`Expected discount_value 10, got ${res.body.discount_value}`);
            }
        });
        
        await test('Tenant 2 can activate and retrieve its own campaign by code', async () => {
            if (!campaign2Code) {
                throw new Error('campaign2Code not set');
            }
            
            // First, get the campaign ID and activate it
            const db = await open({
                filename: DB_PATH,
                driver: sqlite3.Database
            });
            
            const campaign = await db.get('SELECT id FROM campaigns WHERE campaign_code = ? AND tenant_id = ?', campaign2Code, tenant2Id);
            if (!campaign) {
                await db.close();
                throw new Error('Campaign not found in database');
            }
            
            // Activate the campaign
            await db.run('UPDATE campaigns SET is_active = 1 WHERE id = ?', campaign.id);
            await db.close();
            
            // Now retrieve it
            const res = await makeRequest('GET', `/t/${tenant2Slug}/api/campaigns/${campaign2Code}`);
            
            if (res.status !== 200) {
                throw new Error(`Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
            }
            
            if (res.body.discount_value !== '20') {
                throw new Error(`Expected discount_value 20, got ${res.body.discount_value}`);
            }
        });
        
        // ===== TEST 3: Campaign Name Uniqueness Per Tenant =====
        log('\n=== TEST 3: Campaign Name Uniqueness Per Tenant ===');
        
        const sameCampaignName = 'Same Campaign Name';
        
        await test('Tenant 1 can create campaign with name', async () => {
            const res = await makeRequest('POST', `/t/${tenant1Slug}/api/admin/campaigns`, {
                cookie: tenant1Session,
                headers: {
                    'X-CSRF-Token': tenant1CsrfToken
                },
                body: {
                    name: sameCampaignName,
                    discount_type: 'percent',
                    discount_value: '25'
                }
            });
            
            if (res.status !== 200 && res.status !== 201) {
                throw new Error(`Expected 200/201, got ${res.status}: ${JSON.stringify(res.body)}`);
            }
        });
        
        await test('Tenant 2 can create campaign with same name (different tenant)', async () => {
            const res = await makeRequest('POST', `/t/${tenant2Slug}/api/admin/campaigns`, {
                cookie: tenant2Session,
                headers: {
                    'X-CSRF-Token': tenant2CsrfToken
                },
                body: {
                    name: sameCampaignName,
                    discount_type: 'percent',
                    discount_value: '30'
                }
            });
            
            if (res.status !== 200 && res.status !== 201) {
                throw new Error(`Expected 200/201, got ${res.status}: ${JSON.stringify(res.body)}`);
            }
        });
        
        await test('Tenant 1 cannot create duplicate campaign name within same tenant', async () => {
            const res = await makeRequest('POST', `/t/${tenant1Slug}/api/admin/campaigns`, {
                cookie: tenant1Session,
                headers: {
                    'X-CSRF-Token': tenant1CsrfToken
                },
                body: {
                    name: sameCampaignName,
                    discount_type: 'percent',
                    discount_value: '35'
                }
            });
            
            // Should fail with constraint error
            if (res.status === 200 || res.status === 201) {
                throw new Error('Expected constraint error, but campaign was created');
            }
        });
        
        // ===== TEST 4: Data Isolation =====
        log('\n=== TEST 4: Data Isolation ===');
        
        await test('Tenant 1 sees only its own campaigns', async () => {
            const res = await makeRequest('GET', '/api/admin/campaigns', {
                cookie: tenant1Session
            });
            
            if (res.status !== 200) {
                throw new Error(`Expected 200, got ${res.status}`);
            }
            
            if (!Array.isArray(res.body)) {
                throw new Error('Expected array of campaigns');
            }
            
            // All campaigns should belong to tenant 1
            const wrongTenant = res.body.find(c => c.tenant_id !== tenant1Id);
            if (wrongTenant) {
                throw new Error(`Found campaign from wrong tenant: ${JSON.stringify(wrongTenant)}`);
            }
        });
        
        await test('Tenant 2 sees only its own campaigns', async () => {
            const res = await makeRequest('GET', '/api/admin/campaigns', {
                cookie: tenant2Session
            });
            
            if (res.status !== 200) {
                throw new Error(`Expected 200, got ${res.status}`);
            }
            
            if (!Array.isArray(res.body)) {
                throw new Error('Expected array of campaigns');
            }
            
            // All campaigns should belong to tenant 2
            const wrongTenant = res.body.find(c => c.tenant_id !== tenant2Id);
            if (wrongTenant) {
                throw new Error(`Found campaign from wrong tenant: ${JSON.stringify(wrongTenant)}`);
            }
        });
        
        // ===== TEST 5: Database Schema Verification =====
        log('\n=== TEST 5: Database Schema Verification ===');
        
        await test('form_customization table has tenant_id column', async () => {
            const db = await open({
                filename: DB_PATH,
                driver: sqlite3.Database
            });
            
            const columns = await db.all("PRAGMA table_info(form_customization)");
            const columnNames = columns.map(c => c.name);
            
            if (!columnNames.includes('tenant_id')) {
                throw new Error('tenant_id column not found in form_customization table');
            }
            
            await db.close();
        });
        
        await test('Tenant-scoped unique indexes exist for campaigns', async () => {
            const db = await open({
                filename: DB_PATH,
                driver: sqlite3.Database
            });
            
            const indexes = await db.all("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='campaigns'");
            const indexNames = indexes.map(idx => idx.name);
            
            if (!indexNames.includes('idx_campaigns_code_tenant')) {
                throw new Error('idx_campaigns_code_tenant index not found');
            }
            
            if (!indexNames.includes('idx_campaigns_name_tenant')) {
                throw new Error('idx_campaigns_name_tenant index not found');
            }
            
            await db.close();
        });
        
        // ===== TEST 6: Legacy Endpoint Behavior =====
        log('\n=== TEST 6: Legacy Endpoint Behavior ===');
        
        await test('Legacy /api/campaigns/:code uses default tenant', async () => {
            // This endpoint has been deprecated and returns 410 Gone
            const res = await makeRequest('GET', '/api/campaigns/NONEXISTENT');
            
            // Should return 410 Gone (deprecated), not 404
            if (res.status !== 410) {
                throw new Error(`Expected 410 (Gone - deprecated endpoint), got ${res.status}`);
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
        
        // Cleanup
        await cleanupTestData();
        
        if (failed > 0) {
            process.exit(1);
        } else {
            log('\n✅ All tests passed!');
            process.exit(0);
        }
        
    } catch (error) {
        log(`\n❌ Fatal error: ${error.message}`);
        console.error(error);
        await cleanupTestData();
        process.exit(1);
    }
}

// Run tests
runTests();

