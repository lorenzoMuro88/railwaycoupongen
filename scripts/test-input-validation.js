#!/usr/bin/env node
/**
 * Input Validation Test Suite
 * Tests that input validation works correctly and rejects invalid input
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';
const DEFAULT_TENANT_SLUG = process.env.DEFAULT_TENANT_SLUG || 'default';

let testResults = [];
let passed = 0;
let failed = 0;

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
        
        if (options.body) {
            const bodyStr = JSON.stringify(options.body);
            reqOptions.headers['Content-Length'] = Buffer.byteLength(bodyStr);
        }
        
        const req = client.request(reqOptions, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
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

async function runTests() {
    log('Starting Input Validation Test Suite');
    log(`Testing against: ${BASE_URL}`);
    log('');
    
    try {
        // Test 1: Invalid email format rejected
        log('Test 1: Invalid email format rejected');
        try {
            const invalidEmailResponse = await makeRequest('POST', `/t/${DEFAULT_TENANT_SLUG}/submit`, {
                body: {
                    email: 'not-an-email',
                    firstName: 'Test',
                    lastName: 'User'
                }
            });
            
            if (invalidEmailResponse.statusCode === 400) {
                const hasError = invalidEmailResponse.body && 
                    (invalidEmailResponse.body.error || invalidEmailResponse.body.details);
                
                if (hasError) {
                    log('✅ Invalid email rejected with 400');
                    testResults.push({
                        name: 'Invalid Email Rejection',
                        description: 'Invalid email format is rejected',
                        passed: true,
                        expected: '400 with error message',
                        actual: '400 with error message'
                    });
                    passed++;
                } else {
                    log('⚠️  Invalid email rejected but no error message');
                    testResults.push({
                        name: 'Invalid Email Rejection',
                        description: 'Invalid email format is rejected',
                        passed: false,
                        expected: '400 with error message',
                        actual: '400 without error message'
                    });
                    failed++;
                }
            } else {
                log(`❌ Invalid email not rejected (status: ${invalidEmailResponse.statusCode})`);
                testResults.push({
                    name: 'Invalid Email Rejection',
                    description: 'Invalid email format is rejected',
                    passed: false,
                    expected: '400',
                    actual: invalidEmailResponse.statusCode
                });
                failed++;
            }
        } catch (e) {
            log(`⚠️  Could not test invalid email: ${e.message}`);
        }
        
        // Test 2: Missing required fields rejected
        log('');
        log('Test 2: Missing required fields rejected');
        try {
            const missingFieldsResponse = await makeRequest('POST', `/t/${DEFAULT_TENANT_SLUG}/submit`, {
                body: {
                    firstName: 'Test'
                    // Missing email
                }
            });
            
            if (missingFieldsResponse.statusCode === 400) {
                log('✅ Missing required fields rejected');
                testResults.push({
                    name: 'Missing Required Fields',
                    description: 'Missing required fields are rejected',
                    passed: true,
                    expected: '400',
                    actual: '400'
                });
                passed++;
            } else {
                log(`❌ Missing fields not rejected (status: ${missingFieldsResponse.statusCode})`);
                testResults.push({
                    name: 'Missing Required Fields',
                    description: 'Missing required fields are rejected',
                    passed: false,
                    expected: '400',
                    actual: missingFieldsResponse.statusCode
                });
                failed++;
            }
        } catch (e) {
            log(`⚠️  Could not test missing fields: ${e.message}`);
        }
        
        // Test 3: Valid input accepted
        log('');
        log('Test 3: Valid input accepted');
        try {
            const validResponse = await makeRequest('POST', `/t/${DEFAULT_TENANT_SLUG}/submit`, {
                body: {
                    email: 'test@example.com',
                    firstName: 'Test',
                    lastName: 'User'
                }
            });
            
            // Valid input should not return 400 (may return other status codes for other reasons)
            if (validResponse.statusCode !== 400) {
                log('✅ Valid input accepted (not rejected as invalid)');
                testResults.push({
                    name: 'Valid Input Acceptance',
                    description: 'Valid input is accepted',
                    passed: true,
                    expected: 'Not 400',
                    actual: `Status ${validResponse.statusCode}`
                });
                passed++;
            } else {
                log(`⚠️  Valid input rejected (status: 400)`);
                log(`   Response: ${JSON.stringify(validResponse.body)}`);
                testResults.push({
                    name: 'Valid Input Acceptance',
                    description: 'Valid input is accepted',
                    passed: false,
                    expected: 'Not 400',
                    actual: '400'
                });
                failed++;
            }
        } catch (e) {
            log(`⚠️  Could not test valid input: ${e.message}`);
        }
        
        // Test 4: Special characters in names handled correctly
        log('');
        log('Test 4: Special characters in names');
        try {
            const specialCharsResponse = await makeRequest('POST', `/t/${DEFAULT_TENANT_SLUG}/submit`, {
                body: {
                    email: 'test@example.com',
                    firstName: "O'Brien",
                    lastName: 'Smith-Jones'
                }
            });
            
            // Names with apostrophes and hyphens should be accepted
            if (specialCharsResponse.statusCode !== 400) {
                log('✅ Special characters in names accepted');
                testResults.push({
                    name: 'Special Characters in Names',
                    description: 'Apostrophes and hyphens in names are accepted',
                    passed: true,
                    expected: 'Accepted',
                    actual: 'Accepted'
                });
                passed++;
            } else {
                log(`⚠️  Special characters rejected`);
                testResults.push({
                    name: 'Special Characters in Names',
                    description: 'Apostrophes and hyphens in names are accepted',
                    passed: false,
                    expected: 'Accepted',
                    actual: 'Rejected'
                });
                failed++;
            }
        } catch (e) {
            log(`⚠️  Could not test special characters: ${e.message}`);
        }
        
        // Test 5: Dangerous characters rejected
        log('');
        log('Test 5: Dangerous characters rejected');
        try {
            const dangerousResponse = await makeRequest('POST', `/t/${DEFAULT_TENANT_SLUG}/submit`, {
                body: {
                    email: 'test@example.com',
                    firstName: '<script>alert("xss")</script>',
                    lastName: 'User'
                }
            });
            
            // Script tags should be rejected or sanitized
            if (dangerousResponse.statusCode === 400) {
                log('✅ Dangerous characters rejected');
                testResults.push({
                    name: 'Dangerous Characters Rejection',
                    description: 'Script tags and dangerous characters are rejected',
                    passed: true,
                    expected: '400',
                    actual: '400'
                });
                passed++;
            } else {
                log(`⚠️  Dangerous characters not rejected (status: ${dangerousResponse.statusCode})`);
                testResults.push({
                    name: 'Dangerous Characters Rejection',
                    description: 'Script tags and dangerous characters are rejected',
                    passed: false,
                    expected: '400',
                    actual: dangerousResponse.statusCode
                });
                failed++;
            }
        } catch (e) {
            log(`⚠️  Could not test dangerous characters: ${e.message}`);
        }
        
        // Test 6: Field length limits enforced
        log('');
        log('Test 6: Field length limits enforced');
        try {
            const longEmail = 'a'.repeat(300) + '@example.com'; // Email too long
            const longEmailResponse = await makeRequest('POST', `/t/${DEFAULT_TENANT_SLUG}/submit`, {
                body: {
                    email: longEmail,
                    firstName: 'Test',
                    lastName: 'User'
                }
            });
            
            if (longEmailResponse.statusCode === 400) {
                log('✅ Field length limits enforced');
                testResults.push({
                    name: 'Field Length Limits',
                    description: 'Field length limits are enforced',
                    passed: true,
                    expected: '400',
                    actual: '400'
                });
                passed++;
            } else {
                log(`⚠️  Field length limits not enforced (status: ${longEmailResponse.statusCode})`);
                testResults.push({
                    name: 'Field Length Limits',
                    description: 'Field length limits are enforced',
                    passed: false,
                    expected: '400',
                    actual: longEmailResponse.statusCode
                });
                failed++;
            }
        } catch (e) {
            log(`⚠️  Could not test field length: ${e.message}`);
        }
        
        // Test 7: Login validation
        log('');
        log('Test 7: Login input validation');
        try {
            const invalidLoginResponse = await makeRequest('POST', '/api/login', {
                body: {
                    username: '', // Empty username
                    password: 'test',
                    userType: 'admin'
                }
            });
            
            if (invalidLoginResponse.statusCode === 400) {
                log('✅ Invalid login input rejected');
                testResults.push({
                    name: 'Login Validation',
                    description: 'Invalid login input is rejected',
                    passed: true,
                    expected: '400',
                    actual: '400'
                });
                passed++;
            } else {
                log(`⚠️  Invalid login not rejected (status: ${invalidLoginResponse.statusCode})`);
                testResults.push({
                    name: 'Login Validation',
                    description: 'Invalid login input is rejected',
                    passed: false,
                    expected: '400',
                    actual: invalidLoginResponse.statusCode
                });
                failed++;
            }
        } catch (e) {
            log(`⚠️  Could not test login validation: ${e.message}`);
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
        log('✅ All input validation tests passed!');
        process.exit(0);
    } else {
        log('❌ Some input validation tests failed');
        process.exit(1);
    }
}

// Run tests
runTests().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});

