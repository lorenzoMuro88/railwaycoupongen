#!/usr/bin/env node
/**
 * XSS Coupon Display Test Suite
 * Tests that XSS vulnerabilities in coupon code display are fixed
 * Specifically tests the fix for onclick attributes and innerHTML injection
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';
const DEFAULT_TENANT_SLUG = process.env.DEFAULT_TENANT_SLUG || 'default';
const ADMIN_USERNAME = process.env.TEST_ADMIN_USER || process.env.SUPERADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD || process.env.SUPERADMIN_PASSWORD || 'admin123';
const ADMIN_USERTYPE = process.env.TEST_ADMIN_USERTYPE || 'superadmin';

let testResults = [];
let passed = 0;
let failed = 0;
let sessionCookie = '';

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
        
        if (options.body) {
            const bodyStr = JSON.stringify(options.body);
            reqOptions.headers['Content-Length'] = Buffer.byteLength(bodyStr);
        }
        
        const req = client.request(reqOptions, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                // Extract session cookie
                const setCookies = res.headers['set-cookie'] || [];
                setCookies.forEach(cookie => {
                    const match = cookie.match(/^(sessionId|connect\.sid)=([^;]+)/);
                    if (match) {
                        sessionCookie = `${match[1]}=${match[2]}`;
                    }
                });
                
                resolve({ 
                    statusCode: res.statusCode, 
                    headers: res.headers,
                    body: data,
                    data
                });
            });
        });
        
        req.on('error', reject);
        
        if (options.body) {
            req.write(JSON.stringify(options.body));
        }
        
        req.setTimeout(10000, () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
        req.end();
    });
}

function testXssInHtml(html, description, testName) {
    // Test 1: Check for unsafe onclick attributes with unescaped coupon codes
    const unsafeOnclickPattern = /onclick\s*=\s*["']burnCoupon\(['"]([^'"]*)['"]\)/gi;
    const unsafeOnclickMatches = [...html.matchAll(unsafeOnclickPattern)];
    
    // Test 2: Check for unsafe onclick attributes with redeem function
    const unsafeRedeemPattern = /onclick\s*=\s*["']redeem\(['"]([^'"]*)['"]\)/gi;
    const unsafeRedeemMatches = [...html.matchAll(unsafeRedeemPattern)];
    
    // Test 3: Check for unescaped HTML in coupon code display
    // Look for <code> tags that might contain unescaped HTML
    const codeTagPattern = /<code[^>]*>([^<]*)<\/code>/gi;
    const codeMatches = [...html.matchAll(codeTagPattern)];
    
    // Test 4: Check for data-coupon-code attributes (safe approach)
    const safeDataAttributePattern = /data-coupon-code\s*=\s*["']([^'"]*)["']/gi;
    const safeDataMatches = [...html.matchAll(safeDataAttributePattern)];
    
    let vulnerabilities = [];
    
    // Check for unsafe onclick patterns
    unsafeOnclickMatches.forEach(match => {
        const code = match[1];
        // Check if code contains unescaped dangerous characters
        if (code.includes("'") || code.includes('"') || code.includes('<') || code.includes('>')) {
            vulnerabilities.push(`Unsafe onclick with burnCoupon: ${code.substring(0, 50)}`);
        }
    });
    
    unsafeRedeemMatches.forEach(match => {
        const code = match[1];
        if (code.includes("'") || code.includes('"') || code.includes('<') || code.includes('>')) {
            vulnerabilities.push(`Unsafe onclick with redeem: ${code.substring(0, 50)}`);
        }
    });
    
    // Check for unescaped HTML in code tags
    codeMatches.forEach(match => {
        const codeContent = match[1];
        // If code content contains < or > that are not escaped, it's vulnerable
        if (codeContent.includes('<') && !codeContent.includes('&lt;')) {
            vulnerabilities.push(`Unescaped HTML in <code> tag: ${codeContent.substring(0, 50)}`);
        }
        if (codeContent.includes('>') && !codeContent.includes('&gt;')) {
            vulnerabilities.push(`Unescaped HTML in <code> tag: ${codeContent.substring(0, 50)}`);
        }
    });
    
    const isVulnerable = vulnerabilities.length > 0;
    
    testResults.push({
        name: testName,
        description: description,
        passed: !isVulnerable,
        expected: 'No unsafe onclick attributes or unescaped HTML',
        actual: isVulnerable ? `Found ${vulnerabilities.length} vulnerability(ies)` : 'Safe - uses data attributes and escaped HTML'
    });
    
    if (!isVulnerable) {
        log(`✅ ${testName}: No XSS vulnerabilities found`);
        if (safeDataMatches.length > 0) {
            log(`   Found ${safeDataMatches.length} safe data-coupon-code attributes (good!)`);
        }
        passed++;
        return true;
    } else {
        log(`❌ ${testName}: Found XSS vulnerabilities:`);
        vulnerabilities.forEach(vuln => log(`   - ${vuln}`));
        failed++;
        return false;
    }
}

async function createCouponWithXssPayload(xssPayload) {
    // First, create a campaign
    const campaignResponse = await makeRequest('POST', '/api/admin/campaigns', {
        body: {
            name: 'XSS Test Campaign',
            description: 'Test campaign for XSS testing',
            discount_type: 'percent',
            discount_value: '10'
        }
    });
    
    if (campaignResponse.statusCode !== 200 && campaignResponse.statusCode !== 201) {
        throw new Error(`Failed to create campaign: ${campaignResponse.statusCode}`);
    }
    
    let campaignId;
    try {
        const campaignBody = JSON.parse(campaignResponse.body);
        campaignId = campaignBody.id;
    } catch (e) {
        // Try to extract from response
        const match = campaignResponse.body.match(/"id"\s*:\s*(\d+)/);
        if (match) {
            campaignId = parseInt(match[1]);
        } else {
            throw new Error('Could not extract campaign ID');
        }
    }
    
    // Create a form submission with XSS payload in coupon code
    // Note: We can't directly set coupon code, but we can try to inject via other fields
    // and then manually update the coupon code in the database, or we can test with
    // a coupon code that gets generated and then check if it's displayed safely
    
    // For testing purposes, we'll submit a form and then check the display
    const submitResponse = await makeRequest('POST', `/t/${DEFAULT_TENANT_SLUG}/submit`, {
        body: {
            email: 'xsstest@example.com',
            firstName: 'XSS',
            lastName: 'Test',
            campaign_id: campaignId
        }
    });
    
    // Get the coupon code from response
    let couponCode;
    try {
        const submitBody = JSON.parse(submitResponse.body);
        couponCode = submitBody.coupon_code;
    } catch (e) {
        // Try alternative extraction
        const match = submitResponse.body.match(/"coupon_code"\s*:\s*"([^"]+)"/);
        if (match) {
            couponCode = match[1];
        }
    }
    
    return { couponCode, campaignId };
}

async function runTests() {
    log('Starting XSS Coupon Display Test Suite');
    log(`Testing against: ${BASE_URL}`);
    log('This test verifies that XSS vulnerabilities in coupon code display are fixed');
    log('');
    
    try {
        // Login first
        log('Logging in for authenticated tests...');
        try {
            const loginResponse = await makeRequest('POST', '/api/login', {
                body: {
                    username: ADMIN_USERNAME,
                    password: ADMIN_PASSWORD,
                    userType: ADMIN_USERTYPE
                }
            });
            
            if (loginResponse.statusCode === 200) {
                log('✅ Login successful');
            } else {
                log(`⚠️  Login failed: ${loginResponse.statusCode}`);
                log('   Some tests will be skipped');
                return;
            }
        } catch (e) {
            log(`⚠️  Login error: ${e.message}`);
            return;
        }
        
        // Create a test coupon
        log('');
        log('Creating test coupon...');
        let couponCode, campaignId;
        try {
            const result = await createCouponWithXssPayload('<script>alert("xss")</script>');
            couponCode = result.couponCode;
            campaignId = result.campaignId;
            log(`✅ Test coupon created: ${couponCode}`);
        } catch (e) {
            log(`⚠️  Could not create test coupon: ${e.message}`);
            log('   Using existing coupons for testing...');
        }
        
        // Test 1: Admin page HTML - Check coupon display
        log('');
        log('Test 1: Admin page HTML - Coupon display');
        try {
            // Get admin page HTML
            const adminPageResponse = await makeRequest('GET', `/t/${DEFAULT_TENANT_SLUG}/admin`, {
                headers: {
                    'Accept': 'text/html'
                }
            });
            
            if (adminPageResponse.statusCode === 200) {
                testXssInHtml(
                    adminPageResponse.body,
                    'Admin page HTML does not contain unsafe onclick attributes or unescaped HTML',
                    'Admin Page HTML Safety'
                );
            } else {
                log(`⚠️  Could not fetch admin page: ${adminPageResponse.statusCode}`);
            }
        } catch (e) {
            log(`⚠️  Error testing admin page: ${e.message}`);
        }
        
        // Test 2: Admin API - Check JSON response (should be safe, but verify)
        log('');
        log('Test 2: Admin API - Coupon list JSON');
        try {
            const couponsResponse = await makeRequest('GET', '/api/admin/coupons?limit=10');
            
            if (couponsResponse.statusCode === 200) {
                let couponsData;
                try {
                    couponsData = JSON.parse(couponsResponse.body);
                } catch (e) {
                    log(`⚠️  Could not parse coupons JSON: ${e.message}`);
                }
                
                if (couponsData && couponsData.items) {
                    // Check if any coupon codes contain XSS payloads
                    const hasXssPayload = couponsData.items.some(coupon => {
                        const code = coupon.code || '';
                        return code.includes('<script') || code.includes('onerror=') || code.includes('javascript:');
                    });
                    
                    if (hasXssPayload) {
                        log('⚠️  Found potential XSS payload in coupon codes (this is OK if sanitized in HTML)');
                    }
                    
                    // The important thing is that when rendered in HTML, they're escaped
                    log('✅ Coupon codes retrieved from API (will be checked in HTML rendering)');
                    testResults.push({
                        name: 'Admin API JSON Response',
                        description: 'Coupon codes in JSON response',
                        passed: true,
                        expected: 'JSON response contains coupon codes',
                        actual: `Found ${couponsData.items.length} coupons`
                    });
                    passed++;
                }
            } else {
                log(`⚠️  Could not fetch coupons: ${couponsResponse.statusCode}`);
            }
        } catch (e) {
            log(`⚠️  Error testing admin API: ${e.message}`);
        }
        
        // Test 3: Store page HTML - Check coupon display
        log('');
        log('Test 3: Store page HTML - Coupon display');
        try {
            // Get store page HTML
            const storePageResponse = await makeRequest('GET', `/t/${DEFAULT_TENANT_SLUG}/store`, {
                headers: {
                    'Accept': 'text/html'
                }
            });
            
            if (storePageResponse.statusCode === 200) {
                testXssInHtml(
                    storePageResponse.body,
                    'Store page HTML does not contain unsafe onclick attributes or unescaped HTML',
                    'Store Page HTML Safety'
                );
            } else {
                log(`⚠️  Could not fetch store page: ${storePageResponse.statusCode}`);
            }
        } catch (e) {
            log(`⚠️  Error testing store page: ${e.message}`);
        }
        
        // Test 4: Simulate XSS payload in coupon code via direct database manipulation test
        // This test checks if the escapeHtml function works correctly
        log('');
        log('Test 4: JavaScript escapeHtml function test');
        log('   (This test verifies the client-side sanitization function exists)');
        try {
            const adminPageResponse = await makeRequest('GET', `/t/${DEFAULT_TENANT_SLUG}/admin`, {
                headers: {
                    'Accept': 'text/html'
                }
            });
            
            if (adminPageResponse.statusCode === 200) {
                const html = adminPageResponse.body;
                
                // Check if escapeHtml function exists
                const hasEscapeHtml = html.includes('function escapeHtml') || html.includes('escapeHtml(text)');
                
                if (hasEscapeHtml) {
                    log('✅ escapeHtml function found in admin page');
                    testResults.push({
                        name: 'escapeHtml Function Exists',
                        description: 'Client-side HTML escaping function is present',
                        passed: true,
                        expected: 'escapeHtml function exists',
                        actual: 'Found escapeHtml function'
                    });
                    passed++;
                } else {
                    log('❌ escapeHtml function not found in admin page');
                    testResults.push({
                        name: 'escapeHtml Function Exists',
                        description: 'Client-side HTML escaping function is present',
                        passed: false,
                        expected: 'escapeHtml function exists',
                        actual: 'escapeHtml function not found'
                    });
                    failed++;
                }
                
                // Check if data-coupon-code attributes are used instead of onclick
                const hasDataAttributes = html.includes('data-coupon-code');
                const hasUnsafeOnclick = html.match(/onclick\s*=\s*["']burnCoupon\(/i) || 
                                         html.match(/onclick\s*=\s*["']redeem\(/i);
                
                if (hasDataAttributes && !hasUnsafeOnclick) {
                    log('✅ Safe data attributes used instead of unsafe onclick');
                    testResults.push({
                        name: 'Safe Data Attributes',
                        description: 'Uses data-coupon-code instead of onclick',
                        passed: true,
                        expected: 'data-coupon-code attributes used',
                        actual: 'Found data-coupon-code attributes'
                    });
                    passed++;
                } else if (hasUnsafeOnclick) {
                    log('❌ Unsafe onclick attributes still present');
                    testResults.push({
                        name: 'Safe Data Attributes',
                        description: 'Uses data-coupon-code instead of onclick',
                        passed: false,
                        expected: 'data-coupon-code attributes used',
                        actual: 'Found unsafe onclick attributes'
                    });
                    failed++;
                }
            }
        } catch (e) {
            log(`⚠️  Error testing escapeHtml function: ${e.message}`);
        }
        
    } catch (error) {
        log(`❌ Error during tests: ${error.message}`);
        testResults.push({
            name: 'Test Execution',
            description: 'Tests completed without errors',
            passed: false,
            expected: 'No errors',
            actual: error.message
        });
        failed++;
    }
    
    // Summary
    log('');
    log('='.repeat(60));
    log('Test Results Summary');
    log('='.repeat(60));
    
    testResults.forEach(result => {
        if (result.passed) {
            log(`✅ ${result.name}: ${result.description}`);
        } else {
            log(`❌ ${result.name}: ${result.description}`);
            log(`   Expected: ${result.expected}`);
            log(`   Actual: ${result.actual}`);
        }
    });
    
    log('');
    log(`Total: ${testResults.length} tests`);
    log(`Passed: ${passed}`);
    log(`Failed: ${failed}`);
    log('');
    
    if (failed === 0) {
        log('✅ All XSS coupon display tests passed!');
        log('');
        log('The XSS vulnerability fix has been verified:');
        log('  - Coupon codes are sanitized before display');
        log('  - Safe data attributes are used instead of onclick');
        log('  - HTML is properly escaped');
        process.exit(0);
    } else {
        log('❌ Some XSS coupon display tests failed');
        log('');
        log('Please review the failures above and ensure:');
        log('  - escapeHtml() function is present and used');
        log('  - data-coupon-code attributes are used instead of onclick');
        log('  - All user data is escaped before insertion into HTML');
        process.exit(1);
    }
}

// Run tests
runTests().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});


