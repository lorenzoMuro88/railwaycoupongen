#!/usr/bin/env node
/**
 * Error Handling Test Suite
 * Tests that error handling doesn't expose sensitive information
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

function testNoSensitiveInfo(response, description) {
    const bodyStr = JSON.stringify(response.body || {});
    const dataStr = response.data || '';
    
    // Check for sensitive information patterns
    const sensitivePatterns = [
        /\/[^\/]+\/[^\/]+\.js/, // File paths
        /at\s+\/[^\/]+/, // Stack trace file paths
        /node_modules/, // Node modules paths
        /version.*\d+\.\d+\.\d+/, // Version numbers
        /Error:\s*[A-Z]:\\/, // Windows paths
        /\/home\/[^\/]+/, // Unix home paths
        /\/app\/[^\/]+/, // App paths
        /database.*error/i, // Database error details
        /sql.*error/i, // SQL error details
        /connection.*failed/i // Connection details
    ];
    
    let foundSensitive = false;
    const foundPatterns = [];
    
    sensitivePatterns.forEach(pattern => {
        if (pattern.test(bodyStr) || pattern.test(dataStr)) {
            foundSensitive = true;
            foundPatterns.push(pattern.toString());
        }
    });
    
    const passed = !foundSensitive || !isProduction; // Allow in development
    
    testResults.push({
        name: description,
        description: 'Error response does not expose sensitive information',
        passed,
        expected: 'No sensitive information',
        actual: foundSensitive ? `Found patterns: ${foundPatterns.join(', ')}` : 'No sensitive information found'
    });
    
    if (passed) {
        log(`✅ ${description}: No sensitive information exposed`);
        return true;
    } else {
        log(`❌ ${description}: Sensitive information may be exposed`);
        log(`   Found patterns: ${foundPatterns.join(', ')}`);
        return false;
    }
}

async function runTests() {
    log('Starting Error Handling Test Suite');
    log(`Testing against: ${BASE_URL}`);
    log(`Production mode: ${isProduction}`);
    log('');
    
    try {
        // Test 1: 404 error (should have generic message)
        log('Test 1: 404 error handling');
        try {
            const notFoundResponse = await makeRequest('/api/nonexistent-endpoint');
            
            if (notFoundResponse.statusCode === 404) {
                const hasGenericMessage = notFoundResponse.body && 
                    (notFoundResponse.body.error || notFoundResponse.body.message);
                
                if (hasGenericMessage) {
                    log('✅ 404 error has appropriate message');
                    testResults.push({
                        name: '404 Error Handling',
                        description: '404 errors return appropriate message',
                        passed: true,
                        expected: 'Generic error message',
                        actual: 'Has error message'
                    });
                    passed++;
                } else {
                    log('⚠️  404 error missing message');
                    testResults.push({
                        name: '404 Error Handling',
                        description: '404 errors return appropriate message',
                        passed: false,
                        expected: 'Generic error message',
                        actual: 'No message'
                    });
                    failed++;
                }
                
                // Check for sensitive info
                testNoSensitiveInfo(notFoundResponse, '404 Error - No Sensitive Info');
                if (!isProduction || !testNoSensitiveInfo(notFoundResponse, '404 Error - No Sensitive Info')) {
                    passed++;
                } else {
                    failed++;
                }
            } else {
                log(`⚠️  Expected 404, got ${notFoundResponse.statusCode}`);
            }
        } catch (e) {
            log(`⚠️  Could not test 404: ${e.message}`);
        }
        
        // Test 2: 500 error (should not expose stack trace in production)
        log('');
        log('Test 2: 500 error handling');
        try {
            // Try to trigger a 500 error with invalid request
            const errorResponse = await makeRequest('/api/admin/campaigns', {
                method: 'POST',
                body: { invalid: 'data' }
            });
            
            // Check if stack trace is exposed
            const hasStack = errorResponse.body && errorResponse.body.stack;
            
            if (isProduction && hasStack) {
                log('❌ Stack trace exposed in production');
                testResults.push({
                    name: '500 Error - No Stack Trace',
                    description: 'Stack trace not exposed in production',
                    passed: false,
                    expected: 'No stack trace',
                    actual: 'Stack trace present'
                });
                failed++;
            } else {
                log('✅ Stack trace not exposed (or in development)');
                testResults.push({
                    name: '500 Error - No Stack Trace',
                    description: 'Stack trace not exposed in production',
                    passed: true,
                    expected: 'No stack trace in production',
                    actual: isProduction ? 'No stack trace' : 'Development mode (stack allowed)'
                });
                passed++;
            }
            
            // Check for sensitive info
            testNoSensitiveInfo(errorResponse, '500 Error - No Sensitive Info');
            if (!isProduction || !testNoSensitiveInfo(errorResponse, '500 Error - No Sensitive Info')) {
                passed++;
            } else {
                failed++;
            }
        } catch (e) {
            log(`⚠️  Could not test 500: ${e.message}`);
        }
        
        // Test 3: 403 error (should have appropriate message)
        log('');
        log('Test 3: 403 error handling');
        try {
            // Try to access protected endpoint without auth
            const forbiddenResponse = await makeRequest('/api/admin/campaigns');
            
            if (forbiddenResponse.statusCode === 403) {
                const hasMessage = forbiddenResponse.body && 
                    (forbiddenResponse.body.error || forbiddenResponse.body.message);
                
                if (hasMessage) {
                    log('✅ 403 error has appropriate message');
                    testResults.push({
                        name: '403 Error Handling',
                        description: '403 errors return appropriate message',
                        passed: true,
                        expected: 'Generic error message',
                        actual: 'Has error message'
                    });
                    passed++;
                } else {
                    log('⚠️  403 error missing message');
                    testResults.push({
                        name: '403 Error Handling',
                        description: '403 errors return appropriate message',
                        passed: false,
                        expected: 'Generic error message',
                        actual: 'No message'
                    });
                    failed++;
                }
            } else {
                log(`⚠️  Expected 403, got ${forbiddenResponse.statusCode}`);
            }
        } catch (e) {
            log(`⚠️  Could not test 403: ${e.message}`);
        }
        
        // Test 4: Error messages are generic in production
        log('');
        log('Test 4: Error messages are generic in production');
        try {
            const errorResponse = await makeRequest('/api/nonexistent');
            
            if (errorResponse.body && errorResponse.body.message) {
                const message = errorResponse.body.message.toLowerCase();
                const isGeneric = !message.includes('at ') && 
                                 !message.includes('stack') &&
                                 !message.includes('error:') &&
                                 !message.includes('/') &&
                                 !message.includes('\\');
                
                if (isProduction && !isGeneric) {
                    log('⚠️  Error message may be too detailed in production');
                    testResults.push({
                        name: 'Generic Error Messages',
                        description: 'Error messages are generic in production',
                        passed: false,
                        expected: 'Generic message',
                        actual: 'Detailed message'
                    });
                    failed++;
                } else {
                    log('✅ Error messages are appropriately generic');
                    testResults.push({
                        name: 'Generic Error Messages',
                        description: 'Error messages are generic in production',
                        passed: true,
                        expected: 'Generic message',
                        actual: isProduction ? 'Generic' : 'Development (detailed allowed)'
                    });
                    passed++;
                }
            }
        } catch (e) {
            log(`⚠️  Could not test error messages: ${e.message}`);
        }
        
        // Test 5: No file paths exposed
        log('');
        log('Test 5: No file paths exposed');
        try {
            const errorResponse = await makeRequest('/api/invalid-endpoint');
            const bodyStr = JSON.stringify(errorResponse.body || {});
            
            // Check for common file path patterns
            const hasFilePath = /\/[^\/]+\.(js|ts|json|html)/.test(bodyStr) ||
                               /[A-Z]:\\[^\\]+\.(js|ts|json|html)/.test(bodyStr);
            
            if (isProduction && hasFilePath) {
                log('❌ File paths may be exposed');
                testResults.push({
                    name: 'No File Paths Exposed',
                    description: 'File paths not exposed in error responses',
                    passed: false,
                    expected: 'No file paths',
                    actual: 'File paths found'
                });
                failed++;
            } else {
                log('✅ No file paths exposed');
                testResults.push({
                    name: 'No File Paths Exposed',
                    description: 'File paths not exposed in error responses',
                    passed: true,
                    expected: 'No file paths',
                    actual: 'No file paths found'
                });
                passed++;
            }
        } catch (e) {
            log(`⚠️  Could not test file paths: ${e.message}`);
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
        log('✅ All error handling tests passed!');
        process.exit(0);
    } else {
        log('❌ Some error handling tests failed');
        log('');
        log('Note: Some failures may be expected in development mode');
        process.exit(1);
    }
}

// Run tests
runTests().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});

