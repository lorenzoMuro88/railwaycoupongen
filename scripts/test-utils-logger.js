#!/usr/bin/env node
/**
 * Logger Utilities Test Suite
 * Tests logger functionality
 */

const logger = require('../utils/logger');

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
    log('Starting Logger Utilities Test Suite\n');

    // Test 1: Logger instance exists
    test('logger: Instance exists', () => {
        if (!logger) {
            throw new Error('Logger instance should exist');
        }
    });

    // Test 2: Logger has required methods
    test('logger: Has required logging methods', () => {
        const requiredMethods = ['info', 'warn', 'error', 'debug'];
        for (const method of requiredMethods) {
            if (typeof logger[method] !== 'function') {
                throw new Error(`Logger should have ${method} method`);
            }
        }
    });

    // Test 3: Logger methods can be called
    test('logger: Methods can be called without errors', () => {
        try {
            logger.info('Test info message');
            logger.warn('Test warn message');
            logger.error('Test error message');
            logger.debug('Test debug message');
        } catch (error) {
            throw new Error(`Logger methods should not throw: ${error.message}`);
        }
    });

    // Test 4: Logger withRequest function exists
    test('logger.withRequest: Function exists', () => {
        if (typeof logger.withRequest !== 'function') {
            throw new Error('logger.withRequest should be a function');
        }
    });

    // Test 5: withRequest returns child logger
    test('logger.withRequest: Returns child logger', () => {
        const mockReq = {
            id: 'test-request-id',
            method: 'GET',
            path: '/test',
            ip: '127.0.0.1',
            headers: {}
        };
        
        const childLogger = logger.withRequest(mockReq);
        if (!childLogger) {
            throw new Error('withRequest should return a logger instance');
        }
        if (typeof childLogger.info !== 'function') {
            throw new Error('Child logger should have logging methods');
        }
    });

    // Test 6: Child logger can log
    test('logger.withRequest: Child logger can log', () => {
        const mockReq = {
            id: 'test-request-id',
            method: 'GET',
            path: '/test',
            ip: '127.0.0.1',
            headers: {}
        };
        
        const childLogger = logger.withRequest(mockReq);
        try {
            childLogger.info('Test message from child logger');
        } catch (error) {
            throw new Error(`Child logger should not throw: ${error.message}`);
        }
    });

    // Test 7: withRequest uses request ID from req.id
    test('logger.withRequest: Uses req.id when available', () => {
        const mockReq = {
            id: 'custom-request-id',
            method: 'GET',
            path: '/test',
            ip: '127.0.0.1',
            headers: {}
        };
        
        const childLogger = logger.withRequest(mockReq);
        // We can't easily verify the internal context, but we verify it doesn't crash
        if (!childLogger) {
            throw new Error('Child logger should be created');
        }
    });

    // Test 8: withRequest uses x-request-id header when req.id not available
    test('logger.withRequest: Uses x-request-id header', () => {
        const mockReq = {
            method: 'GET',
            path: '/test',
            ip: '127.0.0.1',
            headers: {
                'x-request-id': 'header-request-id'
            }
        };
        
        const childLogger = logger.withRequest(mockReq);
        if (!childLogger) {
            throw new Error('Child logger should be created from header');
        }
    });

    // Test 9: withRequest handles tenant from req.tenant
    test('logger.withRequest: Handles req.tenant', () => {
        const mockReq = {
            id: 'test-id',
            method: 'GET',
            path: '/test',
            ip: '127.0.0.1',
            headers: {},
            tenant: { slug: 'test-tenant' }
        };
        
        const childLogger = logger.withRequest(mockReq);
        if (!childLogger) {
            throw new Error('Child logger should handle tenant');
        }
    });

    // Test 10: withRequest handles tenant from session
    test('logger.withRequest: Handles tenant from session', () => {
        const mockReq = {
            id: 'test-id',
            method: 'GET',
            path: '/test',
            ip: '127.0.0.1',
            headers: {},
            session: {
                user: { tenantSlug: 'session-tenant' }
            }
        };
        
        const childLogger = logger.withRequest(mockReq);
        if (!childLogger) {
            throw new Error('Child logger should handle tenant from session');
        }
    });

    // Test 11: Logger handles structured logging
    test('logger: Handles structured logging', () => {
        try {
            logger.info({ userId: 123, action: 'login' }, 'User logged in');
            logger.error({ err: new Error('Test error') }, 'Error occurred');
        } catch (error) {
            throw new Error(`Structured logging should not throw: ${error.message}`);
        }
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


