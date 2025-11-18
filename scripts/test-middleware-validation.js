#!/usr/bin/env node
/**
 * Validation Middleware Test Suite
 * Tests validation middleware functions
 */

const { validateBody, validateQuery, validateParams } = require('../middleware/validation');
const { emailSchema, nameSchema, tenantSlugSchema } = require('../utils/validators');
const Joi = require('joi');

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
    log('Starting Validation Middleware Test Suite\n');

    // Test 1: validateBody middleware exists
    test('validateBody: Middleware function exists', () => {
        if (typeof validateBody !== 'function') {
            throw new Error('validateBody should be a function');
        }
        const middleware = validateBody(emailSchema);
        if (typeof middleware !== 'function') {
            throw new Error('validateBody should return middleware function');
        }
    });

    // Test 2: validateBody calls next on valid data
    test('validateBody: Calls next on valid data', () => {
        const schema = Joi.object({ email: emailSchema });
        const middleware = validateBody(schema);
        let nextCalled = false;
        const req = { body: { email: 'user@example.com' } };
        const res = {};
        
        middleware(req, res, () => {
            nextCalled = true;
        });
        
        if (!nextCalled) {
            throw new Error('next should be called on valid data');
        }
        if (req.body.email !== 'user@example.com') {
            throw new Error('Valid body should be preserved');
        }
    });

    // Test 3: validateBody returns 400 on invalid data
    test('validateBody: Returns 400 on invalid data', () => {
        const schema = Joi.object({ email: emailSchema });
        const middleware = validateBody(schema);
        let nextCalled = false;
        let statusCode = null;
        let responseData = null;
        
        const req = { body: { email: 'invalid-email' } };
        const res = {
            status: function(code) {
                statusCode = code;
                return this;
            },
            json: function(data) {
                responseData = data;
            }
        };
        
        middleware(req, res, () => {
            nextCalled = true;
        });
        
        if (nextCalled) {
            throw new Error('next should not be called on invalid data');
        }
        if (statusCode !== 400) {
            throw new Error('Should return status 400');
        }
        if (!responseData || !responseData.error) {
            throw new Error('Should return error message');
        }
    });

    // Test 4: validateBody sanitizes data
    test('validateBody: Sanitizes validated data', () => {
        const schema = Joi.object({ email: emailSchema });
        const middleware = validateBody(schema);
        const req = { body: { email: 'user@example.com' } };
        const res = {};
        
        middleware(req, res, () => {});
        
        // Email should be preserved
        if (req.body.email !== 'user@example.com') {
            throw new Error('Email should be preserved');
        }
    });

    // Test 5: validateQuery middleware exists
    test('validateQuery: Middleware function exists', () => {
        if (typeof validateQuery !== 'function') {
            throw new Error('validateQuery should be a function');
        }
        const schema = Joi.object({ page: Joi.number().integer().min(1) });
        const middleware = validateQuery(schema);
        if (typeof middleware !== 'function') {
            throw new Error('validateQuery should return middleware function');
        }
    });

    // Test 6: validateQuery validates query parameters
    test('validateQuery: Validates query parameters', () => {
        const schema = Joi.object({ page: Joi.number().integer().min(1) });
        const middleware = validateQuery(schema);
        let nextCalled = false;
        
        const req = { query: { page: '1' } };
        const res = {};
        
        middleware(req, res, () => {
            nextCalled = true;
        });
        
        if (!nextCalled) {
            throw new Error('next should be called on valid query');
        }
        if (typeof req.query.page !== 'number') {
            throw new Error('Query should be converted to number');
        }
    });

    // Test 7: validateQuery returns 400 on invalid query
    test('validateQuery: Returns 400 on invalid query', () => {
        const schema = Joi.object({ page: Joi.number().integer().min(1) });
        const middleware = validateQuery(schema);
        let statusCode = null;
        
        const req = { query: { page: '0' } };
        const res = {
            status: function(code) {
                statusCode = code;
                return this;
            },
            json: function() {}
        };
        
        middleware(req, res, () => {});
        
        if (statusCode !== 400) {
            throw new Error('Should return status 400 for invalid query');
        }
    });

    // Test 8: validateParams middleware exists
    test('validateParams: Middleware function exists', () => {
        if (typeof validateParams !== 'function') {
            throw new Error('validateParams should be a function');
        }
        const schema = Joi.object({ tenantSlug: tenantSlugSchema });
        const middleware = validateParams(schema);
        if (typeof middleware !== 'function') {
            throw new Error('validateParams should return middleware function');
        }
    });

    // Test 9: validateParams validates URL parameters
    test('validateParams: Validates URL parameters', () => {
        const schema = Joi.object({ tenantSlug: tenantSlugSchema });
        const middleware = validateParams(schema);
        let nextCalled = false;
        
        const req = { params: { tenantSlug: 'my-tenant' } };
        const res = {};
        
        middleware(req, res, () => {
            nextCalled = true;
        });
        
        if (!nextCalled) {
            throw new Error('next should be called on valid params');
        }
    });

    // Test 10: validateParams returns 400 on invalid params
    test('validateParams: Returns 400 on invalid params', () => {
        const schema = Joi.object({ tenantSlug: tenantSlugSchema });
        const middleware = validateParams(schema);
        let statusCode = null;
        
        const req = { params: { tenantSlug: 'Invalid Tenant!' } };
        const res = {
            status: function(code) {
                statusCode = code;
                return this;
            },
            json: function() {}
        };
        
        middleware(req, res, () => {});
        
        if (statusCode !== 400) {
            throw new Error('Should return status 400 for invalid params');
        }
    });

    // Test 11: Middleware handles missing body/query/params
    test('validateBody: Handles missing body', () => {
        const schema = Joi.object({ email: emailSchema });
        const middleware = validateBody(schema);
        let nextCalled = false;
        let statusCode = null;
        
        const req = {}; // No body
        const res = {
            status: function(code) {
                statusCode = code;
                return this;
            },
            json: function() {}
        };
        
        middleware(req, res, () => {
            nextCalled = true;
        });
        
        // Should fail validation since email is required
        if (nextCalled) {
            throw new Error('Should not call next when body is missing required fields');
        }
        if (statusCode !== 400) {
            throw new Error('Should return status 400');
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

