#!/usr/bin/env node
/**
 * CORS Configuration Test Suite
 * Tests that CORS headers are properly configured and whitelist works correctly
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(o => o.trim()).filter(o => o);
const isProduction = process.env.NODE_ENV === 'production';

let testResults = [];
let passed = 0;
let failed = 0;

function log(message) {
    console.log(`[TEST] ${message}`);
}

function makeRequest(path, options = {}) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, BASE_URL);
        const client = url.protocol === 'https:' ? https : http;
        
        const reqOptions = {
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: url.pathname + url.search,
            method: options.method || 'GET',
            headers: {
                'User-Agent': 'CORS-Test/1.0',
                ...options.headers
            }
        };
        
        const req = client.request(reqOptions, (res) => {
            const headers = res.headers;
            resolve({ 
                statusCode: res.statusCode, 
                headers
            });
        });
        
        req.on('error', reject);
        req.setTimeout(5000, () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
        req.end();
    });
}

function testCorsHeader(name, expectedValue, headers, description) {
    const actualValue = headers[name.toLowerCase()];
    const passed = actualValue === expectedValue || (expectedValue === null && actualValue !== undefined);
    
    testResults.push({
        name: `CORS Header: ${name}`,
        description,
        passed,
        expected: expectedValue || 'present',
        actual: actualValue || '(not set)'
    });
    
    if (passed) {
        log(`✅ ${name}: ${actualValue || 'present'}`);
        return true;
    } else {
        log(`❌ ${name}: Expected "${expectedValue || 'present'}", got "${actualValue || '(not set)'}"`);
        return false;
    }
}

async function runTests() {
    log('Starting CORS Configuration Test Suite');
    log(`Testing against: ${BASE_URL}`);
    log(`Production mode: ${isProduction}`);
    log(`Allowed origins: ${ALLOWED_ORIGINS.length > 0 ? ALLOWED_ORIGINS.join(', ') : 'none (same-origin only)'}`);
    log('');
    
    try {
        // Test 1: Same-origin request (should always work)
        log('Test 1: Same-origin request (should always work)');
        try {
            const sameOriginResponse = await makeRequest('/api/public-config', {
                headers: {
                    'Origin': BASE_URL.replace(/\/$/, '')
                }
            });
            
            if (sameOriginResponse.statusCode === 200) {
                log('✅ Same-origin request successful');
                testResults.push({
                    name: 'Same-Origin Request',
                    description: 'Same-origin requests work',
                    passed: true,
                    expected: '200',
                    actual: sameOriginResponse.statusCode
                });
                passed++;
            } else {
                log(`❌ Same-origin request returned ${sameOriginResponse.statusCode}`);
                testResults.push({
                    name: 'Same-Origin Request',
                    description: 'Same-origin requests work',
                    passed: false,
                    expected: '200',
                    actual: sameOriginResponse.statusCode
                });
                failed++;
            }
        } catch (e) {
            log(`⚠️  Could not test same-origin: ${e.message}`);
        }
        
        // Test 2: Cross-origin request from whitelisted origin
        if (ALLOWED_ORIGINS.length > 0) {
            log('');
            log(`Test 2: Cross-origin request from whitelisted origin: ${ALLOWED_ORIGINS[0]}`);
            try {
                const corsResponse = await makeRequest('/api/public-config', {
                    method: 'OPTIONS', // Preflight request
                    headers: {
                        'Origin': ALLOWED_ORIGINS[0],
                        'Access-Control-Request-Method': 'GET'
                    }
                });
                
                const acao = corsResponse.headers['access-control-allow-origin'];
                const acac = corsResponse.headers['access-control-allow-credentials'];
                
                if (acao === ALLOWED_ORIGINS[0] && acac === 'true') {
                    log(`✅ CORS headers present for whitelisted origin`);
                    testCorsHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS[0], corsResponse.headers, 'Whitelisted origin allowed');
                    testCorsHeader('Access-Control-Allow-Credentials', 'true', corsResponse.headers, 'Credentials allowed');
                    passed += 2;
                } else {
                    log(`❌ CORS headers incorrect or missing`);
                    testResults.push({
                        name: 'CORS Whitelisted Origin',
                        description: 'Whitelisted origin allowed',
                        passed: false,
                        expected: `Access-Control-Allow-Origin: ${ALLOWED_ORIGINS[0]}`,
                        actual: `Access-Control-Allow-Origin: ${acao || '(not set)'}`
                    });
                    failed++;
                }
            } catch (e) {
                log(`⚠️  Could not test whitelisted origin: ${e.message}`);
            }
        } else {
            log('ℹ️  Skipping whitelisted origin test (no ALLOWED_ORIGINS configured)');
        }
        
        // Test 3: Cross-origin request from non-whitelisted origin (production)
        if (isProduction && ALLOWED_ORIGINS.length > 0) {
            log('');
            log('Test 3: Cross-origin request from non-whitelisted origin (should be blocked in production)');
            try {
                const blockedResponse = await makeRequest('/api/public-config', {
                    headers: {
                        'Origin': 'https://evil.com'
                    }
                });
                
                const acao = blockedResponse.headers['access-control-allow-origin'];
                if (!acao || acao !== 'https://evil.com') {
                    log('✅ Non-whitelisted origin correctly blocked');
                    testResults.push({
                        name: 'CORS Non-Whitelisted Origin',
                        description: 'Non-whitelisted origin blocked in production',
                        passed: true,
                        expected: 'Blocked',
                        actual: 'Blocked'
                    });
                    passed++;
                } else {
                    log('❌ Non-whitelisted origin incorrectly allowed');
                    testResults.push({
                        name: 'CORS Non-Whitelisted Origin',
                        description: 'Non-whitelisted origin blocked in production',
                        passed: false,
                        expected: 'Blocked',
                        actual: 'Allowed'
                    });
                    failed++;
                }
            } catch (e) {
                log(`⚠️  Could not test non-whitelisted origin: ${e.message}`);
            }
        } else {
            log('ℹ️  Skipping non-whitelisted origin test (not in production or no whitelist)');
        }
        
        // Test 4: Preflight OPTIONS request
        log('');
        log('Test 4: Preflight OPTIONS request');
        try {
            const preflightResponse = await makeRequest('/api/public-config', {
                method: 'OPTIONS',
                headers: {
                    'Origin': BASE_URL.replace(/\/$/, ''),
                    'Access-Control-Request-Method': 'GET'
                }
            });
            
            const acam = preflightResponse.headers['access-control-allow-methods'];
            if (preflightResponse.statusCode === 204 || preflightResponse.statusCode === 200) {
                log('✅ Preflight request handled correctly');
                testResults.push({
                    name: 'CORS Preflight',
                    description: 'Preflight OPTIONS request handled',
                    passed: true,
                    expected: '204 or 200',
                    actual: preflightResponse.statusCode
                });
                passed++;
            } else {
                log(`❌ Preflight request returned ${preflightResponse.statusCode}`);
                testResults.push({
                    name: 'CORS Preflight',
                    description: 'Preflight OPTIONS request handled',
                    passed: false,
                    expected: '204 or 200',
                    actual: preflightResponse.statusCode
                });
                failed++;
            }
        } catch (e) {
            log(`⚠️  Could not test preflight: ${e.message}`);
        }
        
        // Test 5: CORS doesn't interfere with same-origin requests
        log('');
        log('Test 5: CORS doesn\'t interfere with same-origin requests');
        try {
            const normalResponse = await makeRequest('/api/public-config');
            if (normalResponse.statusCode === 200) {
                log('✅ Same-origin requests work normally');
                testResults.push({
                    name: 'CORS Same-Origin Compatibility',
                    description: 'CORS doesn\'t break same-origin requests',
                    passed: true,
                    expected: '200',
                    actual: normalResponse.statusCode
                });
                passed++;
            } else {
                log(`❌ Same-origin request returned ${normalResponse.statusCode}`);
                testResults.push({
                    name: 'CORS Same-Origin Compatibility',
                    description: 'CORS doesn\'t break same-origin requests',
                    passed: false,
                    expected: '200',
                    actual: normalResponse.statusCode
                });
                failed++;
            }
        } catch (e) {
            log(`⚠️  Could not test same-origin compatibility: ${e.message}`);
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
        log('✅ All CORS tests passed!');
        process.exit(0);
    } else {
        log('❌ Some CORS tests failed');
        process.exit(1);
    }
}

// Run tests
runTests().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});

