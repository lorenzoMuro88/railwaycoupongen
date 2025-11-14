#!/usr/bin/env node
/**
 * Test Suite for Form Links Parametrici
 * Tests the new parametric form links functionality:
 * - Generate N form links for a campaign
 * - List form links with statistics
 * - Use form link to generate coupon (single use)
 * - Verify link cannot be reused
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');
const { spawn } = require('child_process');
const path = require('path');

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';
let serverProcess = null;
const ADMIN_USERNAME = process.env.TEST_ADMIN_USER || 'mario123';
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD || 'admin123';
const SUPERADMIN_USERNAME = process.env.TEST_SUPERADMIN_USER || 'superadmin';
const SUPERADMIN_PASSWORD = process.env.TEST_SUPERADMIN_PASSWORD || 'superadmin123';

let superadminSession = '';
let superadminCsrfToken = '';
let adminSession = '';
let adminCsrfToken = '';
let tenantSlug = '';
let tenantId = null;
let testCampaignId = null;
let testCampaignCode = '';
let testFormLinks = [];
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
                let sessionCookie = options.cookie || adminSession;
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
                    resolve({ 
                        status: res.statusCode, 
                        headers: res.headers, 
                        body: json || data,
                        rawBody: data,
                        cookie: sessionCookie
                    });
                } catch (e) {
                    resolve({ 
                        status: res.statusCode, 
                        headers: res.headers, 
                        body: data,
                        rawBody: data,
                        cookie: sessionCookie
                    });
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

async function login(username, password, userType) {
    const res = await makeRequest('POST', '/api/login', {
        body: { username, password, userType }
    });
    
    if (res.status !== 200) {
        throw new Error(`Login failed: ${res.status} - ${JSON.stringify(res.body)}`);
    }
    
    return res.cookie || '';
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

async function setupTestTenant() {
    log('Setting up test tenant...');
    
    const timestamp = Date.now();
    const tenantName = `Test Tenant Form Links ${timestamp}`;
    tenantSlug = `test-form-links-${timestamp}`;
    const tenantAdminUsername = `admin-${timestamp}`;
    
    const createTenantRes = await makeRequest('POST', '/api/superadmin/tenants', {
        cookie: superadminSession,
        headers: {
            'X-CSRF-Token': superadminCsrfToken
        },
        body: {
            tenantName: tenantName,
            tenantSlug: tenantSlug,  // Use tenantSlug instead of slug
            adminUsername: tenantAdminUsername,
            adminPassword: 'admin123'
        }
    });
    
    if (createTenantRes.status !== 200 && createTenantRes.status !== 201) {
        throw new Error(`Failed to create tenant: ${createTenantRes.status} - ${JSON.stringify(createTenantRes.body)}`);
    }
    
    // Get actual tenant slug from response (server may modify it via toSlug)
    const actualTenant = createTenantRes.body.tenant || createTenantRes.body;
    tenantId = actualTenant.id || createTenantRes.body.id || createTenantRes.body.tenantId;
    
    // ALWAYS use the slug from server response (it's the authoritative one)
    if (actualTenant.slug) {
        if (actualTenant.slug !== tenantSlug) {
            log(`Note: Server returned different slug: ${actualTenant.slug} (requested: ${tenantSlug})`);
        }
        tenantSlug = actualTenant.slug;
    } else {
        throw new Error(`Tenant slug not found in response: ${JSON.stringify(createTenantRes.body)}`);
    }
    
    if (!tenantId) {
        throw new Error(`Tenant ID not found in response: ${JSON.stringify(createTenantRes.body)}`);
    }
    
    log(`Tenant created: ID=${tenantId}, Slug=${tenantSlug}`);
    log(`Tenant admin username: ${tenantAdminUsername}`);
    log(`Response body: ${JSON.stringify(createTenantRes.body)}`);
    
    // Wait a bit for tenant to be fully created and verify it's accessible
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Verify tenant is accessible via tenant-scoped endpoint
    const verifyRes = await makeRequest('GET', `/t/${tenantSlug}/api/tenant-info`, {
        cookie: superadminSession
    });
    if (verifyRes.status !== 200) {
        log(`Warning: Tenant verification failed with status ${verifyRes.status}, but continuing...`);
    } else {
        log(`Tenant verified accessible via /t/${tenantSlug}/api/tenant-info`);
    }
    
    // Login as tenant admin
    adminSession = await login(tenantAdminUsername, 'admin123', 'admin');
    if (!adminSession) {
        throw new Error('Failed to login as tenant admin');
    }
    adminCsrfToken = await getCsrfToken(adminSession);
    
    log(`Logged in as tenant admin: ${tenantAdminUsername}`);
}

async function setupTestCampaign() {
    log('Setting up test campaign...');
    log(`Using tenant slug: ${tenantSlug}`);
    log(`Admin session cookie: ${adminSession.substring(0, 50)}...`);
    
    // Verify tenant is accessible first
    const tenantCheckRes = await makeRequest('GET', `/t/${tenantSlug}/api/tenant-info`, {
        cookie: adminSession
    });
    if (tenantCheckRes.status !== 200) {
        log(`Warning: Tenant check failed with status ${tenantCheckRes.status}`);
        log(`Response: ${JSON.stringify(tenantCheckRes.body)}`);
    } else {
        log(`Tenant verified: ${JSON.stringify(tenantCheckRes.body)}`);
    }
    
    const csrfToken = await getCsrfToken(adminSession);
    const campaignName = `Test Campaign Form Links ${Date.now()}`;
    
    log(`Creating campaign with name: ${campaignName}`);
    log(`CSRF Token: ${csrfToken.substring(0, 20)}...`);
    
    const res = await makeRequest('POST', `/t/${tenantSlug}/api/admin/campaigns`, {
        cookie: adminSession,
        headers: {
            'X-CSRF-Token': csrfToken
        },
        body: {
            name: campaignName,
            description: 'Test campaign for form links',
            discount_type: 'percent',
            discount_value: '20'
        }
    });
    
    log(`Campaign creation response: ${res.status}`);
    log(`Response body: ${JSON.stringify(res.body)}`);
    
    if (res.status !== 200 && res.status !== 201) {
        throw new Error(`Failed to create campaign: ${res.status} - ${JSON.stringify(res.body)}`);
    }
    
    testCampaignId = res.body.id;
    testCampaignCode = res.body.campaign_code;
    
    if (!testCampaignId) {
        throw new Error(`Campaign ID not found in response: ${JSON.stringify(res.body)}`);
    }
    
    // Activate campaign
    const activateRes = await makeRequest('PUT', `/t/${tenantSlug}/api/admin/campaigns/${testCampaignId}/activate`, {
        cookie: adminSession,
        headers: {
            'X-CSRF-Token': csrfToken
        }
    });
    
    if (activateRes.status !== 200) {
        log(`  ⚠ Campaign activation returned ${activateRes.status}, continuing anyway`);
    } else {
        log(`Campaign activated successfully`);
    }
    
    log(`Test campaign created: ID=${testCampaignId}, Code=${testCampaignCode}`);
}

async function startServer() {
    return new Promise((resolve, reject) => {
        log('Starting server with DISABLE_RATE_LIMIT=true...');
        const serverPath = path.join(__dirname, '..', 'server.js');
        serverProcess = spawn('node', [serverPath], {
            env: { ...process.env, DISABLE_RATE_LIMIT: 'true', PORT: '3000' },
            stdio: ['ignore', 'pipe', 'pipe']
        });
        
        let serverReady = false;
        const timeout = setTimeout(() => {
            if (!serverReady) {
                reject(new Error('Server failed to start within 10 seconds'));
            }
        }, 10000);
        
        serverProcess.stdout.on('data', (data) => {
            const output = data.toString();
            if (output.includes('server started') || output.includes('CouponGen server started')) {
                serverReady = true;
                clearTimeout(timeout);
                log('Server started successfully');
                // Wait a bit more for server to be fully ready
                setTimeout(resolve, 1000);
            }
        });
        
        serverProcess.stderr.on('data', (data) => {
            const output = data.toString();
            // Ignore some common warnings
            if (!output.includes('DeprecationWarning') && !output.includes('ExperimentalWarning')) {
                console.error(`[SERVER] ${output}`);
            }
        });
        
        serverProcess.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
        });
        
        // Fallback: if we don't see the ready message, wait a bit and assume it's ready
        setTimeout(() => {
            if (!serverReady) {
                log('Server assumed ready (no ready message detected)');
                serverReady = true;
                clearTimeout(timeout);
                resolve();
            }
        }, 3000);
    });
}

async function stopServer() {
    if (serverProcess) {
        log('Stopping server...');
        return new Promise((resolve) => {
            serverProcess.on('close', () => {
                log('Server stopped');
                resolve();
            });
            serverProcess.kill('SIGTERM');
            // Force kill after 5 seconds
            setTimeout(() => {
                if (!serverProcess.killed) {
                    serverProcess.kill('SIGKILL');
                    resolve();
                }
            }, 5000);
        });
    }
}

async function waitForServer(url, maxAttempts = 30) {
    for (let i = 0; i < maxAttempts; i++) {
        try {
            await new Promise((resolve, reject) => {
                const urlObj = new URL(url);
                const client = urlObj.protocol === 'https:' ? https : http;
                const req = client.get(`${url}/healthz`, (res) => {
                    if (res.statusCode === 200) {
                        resolve();
                    } else {
                        reject(new Error(`Server returned ${res.statusCode}`));
                    }
                });
                req.on('error', reject);
                req.setTimeout(1000, () => {
                    req.destroy();
                    reject(new Error('Request timeout'));
                });
            });
            return true;
        } catch (e) {
            if (i < maxAttempts - 1) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
    }
    return false;
}

async function runTests() {
    log('=== Test Form Links Parametrici ===\n');
    
    // Check if server is already running
    const serverRunning = await waitForServer(BASE_URL, 3);
    
    if (!serverRunning) {
        log('Server not running, starting it...');
        try {
            await startServer();
            await waitForServer(BASE_URL, 30);
        } catch (error) {
            log(`Failed to start server: ${error.message}`);
            log('Assuming server is already running and continuing...');
        }
    } else {
        log(`Server already running at ${BASE_URL}`);
        log('WARNING: Server is already running. If rate limiting is enabled, tests may fail.');
        log('To avoid rate limiting, restart the server with: DISABLE_RATE_LIMIT=true node server.js');
    }
    
    log(`Testing against: ${BASE_URL}\n`);
    
    try {
        // Setup: Login as superadmin
        await test('Setup: Login as superadmin', async () => {
            superadminSession = await login(SUPERADMIN_USERNAME, SUPERADMIN_PASSWORD, 'superadmin');
            superadminCsrfToken = await getCsrfToken(superadminSession);
            if (!superadminSession) throw new Error('Failed to get superadmin session');
        });
        
        // Setup: Create test tenant
        await test('Setup: Create test tenant', async () => {
            await setupTestTenant();
        });
        
        // Setup test campaign
        await test('Setup: Create test campaign', async () => {
            await setupTestCampaign();
        });
        
        log('\n=== TEST 1: Generate Form Links ===');
        
        await test('POST /t/:tenantSlug/api/admin/campaigns/:id/form-links generates links', async () => {
            const csrfToken = await getCsrfToken(adminSession);
            
            // Debug: verify session and tenant
            log(`Making request to: /t/${tenantSlug}/api/admin/campaigns/${testCampaignId}/form-links`);
            log(`Campaign ID: ${testCampaignId}, Tenant Slug: ${tenantSlug}`);
            
            const res = await makeRequest('POST', `/t/${tenantSlug}/api/admin/campaigns/${testCampaignId}/form-links`, {
                cookie: adminSession,
                headers: {
                    'X-CSRF-Token': csrfToken
                },
                body: { count: 5 }
            });
            
            log(`Response status: ${res.status}`);
            if (res.status !== 200) {
                log(`Response body: ${typeof res.body === 'string' ? res.body.substring(0, 200) : JSON.stringify(res.body)}`);
            }
            
            if (res.status !== 200) {
                throw new Error(`Expected 200, got ${res.status}: ${typeof res.body === 'string' ? res.body.substring(0, 200) : JSON.stringify(res.body)}`);
            }
            
            if (!res.body.links || !Array.isArray(res.body.links)) {
                throw new Error('Response should contain links array');
            }
            
            if (res.body.links.length !== 5) {
                throw new Error(`Expected 5 links, got ${res.body.links.length}`);
            }
            
            // Verify all links have required fields
            res.body.links.forEach((link, index) => {
                if (!link.token) {
                    throw new Error(`Link ${index} missing token`);
                }
                if (!link.id) {
                    throw new Error(`Link ${index} missing id`);
                }
                if (link.used_at !== null) {
                    throw new Error(`Link ${index} should not be used yet`);
                }
            });
            
            testFormLinks = res.body.links;
            log(`  Generated ${testFormLinks.length} form links`);
        });
        
        await test('POST /t/:tenantSlug/api/admin/campaigns/:id/form-links validates count', async () => {
            const csrfToken = await getCsrfToken(adminSession);
            
            // Test invalid count (0)
            const res1 = await makeRequest('POST', `/t/${tenantSlug}/api/admin/campaigns/${testCampaignId}/form-links`, {
                cookie: adminSession,
                headers: {
                    'X-CSRF-Token': csrfToken
                },
                body: { count: 0 }
            });
            
            if (res1.status !== 400) {
                throw new Error(`Expected 400 for count=0, got ${res1.status}`);
            }
            
            // Test invalid count (over limit)
            const res2 = await makeRequest('POST', `/t/${tenantSlug}/api/admin/campaigns/${testCampaignId}/form-links`, {
                cookie: adminSession,
                headers: {
                    'X-CSRF-Token': csrfToken
                },
                body: { count: 1001 }
            });
            
            if (res2.status !== 400) {
                throw new Error(`Expected 400 for count=1001, got ${res2.status}`);
            }
        });
        
        await test('POST /t/:tenantSlug/api/admin/campaigns/:id/form-links requires valid campaign', async () => {
            const csrfToken = await getCsrfToken(adminSession);
            const res = await makeRequest('POST', `/t/${tenantSlug}/api/admin/campaigns/99999/form-links`, {
                cookie: adminSession,
                headers: {
                    'X-CSRF-Token': csrfToken
                },
                body: { count: 5 }
            });
            
            if (res.status !== 404) {
                throw new Error(`Expected 404 for invalid campaign, got ${res.status}`);
            }
        });
        
        log('\n=== TEST 2: List Form Links ===');
        
        await test('GET /t/:tenantSlug/api/admin/campaigns/:id/form-links returns links', async () => {
            const res = await makeRequest('GET', `/t/${tenantSlug}/api/admin/campaigns/${testCampaignId}/form-links`, {
                cookie: adminSession
            });
            
            if (res.status !== 200) {
                throw new Error(`Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
            }
            
            if (!res.body.links || !Array.isArray(res.body.links)) {
                throw new Error('Response should contain links array');
            }
            
            if (!res.body.statistics) {
                throw new Error('Response should contain statistics');
            }
            
            if (res.body.statistics.total !== 5) {
                throw new Error(`Expected 5 total links, got ${res.body.statistics.total}`);
            }
            
            if (res.body.statistics.used !== 0) {
                throw new Error(`Expected 0 used links, got ${res.body.statistics.used}`);
            }
            
            if (res.body.statistics.available !== 5) {
                throw new Error(`Expected 5 available links, got ${res.body.statistics.available}`);
            }
        });
        
        log('\n=== TEST 3: Get Campaign via Form Token ===');
        
        await test('GET /t/:tenantSlug/api/campaigns/:code?form=TOKEN returns campaign for unused link', async () => {
            const formToken = testFormLinks[0].token;
            const res = await makeRequest('GET', `/t/${tenantSlug}/api/campaigns/DUMMY?form=${formToken}`, {
                cookie: adminSession
            });
            
            if (res.status !== 200) {
                throw new Error(`Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
            }
            
            if (res.body.campaign_code !== testCampaignCode) {
                throw new Error(`Expected campaign_code ${testCampaignCode}, got ${res.body.campaign_code}`);
            }
            
            if (!res.body._form_token) {
                throw new Error('Response should contain _form_token');
            }
            
            if (res.body._form_token !== formToken) {
                throw new Error(`Expected _form_token ${formToken}, got ${res.body._form_token}`);
            }
        });
        
        log('\n=== TEST 4: Form Submission with Form Token ===');
        
        await test('POST /t/:tenantSlug/submit with form_token marks link as used', async () => {
            // Use link at index 1
            const formToken = testFormLinks[1].token;
            const testEmail = `test${Date.now()}@example.com`;
            
            // Submit form with this token
            const submitRes = await makeRequest('POST', `/t/${tenantSlug}/submit`, {
                body: {
                    email: testEmail,
                    firstName: 'Test',
                    lastName: 'User',
                    form_token: formToken
                }
            });
            
            // Verify submit was successful
            if (submitRes.status !== 302 && submitRes.status !== 200) {
                throw new Error(`Expected 302 or 200, got ${submitRes.status}: ${submitRes.rawBody || JSON.stringify(submitRes.body)}`);
            }
            
            // Wait for database to sync (WAL mode)
            await new Promise(resolve => setTimeout(resolve, 300));
            
            // Verify link is marked as used
            const linksRes = await makeRequest('GET', `/t/${tenantSlug}/api/admin/campaigns/${testCampaignId}/form-links`, {
                cookie: adminSession
            });
            
            const usedLink = linksRes.body.links.find(l => l.token === formToken);
            if (!usedLink) {
                throw new Error('Link not found in list');
            }
            
            if (!usedLink.used_at) {
                throw new Error(`Link should be marked as used, but used_at is ${usedLink.used_at}`);
            }
        });
        
        await test('GET /t/:tenantSlug/api/campaigns/:code?form=TOKEN rejects used link', async () => {
            // Use the same link from previous test (index 1, now used)
            const formToken = testFormLinks[1].token;
            
            // Wait a bit to ensure database is synced
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Try to get campaign with used link
            const res = await makeRequest('GET', `/t/${tenantSlug}/api/campaigns/DUMMY?form=${formToken}`, {
                cookie: adminSession
            });
            
            if (res.status !== 400) {
                throw new Error(`Expected 400 for used link, got ${res.status}: ${JSON.stringify(res.body)}`);
            }
            
            if (!res.body.error || !res.body.error.includes('utilizzato')) {
                throw new Error(`Expected "Link già utilizzato" error, got: ${JSON.stringify(res.body)}`);
            }
        });
        
        await test('POST /t/:tenantSlug/submit with form_token cannot reuse link', async () => {
            // Try to reuse the same link from previous test (index 1, already used)
            const formToken = testFormLinks[1].token;
            const testEmail = `test${Date.now()}@example.com`;
            
            const res = await makeRequest('POST', `/t/${tenantSlug}/submit`, {
                body: {
                    email: testEmail,
                    firstName: 'Test',
                    lastName: 'User',
                    form_token: formToken
                }
            });
            
            // Should fail with 400
            if (res.status !== 400) {
                throw new Error(`Expected 400 for reused link, got ${res.status}`);
            }
            
            if (!res.rawBody.includes('utilizzato') && !res.rawBody.includes('non valido')) {
                throw new Error(`Expected "Link già utilizzato" or "non valido" error, got: ${res.rawBody}`);
            }
        });
        
        await test('POST /t/:tenantSlug/submit with form_token validates link exists', async () => {
            const invalidToken = 'INVALIDTOKEN123456';
            const testEmail = `test${Date.now()}@example.com`;
            
            const res = await makeRequest('POST', `/t/${tenantSlug}/submit`, {
                body: {
                    email: testEmail,
                    firstName: 'Test',
                    lastName: 'User',
                    form_token: invalidToken
                }
            });
            
            if (res.status !== 400) {
                throw new Error(`Expected 400 for invalid token, got ${res.status}`);
            }
        });
        
        log('\n=== TEST 5: Statistics Update ===');
        
        await test('GET /t/:tenantSlug/api/admin/campaigns/:id/form-links shows updated statistics', async () => {
            // Wait a bit to ensure all changes are synced
            await new Promise(resolve => setTimeout(resolve, 200));
            
            const res = await makeRequest('GET', `/t/${tenantSlug}/api/admin/campaigns/${testCampaignId}/form-links`, {
                cookie: adminSession
            });
            
            if (res.status !== 200) {
                throw new Error(`Expected 200, got ${res.status}`);
            }
            
            // Should have at least 1 used link (from test 4)
            if (res.body.statistics.used < 1) {
                throw new Error(`Expected at least 1 used link, got ${res.body.statistics.used}`);
            }
            
            if (res.body.statistics.available !== res.body.statistics.total - res.body.statistics.used) {
                throw new Error(`Available (${res.body.statistics.available}) should equal total (${res.body.statistics.total}) - used (${res.body.statistics.used})`);
            }
        });
        
        log('\n=== TEST 6: Legacy Campaign Link Still Works ===');
        
        await test('GET /t/:tenantSlug/api/campaigns/:code without form parameter works', async () => {
            const res = await makeRequest('GET', `/t/${tenantSlug}/api/campaigns/${testCampaignCode}`, {
                cookie: adminSession
            });
            
            if (res.status !== 200) {
                throw new Error(`Expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
            }
            
            if (res.body.campaign_code !== testCampaignCode) {
                throw new Error(`Expected campaign_code ${testCampaignCode}, got ${res.body.campaign_code}`);
            }
            
            // Should not have _form_token
            if (res.body._form_token) {
                throw new Error('Legacy link should not have _form_token');
            }
        });
        
        log('\n=== Test Summary ===');
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
        } else {
            log('✅ All tests passed! Form links functionality works correctly.');
            log('');
        }
        
        // Stop server if we started it
        await stopServer();
        
        process.exit(failed > 0 ? 1 : 0);
        
    } catch (error) {
        log(`Fatal error: ${error.message}`);
        console.error(error);
        await stopServer();
        process.exit(1);
    }
}

// Run tests
runTests().catch(async (error) => {
    log(`Fatal error: ${error.message}`);
    console.error(error);
    await stopServer();
    process.exit(1);
});

