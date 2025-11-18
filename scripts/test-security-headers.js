#!/usr/bin/env node
/**
 * Security Headers Test Suite
 * Tests that all security headers are properly set on HTTP responses
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';
const isProduction = process.env.NODE_ENV === 'production';

let testResults = [];
let passed = 0;
let failed = 0;

function log(message) {
    console.log(`[TEST] ${message}`);
}

function makeRequest(path) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, BASE_URL);
        const client = url.protocol === 'https:' ? https : http;
        
        const reqOptions = {
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: url.pathname + url.search,
            method: 'GET',
            headers: {
                'User-Agent': 'Security-Headers-Test/1.0'
            }
        };
        
        const req = client.request(reqOptions, (res) => {
            const headers = res.headers;
            resolve({ statusCode: res.statusCode, headers });
        });
        
        req.on('error', reject);
        req.setTimeout(5000, () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
        req.end();
    });
}

function testHeader(name, expectedValue, headers, description) {
    const actualValue = headers[name.toLowerCase()];
    const passed = actualValue === expectedValue || (expectedValue === null && actualValue !== undefined);
    
    testResults.push({
        name: `Header: ${name}`,
        description,
        passed,
        expected: expectedValue,
        actual: actualValue || '(not set)'
    });
    
    if (passed) {
        log(`✅ ${name}: ${actualValue || 'not set (as expected)'}`);
        return true;
    } else {
        log(`❌ ${name}: Expected "${expectedValue}", got "${actualValue || '(not set)'}"`);
        return false;
    }
}

function testHeaderContains(name, expectedSubstring, headers, description) {
    const actualValue = headers[name.toLowerCase()];
    const passed = actualValue && actualValue.includes(expectedSubstring);
    
    testResults.push({
        name: `Header: ${name}`,
        description,
        passed,
        expected: `contains "${expectedSubstring}"`,
        actual: actualValue || '(not set)'
    });
    
    if (passed) {
        log(`✅ ${name}: Contains "${expectedSubstring}"`);
        return true;
    } else {
        log(`❌ ${name}: Expected to contain "${expectedSubstring}", got "${actualValue || '(not set)'}"`);
        return false;
    }
}

async function runTests() {
    log('Starting Security Headers Test Suite');
    log(`Testing against: ${BASE_URL}`);
    log(`Production mode: ${isProduction}`);
    log('');
    
    try {
        // Test public endpoint
        log('Testing public endpoint: /api/public-config');
        const publicResponse = await makeRequest('/api/public-config');
        
        if (publicResponse.statusCode !== 200) {
            log(`⚠️  Warning: Public endpoint returned ${publicResponse.statusCode}`);
        }
        
        // Test X-Frame-Options (should be DENY)
        testHeader('X-Frame-Options', 'DENY', publicResponse.headers, 'Prevents clickjacking attacks');
        
        // Test X-Content-Type-Options (should be nosniff)
        testHeader('X-Content-Type-Options', 'nosniff', publicResponse.headers, 'Prevents MIME type sniffing');
        
        // Test X-XSS-Protection (helmet sets this)
        testHeaderContains('X-XSS-Protection', '1', publicResponse.headers, 'Enables XSS filter');
        
        // Test Referrer-Policy
        testHeaderContains('Referrer-Policy', 'strict-origin-when-cross-origin', publicResponse.headers, 'Controls referrer information');
        
        // Test Content-Security-Policy (only in production)
        if (isProduction) {
            const csp = publicResponse.headers['content-security-policy'];
            if (csp) {
                testHeaderContains('Content-Security-Policy', "default-src 'self'", publicResponse.headers, 'Prevents XSS and injection attacks');
            } else {
                log('⚠️  Content-Security-Policy not set (expected in production)');
                testResults.push({
                    name: 'Header: Content-Security-Policy',
                    description: 'Prevents XSS and injection attacks',
                    passed: false,
                    expected: 'Set in production',
                    actual: '(not set)'
                });
            }
        } else {
            log('ℹ️  Content-Security-Policy disabled in development (as expected)');
        }
        
        // Test Strict-Transport-Security (only in production with HTTPS)
        if (isProduction && BASE_URL.startsWith('https://')) {
            const hsts = publicResponse.headers['strict-transport-security'];
            if (hsts) {
                testHeaderContains('Strict-Transport-Security', 'max-age=', publicResponse.headers, 'Forces HTTPS connections');
            } else {
                log('⚠️  Strict-Transport-Security not set (expected in production with HTTPS)');
                testResults.push({
                    name: 'Header: Strict-Transport-Security',
                    description: 'Forces HTTPS connections',
                    passed: false,
                    expected: 'Set in production with HTTPS',
                    actual: '(not set)'
                });
            }
        } else {
            log('ℹ️  Strict-Transport-Security disabled (not in production or not HTTPS)');
        }
        
        // Test X-Permitted-Cross-Domain-Policies
        const crossDomain = publicResponse.headers['x-permitted-cross-domain-policies'];
        if (crossDomain === 'none' || !crossDomain) {
            log('✅ X-Permitted-Cross-Domain-Policies: none or not set (good)');
            testResults.push({
                name: 'Header: X-Permitted-Cross-Domain-Policies',
                description: 'Prevents cross-domain policy files',
                passed: true,
                expected: 'none or not set',
                actual: crossDomain || '(not set)'
            });
        } else {
            log(`⚠️  X-Permitted-Cross-Domain-Policies: ${crossDomain} (should be none or not set)`);
            testResults.push({
                name: 'Header: X-Permitted-Cross-Domain-Policies',
                description: 'Prevents cross-domain policy files',
                passed: false,
                expected: 'none or not set',
                actual: crossDomain
            });
        }
        
        // Test that headers don't break functionality
        log('');
        log('Testing that headers don\'t break functionality...');
        
        // Test static files
        try {
            const staticResponse = await makeRequest('/static/styles.css');
            if (staticResponse.statusCode === 200 || staticResponse.statusCode === 304) {
                log('✅ Static files accessible');
                testResults.push({
                    name: 'Functionality: Static Files',
                    description: 'Static files still accessible with security headers',
                    passed: true,
                    expected: '200 or 304',
                    actual: staticResponse.statusCode
                });
            } else {
                log(`❌ Static files returned ${staticResponse.statusCode}`);
                testResults.push({
                    name: 'Functionality: Static Files',
                    description: 'Static files still accessible with security headers',
                    passed: false,
                    expected: '200 or 304',
                    actual: staticResponse.statusCode
                });
            }
        } catch (e) {
            log(`⚠️  Could not test static files: ${e.message}`);
        }
        
        // Test API endpoint
        try {
            const apiResponse = await makeRequest('/api/public-config');
            if (apiResponse.statusCode === 200) {
                log('✅ API endpoints accessible');
                testResults.push({
                    name: 'Functionality: API Endpoints',
                    description: 'API endpoints still accessible with security headers',
                    passed: true,
                    expected: '200',
                    actual: apiResponse.statusCode
                });
            } else {
                log(`❌ API endpoint returned ${apiResponse.statusCode}`);
                testResults.push({
                    name: 'Functionality: API Endpoints',
                    description: 'API endpoints still accessible with security headers',
                    passed: false,
                    expected: '200',
                    actual: apiResponse.statusCode
                });
            }
        } catch (e) {
            log(`⚠️  Could not test API endpoint: ${e.message}`);
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
    }
    
    // Summary
    log('');
    log('='.repeat(60));
    log('Test Results Summary');
    log('='.repeat(60));
    
    testResults.forEach(result => {
        if (result.passed) {
            passed++;
            log(`✅ ${result.name}: ${result.description}`);
        } else {
            failed++;
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
        log('✅ All security header tests passed!');
        process.exit(0);
    } else {
        log('❌ Some security header tests failed');
        process.exit(1);
    }
}

// Run tests
runTests().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});

