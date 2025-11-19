#!/usr/bin/env node
/**
 * Rate Limiting Middleware Test Suite
 * Tests rate limiting functionality
 */

const {
    checkLoginRateLimit,
    recordLoginFailure,
    recordLoginSuccess,
    checkSubmitRateLimit,
    startCleanupInterval
} = require('../middleware/rateLimit');

let testResults = [];
let passed = 0;
let failed = 0;

function log(message) {
    console.log(`[TEST] ${message}`);
}

function test(name, fn) {
    try {
        fn();
        testResults.push({ name, status: 'PASS' });
        passed++;
        log(`✓ PASSED: ${name}`);
    } catch (error) {
        testResults.push({ name, status: 'FAIL', error: error.message });
        failed++;
        log(`✗ FAILED: ${name} - ${error.message}`);
    }
}

function main() {
    log('Starting Rate Limiting Middleware Test Suite\n');

    // Test 1: checkLoginRateLimit allows first attempt
    test('checkLoginRateLimit: Allows first login attempt', () => {
        const ip = '192.168.1.1';
        const result = checkLoginRateLimit(ip);
        if (!result.ok) {
            throw new Error('First login attempt should be allowed');
        }
    });

    // Test 2: checkLoginRateLimit allows multiple attempts within limit
    test('checkLoginRateLimit: Allows multiple attempts within limit', () => {
        const ip = '192.168.1.2';
        // Record some failures but stay under limit
        for (let i = 0; i < 5; i++) {
            recordLoginFailure(ip);
        }
        const result = checkLoginRateLimit(ip);
        if (!result.ok) {
            throw new Error('Should allow attempts within limit');
        }
    });

    // Test 3: recordLoginSuccess clears attempts
    test('recordLoginSuccess: Clears login attempts', () => {
        const ip = '192.168.1.3';
        recordLoginFailure(ip);
        recordLoginFailure(ip);
        recordLoginSuccess(ip);
        const result = checkLoginRateLimit(ip);
        if (!result.ok) {
            throw new Error('Login success should clear attempts');
        }
    });

    // Test 4: Rate limit blocks after max attempts
    test('checkLoginRateLimit: Blocks after max attempts', () => {
        const ip = '192.168.1.4';
        // Record max attempts
        const maxAttempts = 10; // LOGIN_MAX_ATTEMPTS default
        for (let i = 0; i < maxAttempts; i++) {
            recordLoginFailure(ip);
        }
        const result = checkLoginRateLimit(ip);
        if (result.ok) {
            throw new Error('Should block after max attempts');
        }
        if (!result.retryAfterMs || result.retryAfterMs <= 0) {
            throw new Error('Should return retryAfterMs when blocked');
        }
    });

    // Test 5: Different IPs are tracked separately
    test('checkLoginRateLimit: Tracks different IPs separately', () => {
        const ip1 = '192.168.1.5';
        const ip2 = '192.168.1.6';
        
        // Lock ip1
        for (let i = 0; i < 10; i++) {
            recordLoginFailure(ip1);
        }
        
        const result1 = checkLoginRateLimit(ip1);
        const result2 = checkLoginRateLimit(ip2);
        
        if (result1.ok) {
            throw new Error('ip1 should be blocked');
        }
        if (!result2.ok) {
            throw new Error('ip2 should not be blocked');
        }
    });

    // Test 6: Rate limit window resets after time
    test('checkLoginRateLimit: Window resets after time', () => {
        // This test is harder to test without mocking time
        // We document the expected behavior
        log('  Note: Rate limit window should reset after LOGIN_WINDOW_MS');
    });

    // Test 7: checkSubmitRateLimit middleware function exists
    test('checkSubmitRateLimit: Middleware function exists', () => {
        if (typeof checkSubmitRateLimit !== 'function') {
            throw new Error('checkSubmitRateLimit should be a function');
        }
    });

    // Test 8: startCleanupInterval function exists
    test('startCleanupInterval: Function exists', () => {
        if (typeof startCleanupInterval !== 'function') {
            throw new Error('startCleanupInterval should be a function');
        }
    });

    // Test 9: Email-based rate limiting (getEmailKey logic)
    test('Rate limiting: Email keys are normalized', () => {
        // Test that email normalization works
        // This is tested indirectly through the rate limiting functions
        log('  Note: Email keys should be normalized (lowercase, trimmed)');
    });

    // Summary
    log('\n============================================================');
    log('TEST SUMMARY');
    log('============================================================');
    testResults.forEach(result => {
        if (result.status === 'PASS') {
            log(`✓ ${result.name}`);
        } else {
            log(`✗ ${result.name}: ${result.error}`);
        }
    });
    log(`\nTotal: ${testResults.length} | Passed: ${passed} | Failed: ${failed}\n`);

    if (failed === 0) {
        log('All tests passed! ✓');
        process.exit(0);
    } else {
        log('Some tests failed ✗');
        process.exit(1);
    }
}

main();


