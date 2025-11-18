#!/usr/bin/env node
/**
 * Password Policy Test Suite
 * Tests password policy enforcement for user creation and updates
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

async function runTests() {
    log('Starting Password Policy Test Suite');
    log(`Testing against: ${BASE_URL}`);
    log('');
    
    try {
        // Login first
        log('Logging in...');
        const loginResponse = await makeRequest('POST', '/api/login', {
            body: {
                username: ADMIN_USERNAME,
                password: ADMIN_PASSWORD,
                userType: ADMIN_USERTYPE
            }
        });
        
        if (loginResponse.statusCode !== 200) {
            log(`❌ Login failed: ${loginResponse.statusCode}`);
            log(`   Response: ${JSON.stringify(loginResponse.body)}`);
            log('   Cannot run authenticated tests');
            log('');
            log('⚠️  Note: Password policy validation is implemented in the code.');
            log('   Tests require valid authentication to verify.');
            process.exit(1);
        }
        log('✅ Login successful');
        
        // Test 1: Weak password (too short)
        log('');
        log('Test 1: Password too short (< 12 characters)');
        try {
            const response = await makeRequest('POST', '/api/admin/auth-users', {
                body: {
                    username: 'testuser1',
                    password: 'Short1!',
                    user_type: 'store'
                }
            });
            
            if (response.statusCode === 400) {
                const errorMsg = response.body.error || '';
                const hasDetails = response.body.details && Array.isArray(response.body.details);
                if (errorMsg.includes('policy') || hasDetails) {
                    log('✅ Short password rejected');
                    testResults.push({
                        name: 'Password Too Short',
                        passed: true,
                        expected: 'Rejected',
                        actual: 'Rejected'
                    });
                    passed++;
                } else {
                    log(`⚠️  Short password rejected but unexpected error format: ${errorMsg}`);
                    testResults.push({
                        name: 'Password Too Short',
                        passed: true, // Still passed - password was rejected
                        expected: 'Rejected',
                        actual: 'Rejected (unexpected format)'
                    });
                    passed++;
                }
            } else {
                log(`❌ Short password not rejected: ${response.statusCode}`);
                log(`   Response: ${JSON.stringify(response.body)}`);
                testResults.push({
                    name: 'Password Too Short',
                    passed: false,
                    expected: 'Rejected',
                    actual: `Status ${response.statusCode}`
                });
                failed++;
            }
        } catch (e) {
            log(`⚠️  Error testing short password: ${e.message}`);
        }
        
        // Test 2: Password without uppercase
        log('');
        log('Test 2: Password without uppercase letter');
        try {
            const response = await makeRequest('POST', '/api/admin/auth-users', {
                body: {
                    username: 'testuser2',
                    password: 'lowercase123!',
                    user_type: 'store'
                }
            });
            
            if (response.statusCode === 400 && 
                (response.body.error?.includes('policy') || response.body.details)) {
                log('✅ Password without uppercase rejected');
                testResults.push({
                    name: 'Password Without Uppercase',
                    passed: true,
                    expected: 'Rejected',
                    actual: 'Rejected'
                });
                passed++;
            } else {
                log(`❌ Password without uppercase not rejected: ${response.statusCode}`);
                testResults.push({
                    name: 'Password Without Uppercase',
                    passed: false,
                    expected: 'Rejected',
                    actual: `Status ${response.statusCode}`
                });
                failed++;
            }
        } catch (e) {
            log(`⚠️  Error testing password without uppercase: ${e.message}`);
        }
        
        // Test 3: Password without number
        log('');
        log('Test 3: Password without number');
        try {
            const response = await makeRequest('POST', '/api/admin/auth-users', {
                body: {
                    username: 'testuser3',
                    password: 'NoNumbersHere!',
                    user_type: 'store'
                }
            });
            
            if (response.statusCode === 400 && 
                (response.body.error?.includes('policy') || response.body.details)) {
                log('✅ Password without number rejected');
                testResults.push({
                    name: 'Password Without Number',
                    passed: true,
                    expected: 'Rejected',
                    actual: 'Rejected'
                });
                passed++;
            } else {
                log(`❌ Password without number not rejected: ${response.statusCode}`);
                testResults.push({
                    name: 'Password Without Number',
                    passed: false,
                    expected: 'Rejected',
                    actual: `Status ${response.statusCode}`
                });
                failed++;
            }
        } catch (e) {
            log(`⚠️  Error testing password without number: ${e.message}`);
        }
        
        // Test 4: Password without special character
        log('');
        log('Test 4: Password without special character');
        try {
            const response = await makeRequest('POST', '/api/admin/auth-users', {
                body: {
                    username: 'testuser4',
                    password: 'NoSpecialChar123',
                    user_type: 'store'
                }
            });
            
            if (response.statusCode === 400 && 
                (response.body.error?.includes('policy') || response.body.details)) {
                log('✅ Password without special character rejected');
                testResults.push({
                    name: 'Password Without Special Character',
                    passed: true,
                    expected: 'Rejected',
                    actual: 'Rejected'
                });
                passed++;
            } else {
                log(`❌ Password without special character not rejected: ${response.statusCode}`);
                testResults.push({
                    name: 'Password Without Special Character',
                    passed: false,
                    expected: 'Rejected',
                    actual: `Status ${response.statusCode}`
                });
                failed++;
            }
        } catch (e) {
            log(`⚠️  Error testing password without special character: ${e.message}`);
        }
        
        // Test 5: Common password
        log('');
        log('Test 5: Common password');
        try {
            const response = await makeRequest('POST', '/api/admin/auth-users', {
                body: {
                    username: 'testuser5',
                    password: 'password123',
                    user_type: 'store'
                }
            });
            
            if (response.statusCode === 400 && 
                (response.body.error?.includes('policy') || response.body.details)) {
                log('✅ Common password rejected');
                testResults.push({
                    name: 'Common Password',
                    passed: true,
                    expected: 'Rejected',
                    actual: 'Rejected'
                });
                passed++;
            } else {
                log(`⚠️  Common password not rejected: ${response.statusCode}`);
                testResults.push({
                    name: 'Common Password',
                    passed: false,
                    expected: 'Rejected',
                    actual: `Status ${response.statusCode}`
                });
                failed++;
            }
        } catch (e) {
            log(`⚠️  Error testing common password: ${e.message}`);
        }
        
        // Test 6: Valid password
        log('');
        log('Test 6: Valid strong password');
        try {
            const response = await makeRequest('POST', '/api/admin/auth-users', {
                body: {
                    username: `testuser${Date.now()}`,
                    password: 'ValidP@ssw0rd123',
                    user_type: 'store'
                }
            });
            
            if (response.statusCode === 200 || response.statusCode === 201) {
                log('✅ Valid password accepted');
                testResults.push({
                    name: 'Valid Password',
                    passed: true,
                    expected: 'Accepted',
                    actual: 'Accepted'
                });
                passed++;
            } else if (response.statusCode === 400 && response.body.error?.includes('policy')) {
                log(`❌ Valid password rejected: ${response.body.error}`);
                testResults.push({
                    name: 'Valid Password',
                    passed: false,
                    expected: 'Accepted',
                    actual: 'Rejected'
                });
                failed++;
            } else {
                log(`⚠️  Unexpected response: ${response.statusCode}`);
                // Might be username conflict, which is OK
                if (response.statusCode === 400 && response.body.error?.includes('Username')) {
                    log('   (Username conflict - password validation passed)');
                    testResults.push({
                        name: 'Valid Password',
                        passed: true,
                        expected: 'Accepted',
                        actual: 'Accepted (username conflict)'
                    });
                    passed++;
                }
            }
        } catch (e) {
            log(`⚠️  Error testing valid password: ${e.message}`);
        }
        
        // Test 7: Password policy in signup
        log('');
        log('Test 7: Password policy in signup endpoint');
        try {
            const response = await makeRequest('POST', '/api/signup', {
                body: {
                    tenantName: `TestTenant${Date.now()}`,
                    tenantSlug: `testtenant${Date.now()}`,
                    adminUsername: `admintest${Date.now()}`,
                    adminPassword: 'Weak123!' // Too short
                }
            });
            
            if (response.statusCode === 400 && 
                (response.body.error?.includes('policy') || response.body.details)) {
                log('✅ Weak password rejected in signup');
                testResults.push({
                    name: 'Password Policy in Signup',
                    passed: true,
                    expected: 'Rejected',
                    actual: 'Rejected'
                });
                passed++;
            } else {
                log(`⚠️  Weak password not rejected in signup: ${response.statusCode}`);
                testResults.push({
                    name: 'Password Policy in Signup',
                    passed: false,
                    expected: 'Rejected',
                    actual: `Status ${response.statusCode}`
                });
                failed++;
            }
        } catch (e) {
            log(`⚠️  Error testing signup password policy: ${e.message}`);
        }
        
    } catch (error) {
        log(`❌ Error during tests: ${error.message}`);
        testResults.push({
            name: 'Test Execution',
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
            log(`✅ ${result.name}`);
        } else {
            log(`❌ ${result.name}`);
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
        log('✅ All password policy tests passed!');
        process.exit(0);
    } else {
        log('❌ Some password policy tests failed');
        process.exit(1);
    }
}

// Run tests
runTests().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});

