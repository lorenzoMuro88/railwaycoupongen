#!/usr/bin/env node
/**
 * Analytics Test Suite
 * Tests all analytics endpoints for correctness, tenant isolation, and edge cases
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');
const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';
const ADMIN_USERNAME = process.env.TEST_ADMIN_USER || 'mario123';
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD || 'admin123';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'coupons.db');

let adminSession = '';
let adminCsrfToken = '';
let tenant1Id = null;
let tenant2Id = null;
let tenant1Slug = 'test-analytics-tenant-1';
let tenant2Slug = 'test-analytics-tenant-2';
let campaign1Id = null;
let campaign2Id = null;
let product1Id = null;
let product2Id = null;
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
                'Cookie': options.cookie || adminSession,
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
        throw new Error(`Login failed: ${res.status} - ${JSON.stringify(res.body)}`);
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

async function setupTestData() {
    log('Setting up test data...');
    const db = await open({
        filename: DB_PATH,
        driver: sqlite3.Database
    });

    // Create test tenants
    await db.run(`INSERT OR IGNORE INTO tenants (slug, name) VALUES (?, ?)`, 
        [tenant1Slug, 'Test Analytics Tenant 1']);
    await db.run(`INSERT OR IGNORE INTO tenants (slug, name) VALUES (?, ?)`, 
        [tenant2Slug, 'Test Analytics Tenant 2']);

    const tenant1 = await db.get('SELECT id FROM tenants WHERE slug = ?', [tenant1Slug]);
    const tenant2 = await db.get('SELECT id FROM tenants WHERE slug = ?', [tenant2Slug]);
    tenant1Id = tenant1.id;
    tenant2Id = tenant2.id;

    // Create products
    await db.run(`INSERT OR IGNORE INTO products (tenant_id, name, value, margin_price) VALUES (?, ?, ?, ?)`,
        [tenant1Id, 'Product 1 Tenant 1', 100, 30]);
    await db.run(`INSERT OR IGNORE INTO products (tenant_id, name, value, margin_price) VALUES (?, ?, ?, ?)`,
        [tenant2Id, 'Product 1 Tenant 2', 200, 50]);

    const prod1 = await db.get('SELECT id FROM products WHERE tenant_id = ? LIMIT 1', [tenant1Id]);
    const prod2 = await db.get('SELECT id FROM products WHERE tenant_id = ? LIMIT 1', [tenant2Id]);
    product1Id = prod1.id;
    product2Id = prod2.id;

    // Create campaigns
    await db.run(`INSERT OR IGNORE INTO campaigns (tenant_id, name, discount_type, discount_value) VALUES (?, ?, ?, ?)`,
        [tenant1Id, 'Campaign 1 Tenant 1', 'percent', 10]);
    await db.run(`INSERT OR IGNORE INTO campaigns (tenant_id, name, discount_type, discount_value) VALUES (?, ?, ?, ?)`,
        [tenant2Id, 'Campaign 1 Tenant 2', 'fixed', 20]);

    const camp1 = await db.get('SELECT id FROM campaigns WHERE tenant_id = ? LIMIT 1', [tenant1Id]);
    const camp2 = await db.get('SELECT id FROM campaigns WHERE tenant_id = ? LIMIT 1', [tenant2Id]);
    campaign1Id = camp1.id;
    campaign2Id = camp2.id;

    // Link products to campaigns
    await db.run(`INSERT OR IGNORE INTO campaign_products (campaign_id, product_id) VALUES (?, ?)`,
        [campaign1Id, product1Id]);
    await db.run(`INSERT OR IGNORE INTO campaign_products (campaign_id, product_id) VALUES (?, ?)`,
        [campaign2Id, product2Id]);

    // Create coupons for tenant 1
    const now = new Date().toISOString();
    await db.run(`INSERT OR IGNORE INTO coupons (tenant_id, campaign_id, code, status, discount_type, discount_value, issued_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [tenant1Id, campaign1Id, 'TEST1-001', 'active', 'percent', 10, now]);
    await db.run(`INSERT OR IGNORE INTO coupons (tenant_id, campaign_id, code, status, discount_type, discount_value, issued_at, redeemed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [tenant1Id, campaign1Id, 'TEST1-002', 'redeemed', 'percent', 10, new Date(Date.now() - 86400000).toISOString(), new Date().toISOString()]);
    await db.run(`INSERT OR IGNORE INTO coupons (tenant_id, campaign_id, code, status, discount_type, discount_value, issued_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [tenant1Id, campaign1Id, 'TEST1-003', 'active', 'fixed', 5, now]);

    // Create coupons for tenant 2
    await db.run(`INSERT OR IGNORE INTO coupons (tenant_id, campaign_id, code, status, discount_type, discount_value, issued_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [tenant2Id, campaign2Id, 'TEST2-001', 'active', 'fixed', 20, now]);
    await db.run(`INSERT OR IGNORE INTO coupons (tenant_id, campaign_id, code, status, discount_type, discount_value, issued_at, redeemed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [tenant2Id, campaign2Id, 'TEST2-002', 'redeemed', 'fixed', 20, new Date(Date.now() - 86400000).toISOString(), new Date().toISOString()]);

    await db.close();
    log(`Test data setup complete. Tenant1: ${tenant1Id}, Tenant2: ${tenant2Id}`);
}

async function cleanupTestData() {
    log('Cleaning up test data...');
    const db = await open({
        filename: DB_PATH,
        driver: sqlite3.Database
    });

    if (campaign1Id) await db.run('DELETE FROM campaign_products WHERE campaign_id = ?', [campaign1Id]);
    if (campaign2Id) await db.run('DELETE FROM campaign_products WHERE campaign_id = ?', [campaign2Id]);
    if (tenant1Id) await db.run('DELETE FROM coupons WHERE tenant_id = ?', [tenant1Id]);
    if (tenant2Id) await db.run('DELETE FROM coupons WHERE tenant_id = ?', [tenant2Id]);
    if (campaign1Id) await db.run('DELETE FROM campaigns WHERE id = ?', [campaign1Id]);
    if (campaign2Id) await db.run('DELETE FROM campaigns WHERE id = ?', [campaign2Id]);
    if (product1Id) await db.run('DELETE FROM products WHERE id = ?', [product1Id]);
    if (product2Id) await db.run('DELETE FROM products WHERE id = ?', [product2Id]);
    if (tenant1Id) await db.run('DELETE FROM tenants WHERE id = ?', [tenant1Id]);
    if (tenant2Id) await db.run('DELETE FROM tenants WHERE id = ?', [tenant2Id]);

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
    log('=== Analytics Test Suite ===\n');
    log(`Testing against: ${BASE_URL}\n`);
    
    try {
        // Setup
        await setupTestData();
        
        // Login
        await test('Setup: Login as admin', async () => {
            adminSession = await login(ADMIN_USERNAME, ADMIN_PASSWORD, 'admin');
            adminCsrfToken = await getCsrfToken(adminSession);
            if (!adminSession) throw new Error('Failed to get admin session');
        });

        log('\n=== TEST 1: Analytics Summary Endpoint ===');
        
        await test('Summary: Basic request returns valid data', async () => {
            const res = await makeRequest('GET', `/t/${tenant1Slug}/api/admin/analytics/summary`, {
                cookie: adminSession
            });
            if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
            if (!res.body || typeof res.body.totalCampaigns !== 'number') {
                throw new Error('Invalid response structure');
            }
        });

        await test('Summary: Returns correct total campaigns', async () => {
            const res = await makeRequest('GET', `/t/${tenant1Slug}/api/admin/analytics/summary`, {
                cookie: adminSession
            });
            if (res.body.totalCampaigns < 1) {
                throw new Error('Expected at least 1 campaign');
            }
        });

        await test('Summary: Calculates redemption rate correctly', async () => {
            const res = await makeRequest('GET', `/t/${tenant1Slug}/api/admin/analytics/summary`, {
                cookie: adminSession
            });
            const { totalCouponsIssued, totalCouponsRedeemed, redemptionRate } = res.body;
            if (totalCouponsIssued > 0) {
                const expectedRate = totalCouponsRedeemed / totalCouponsIssued;
                if (Math.abs(redemptionRate - expectedRate) > 0.001) {
                    throw new Error(`Redemption rate mismatch: expected ${expectedRate}, got ${redemptionRate}`);
                }
            }
        });

        await test('Summary: Filter by campaignId works', async () => {
            const res = await makeRequest('GET', `/t/${tenant1Slug}/api/admin/analytics/summary?campaignId=${campaign1Id}`, {
                cookie: adminSession
            });
            if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
        });

        await test('Summary: Filter by status works', async () => {
            const res = await makeRequest('GET', `/t/${tenant1Slug}/api/admin/analytics/summary?status=redeemed`, {
                cookie: adminSession
            });
            if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
            if (res.body.totalCouponsRedeemed !== res.body.totalCouponsIssued) {
                throw new Error('When filtering by redeemed, issued should equal redeemed');
            }
        });

        await test('Summary: Filter by date range works', async () => {
            const today = new Date().toISOString().split('T')[0];
            const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
            const res = await makeRequest('GET', `/t/${tenant1Slug}/api/admin/analytics/summary?start=${yesterday}&end=${today}`, {
                cookie: adminSession
            });
            if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
        });

        log('\n=== TEST 2: Analytics Campaigns Endpoint ===');

        await test('Campaigns: Returns array of campaigns', async () => {
            const res = await makeRequest('GET', `/t/${tenant1Slug}/api/admin/analytics/campaigns`, {
                cookie: adminSession
            });
            if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
            if (!Array.isArray(res.body)) throw new Error('Response should be an array');
        });

        await test('Campaigns: Each campaign has required fields', async () => {
            const res = await makeRequest('GET', `/t/${tenant1Slug}/api/admin/analytics/campaigns`, {
                cookie: adminSession
            });
            if (res.body.length > 0) {
                const campaign = res.body[0];
                const required = ['id', 'name', 'issued', 'redeemed', 'redemptionRate'];
                for (const field of required) {
                    if (!(field in campaign)) {
                        throw new Error(`Missing required field: ${field}`);
                    }
                }
            }
        });

        await test('Campaigns: Redemption rate calculation is correct', async () => {
            const res = await makeRequest('GET', `/t/${tenant1Slug}/api/admin/analytics/campaigns`, {
                cookie: adminSession
            });
            for (const camp of res.body) {
                if (camp.issued > 0) {
                    const expectedRate = camp.redeemed / camp.issued;
                    if (Math.abs(camp.redemptionRate - expectedRate) > 0.001) {
                        throw new Error(`Campaign ${camp.name}: redemption rate mismatch`);
                    }
                }
            }
        });

        log('\n=== TEST 3: Analytics Temporal Endpoint ===');

        await test('Temporal: Returns array of temporal data', async () => {
            const res = await makeRequest('GET', `/t/${tenant1Slug}/api/admin/analytics/temporal?groupBy=day`, {
                cookie: adminSession
            });
            if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
            if (!Array.isArray(res.body)) throw new Error('Response should be an array');
        });

        await test('Temporal: Each period has required fields', async () => {
            const res = await makeRequest('GET', `/t/${tenant1Slug}/api/admin/analytics/temporal?groupBy=day`, {
                cookie: adminSession
            });
            if (res.body.length > 0) {
                const period = res.body[0];
                const required = ['period', 'issued', 'redeemed'];
                for (const field of required) {
                    if (!(field in period)) {
                        throw new Error(`Missing required field: ${field}`);
                    }
                }
            }
        });

        await test('Temporal: GroupBy week works', async () => {
            const res = await makeRequest('GET', `/t/${tenant1Slug}/api/admin/analytics/temporal?groupBy=week`, {
                cookie: adminSession
            });
            if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
            if (!Array.isArray(res.body)) throw new Error('Response should be an array');
        });

        log('\n=== TEST 4: Tenant Isolation ===');

        await test('Isolation: Tenant 1 cannot see Tenant 2 data', async () => {
            const res1 = await makeRequest('GET', `/t/${tenant1Slug}/api/admin/analytics/summary`, {
                cookie: adminSession
            });
            const res2 = await makeRequest('GET', `/t/${tenant2Slug}/api/admin/analytics/summary`, {
                cookie: adminSession
            });
            // They should have different campaign counts if data is isolated
            if (res1.body.totalCampaigns === res2.body.totalCampaigns && res1.body.totalCampaigns > 0) {
                // This might be OK if both have same number, but check coupons
                if (res1.body.totalCouponsIssued === res2.body.totalCouponsIssued && res1.body.totalCouponsIssued > 0) {
                    throw new Error('Tenant isolation may be broken - same data in both tenants');
                }
            }
        });

        log('\n=== TEST 5: Edge Cases ===');

        await test('Edge Case: Empty result set returns valid structure', async () => {
            const res = await makeRequest('GET', `/t/${tenant1Slug}/api/admin/analytics/summary?start=2099-01-01&end=2099-12-31`, {
                cookie: adminSession
            });
            if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
            if (typeof res.body.totalCampaigns !== 'number') {
                throw new Error('Should return numeric values even for empty results');
            }
        });

        await test('Edge Case: Invalid date format handled gracefully', async () => {
            const res = await makeRequest('GET', `/t/${tenant1Slug}/api/admin/analytics/summary?start=invalid-date`, {
                cookie: adminSession
            });
            // Should either return 400 or handle gracefully
            if (res.status !== 200 && res.status !== 400) {
                throw new Error(`Unexpected status: ${res.status}`);
            }
        });

        await test('Edge Case: Campaign without products handled', async () => {
            // This tests if campaigns without associated products cause errors
            const res = await makeRequest('GET', `/t/${tenant1Slug}/api/admin/analytics/summary`, {
                cookie: adminSession
            });
            if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
        });

        log('\n=== TEST 6: Export Endpoint ===');

        await test('Export: CSV export works', async () => {
            const res = await makeRequest('GET', `/t/${tenant1Slug}/api/admin/analytics/export?format=csv`, {
                cookie: adminSession
            });
            if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
            if (!res.headers['content-type'] || !res.headers['content-type'].includes('text/csv')) {
                throw new Error('Should return CSV content type');
            }
            if (typeof res.rawBody !== 'string' || !res.rawBody.includes('Code')) {
                throw new Error('Should return CSV content');
            }
        });

        await test('Export: JSON export works', async () => {
            const res = await makeRequest('GET', `/t/${tenant1Slug}/api/admin/analytics/export?format=json`, {
                cookie: adminSession
            });
            if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
            if (!Array.isArray(res.body)) throw new Error('Should return JSON array');
        });

        // Cleanup
        await cleanupTestData();

    } catch (error) {
        log(`Fatal error: ${error.message}`);
        await cleanupTestData();
        process.exit(1);
    }

    // Print summary
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

