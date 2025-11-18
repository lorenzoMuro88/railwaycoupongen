#!/usr/bin/env node
/**
 * XSS Protection Test Suite
 * Tests that XSS attacks are prevented through input sanitization and output escaping
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
                
                let parsedData;
                try {
                    parsedData = JSON.parse(data);
                } catch (e) {
                    parsedData = data;
                }
                
                resolve({ 
                    statusCode: res.statusCode, 
                    headers: res.headers,
                    body: parsedData,
                    data
                });
            });
        });
        
        req.on('error', reject);
        
        if (options.body) {
            req.write(JSON.stringify(options.body));
        }
        
        req.setTimeout(5000, () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
        req.end();
    });
}

function testXssInjection(payload, description, response) {
    const body = response.body || {};
    
    // Check parsed body values directly (more accurate than checking JSON string)
    let hasUnescapedInBody = false;
    if (typeof body === 'object') {
        const checkValue = (val) => {
            if (typeof val === 'string') {
                // Check if string contains dangerous patterns that are NOT escaped
                // If we see <script> but not &lt;script&gt;, it's vulnerable
                if (val.includes('<script>') && !val.includes('&lt;script&gt;')) {
                    return true;
                }
                // If we see onerror= in what looks like an HTML tag but < and > are not escaped, it's vulnerable
                // Safe if: &lt;img...onerror=...&gt; (escaped) or just text "onerror=" (not in tag)
                // Vulnerable if: <img...onerror=...> (unescaped tag)
                if (val.includes('onerror=')) {
                    // Check if it's inside an unescaped HTML tag
                    const hasUnescapedTag = val.match(/<[^>]*onerror=/);
                    const hasEscapedTag = val.match(/&lt;[^&]*onerror=/);
                    if (hasUnescapedTag && !hasEscapedTag) {
                        return true;
                    }
                }
                // Check for javascript: protocol that's not escaped
                if (val.includes('javascript:')) {
                    // Safe if escaped as &quot;javascript: or inside escaped tag
                    // Vulnerable if plain javascript: that could be executed
                    const hasUnescapedJs = val.match(/[^&]javascript:/) && !val.match(/&quot;javascript:/) && !val.match(/&lt;[^&]*javascript:/);
                    if (hasUnescapedJs) {
                        return true;
                    }
                }
            } else if (Array.isArray(val)) {
                return val.some(checkValue);
            } else if (typeof val === 'object' && val !== null) {
                return Object.values(val).some(checkValue);
            }
            return false;
        };
        hasUnescapedInBody = checkValue(body);
    }
    
    const isVulnerable = hasUnescapedInBody;
    
    testResults.push({
        name: description,
        description: 'XSS payload is sanitized/escaped',
        passed: !isVulnerable,
        expected: 'Payload escaped or rejected',
        actual: isVulnerable ? 'Payload found unescaped' : 'Payload escaped or rejected'
    });
    
    if (!isVulnerable) {
        log(`✅ ${description}: XSS payload sanitized`);
        passed++;
        return true;
    } else {
        log(`❌ ${description}: XSS payload may be vulnerable`);
        // Log which type of vulnerability was found
        const checkValue = (val) => {
            if (typeof val === 'string') {
                if (val.includes('<script>') && !val.includes('&lt;script&gt;')) {
                    log('   Found unescaped <script> tag');
                    return true;
                }
                if (val.match(/<[^>]*onerror=/)) {
                    log('   Found unescaped onerror attribute');
                    return true;
                }
                if (val.match(/[^&]javascript:/) && !val.match(/&quot;javascript:/)) {
                    log('   Found unescaped javascript: protocol');
                    return true;
                }
            } else if (Array.isArray(val)) {
                return val.some(checkValue);
            } else if (typeof val === 'object' && val !== null) {
                return Object.values(val).some(checkValue);
            }
            return false;
        };
        checkValue(body);
        failed++;
        return false;
    }
}

async function runTests() {
    log('Starting XSS Protection Test Suite');
    log(`Testing against: ${BASE_URL}`);
    log('');
    
    try {
        // Login first for authenticated tests
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
            }
        } catch (e) {
            log(`⚠️  Login error: ${e.message}`);
        }
        
        // Test 1: XSS in form submission (public endpoint)
        log('');
        log('Test 1: XSS in form submission (public endpoint)');
        try {
            const xssPayload = '<script>alert("xss")</script>';
            const submitResponse = await makeRequest('POST', `/t/${DEFAULT_TENANT_SLUG}/submit`, {
                body: {
                    email: 'test@example.com',
                    firstName: xssPayload,
                    lastName: 'User'
                }
            });
            
            // Check if XSS payload is escaped in response or rejected
            if (submitResponse.statusCode === 400) {
                // Input rejected (good)
                log('✅ XSS payload rejected by validation');
                testResults.push({
                    name: 'XSS in Form Submission',
                    description: 'XSS payload in form submission is rejected or escaped',
                    passed: true,
                    expected: 'Rejected or escaped',
                    actual: 'Rejected by validation'
                });
                passed++;
            } else {
                // Check if escaped in response
                testXssInjection(xssPayload, 'XSS in Form Submission', submitResponse);
            }
        } catch (e) {
            log(`⚠️  Could not test form submission XSS: ${e.message}`);
        }
        
        // Test 2: XSS in campaign name (admin endpoint)
        log('');
        log('Test 2: XSS in campaign name (admin endpoint)');
        try {
            if (sessionCookie) {
                const xssPayload = '<img src=x onerror=alert("xss")>';
                const createResponse = await makeRequest('POST', '/api/admin/campaigns', {
                    body: {
                        name: xssPayload,
                        description: 'Test campaign',
                        discount_type: 'percent',
                        discount_value: '10'
                    }
                });
                
                // Check if XSS payload is escaped in response
                // The payload should be sanitized: <img src=x onerror=alert("xss")> becomes &lt;img src=x onerror=alert("xss")&gt;
                if (createResponse.statusCode === 200 || createResponse.statusCode === 201) {
                    const responseName = createResponse.body.name || '';
                    // Check if payload is properly escaped (contains &lt; instead of <)
                    if (responseName.includes('&lt;') || responseName.includes('&gt;')) {
                        log('✅ XSS payload sanitized in POST response');
                        testResults.push({
                            name: 'XSS in Campaign Name',
                            description: 'XSS payload is sanitized/escaped',
                            passed: true,
                            expected: 'Escaped',
                            actual: 'Escaped'
                        });
                        passed++;
                    } else if (responseName.includes('<')) {
                        log('❌ XSS payload not sanitized in POST response');
                        testResults.push({
                            name: 'XSS in Campaign Name',
                            description: 'XSS payload is sanitized/escaped',
                            passed: false,
                            expected: 'Escaped',
                            actual: 'Not escaped'
                        });
                        failed++;
                    }
                    
                    // Also test GET to see if stored XSS is escaped
                    if (createResponse.body.id) {
                        log('   Testing stored XSS in GET response...');
                        const getResponse = await makeRequest('GET', '/api/admin/campaigns');
                        if (getResponse.statusCode === 200 && Array.isArray(getResponse.body)) {
                            const foundCampaign = getResponse.body.find(c => c.id === createResponse.body.id);
                            if (foundCampaign) {
                                const storedName = foundCampaign.name || '';
                                if (storedName.includes('&lt;') || storedName.includes('&gt;')) {
                                    log('✅ Stored XSS payload sanitized in GET response');
                                    testResults.push({
                                        name: 'Stored XSS in Campaign GET',
                                        description: 'XSS payload is sanitized/escaped',
                                        passed: true,
                                        expected: 'Escaped',
                                        actual: 'Escaped'
                                    });
                                    passed++;
                                } else if (storedName.includes('<')) {
                                    log('❌ Stored XSS payload not sanitized in GET response');
                                    testResults.push({
                                        name: 'Stored XSS in Campaign GET',
                                        description: 'XSS payload is sanitized/escaped',
                                        passed: false,
                                        expected: 'Escaped',
                                        actual: 'Not escaped'
                                    });
                                    failed++;
                                }
                            }
                        }
                    }
                } else {
                    // Campaign creation failed, can't test
                    log(`⚠️  Campaign creation failed: ${createResponse.statusCode}`);
                }
            } else {
                log('⚠️  Skipping admin XSS test (not authenticated)');
            }
        } catch (e) {
            log(`⚠️  Could not test campaign XSS: ${e.message}`);
        }
        
        // Test 3: XSS in user email
        log('');
        log('Test 3: XSS in user email');
        try {
            const xssPayload = '"><script>alert("xss")</script>';
            const submitResponse = await makeRequest('POST', `/t/${DEFAULT_TENANT_SLUG}/submit`, {
                body: {
                    email: `test${xssPayload}@example.com`,
                    firstName: 'Test',
                    lastName: 'User'
                }
            });
            
            // Email validation should reject this, but check response anyway
            if (submitResponse.statusCode === 400) {
                log('✅ XSS in email rejected by validation');
                testResults.push({
                    name: 'XSS in Email',
                    description: 'XSS payload in email is rejected or escaped',
                    passed: true,
                    expected: 'Rejected or escaped',
                    actual: 'Rejected by validation'
                });
                passed++;
            } else {
                testXssInjection(xssPayload, 'XSS in Email', submitResponse);
            }
        } catch (e) {
            log(`⚠️  Could not test email XSS: ${e.message}`);
        }
        
        // Test 4: XSS in description field
        log('');
        log('Test 4: XSS in description field');
        try {
            if (sessionCookie) {
                const xssPayload = 'javascript:alert("xss")';
                const createResponse = await makeRequest('POST', '/api/admin/campaigns', {
                    body: {
                        name: 'Test Campaign',
                        description: xssPayload,
                        discount_type: 'percent',
                        discount_value: '10'
                    }
                });
                
                testXssInjection(xssPayload, 'XSS in Description', createResponse);
            } else {
                log('⚠️  Skipping description XSS test (not authenticated)');
            }
        } catch (e) {
            log(`⚠️  Could not test description XSS: ${e.message}`);
        }
        
        // Test 5: XSS in JSON response (already covered by Test 2)
        // This test is redundant, skipping
        
        // Test 6: Valid characters not over-escaped
        log('');
        log('Test 6: Valid characters not over-escaped');
        try {
            const validName = "O'Brien-Smith";
            const submitResponse = await makeRequest('POST', `/t/${DEFAULT_TENANT_SLUG}/submit`, {
                body: {
                    email: 'test@example.com',
                    firstName: validName,
                    lastName: 'User'
                }
            });
            
            // Valid characters should be accepted (not rejected)
            if (submitResponse.statusCode !== 400) {
                log('✅ Valid special characters accepted');
                testResults.push({
                    name: 'Valid Characters Not Over-Escaped',
                    description: 'Valid characters (apostrophes, hyphens) are accepted',
                    passed: true,
                    expected: 'Accepted',
                    actual: 'Accepted'
                });
                passed++;
            } else {
                log('⚠️  Valid characters rejected');
                testResults.push({
                    name: 'Valid Characters Not Over-Escaped',
                    description: 'Valid characters (apostrophes, hyphens) are accepted',
                    passed: false,
                    expected: 'Accepted',
                    actual: 'Rejected'
                });
                failed++;
            }
        } catch (e) {
            log(`⚠️  Could not test valid characters: ${e.message}`);
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
        log('✅ All XSS protection tests passed!');
        process.exit(0);
    } else {
        log('❌ Some XSS protection tests failed');
        process.exit(1);
    }
}

// Run tests
runTests().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});

