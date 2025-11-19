#!/usr/bin/env node
/**
 * Email Utilities Test Suite
 * Tests email utility functions
 */

const { parseMailFrom, buildTenantEmailFrom } = require('../utils/email');

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
    log('Starting Email Utilities Test Suite\n');

    // Test 1: parseMailFrom with name and email
    test('parseMailFrom: Parses name and email', () => {
        const result = parseMailFrom("Mario's Store <noreply@example.com>");
        if (result.name !== "Mario's Store") {
            throw new Error(`Expected "Mario's Store", got ${result.name}`);
        }
        if (result.address !== 'noreply@example.com') {
            throw new Error(`Expected noreply@example.com, got ${result.address}`);
        }
    });

    // Test 2: parseMailFrom with email only
    test('parseMailFrom: Parses email only', () => {
        const result = parseMailFrom('noreply@example.com');
        if (result.name !== null) {
            throw new Error(`Expected null name, got ${result.name}`);
        }
        if (result.address !== 'noreply@example.com') {
            throw new Error(`Expected noreply@example.com, got ${result.address}`);
        }
    });

    // Test 3: parseMailFrom with quoted name
    test('parseMailFrom: Parses quoted name', () => {
        const result = parseMailFrom('"Mario Store" <noreply@example.com>');
        if (result.name !== 'Mario Store') {
            throw new Error(`Expected "Mario Store", got ${result.name}`);
        }
        if (result.address !== 'noreply@example.com') {
            throw new Error(`Expected noreply@example.com, got ${result.address}`);
        }
    });

    // Test 4: parseMailFrom handles null/undefined
    test('parseMailFrom: Handles null and undefined', () => {
        const result1 = parseMailFrom(null);
        if (result1.name !== null || result1.address !== null) {
            throw new Error('null should return null name and address');
        }
        
        const result2 = parseMailFrom(undefined);
        if (result2.name !== null || result2.address !== null) {
            throw new Error('undefined should return null name and address');
        }
    });

    // Test 5: parseMailFrom handles empty string
    test('parseMailFrom: Handles empty string', () => {
        const result = parseMailFrom('');
        if (result.name !== null || result.address !== null) {
            throw new Error('Empty string should return null name and address');
        }
    });

    // Test 6: parseMailFrom trims whitespace
    test('parseMailFrom: Trims whitespace', () => {
        const result = parseMailFrom('  noreply@example.com  ');
        if (result.address !== 'noreply@example.com') {
            throw new Error('Should trim whitespace');
        }
    });

    // Test 7: buildTenantEmailFrom function exists
    test('buildTenantEmailFrom: Function exists', () => {
        if (typeof buildTenantEmailFrom !== 'function') {
            throw new Error('buildTenantEmailFrom should be a function');
        }
    });

    // Test 8: buildTenantEmailFrom with tenant having email_from_name
    test('buildTenantEmailFrom: Uses tenant email_from_name', () => {
        const tenant = {
            email_from_name: "Mario's Store",
            email_from_address: null
        };
        const result = buildTenantEmailFrom(tenant);
        
        if (!result || typeof result !== 'string') {
            throw new Error('Should return a string');
        }
        if (!result.includes("Mario's Store")) {
            throw new Error('Should include tenant email_from_name');
        }
    });

    // Test 9: buildTenantEmailFrom with tenant having email_from_address
    test('buildTenantEmailFrom: Uses tenant email_from_address', () => {
        const tenant = {
            email_from_name: "Mario's Store",
            email_from_address: 'custom@example.com'
        };
        const result = buildTenantEmailFrom(tenant);
        
        if (!result.includes('custom@example.com')) {
            throw new Error('Should use tenant email_from_address');
        }
    });

    // Test 10: buildTenantEmailFrom with null tenant
    test('buildTenantEmailFrom: Handles null tenant', () => {
        const result = buildTenantEmailFrom(null);
        
        if (!result || typeof result !== 'string') {
            throw new Error('Should return default email format');
        }
    });

    // Test 11: buildTenantEmailFrom with tenant without email config
    test('buildTenantEmailFrom: Handles tenant without email config', () => {
        const tenant = {
            name: 'Test Tenant'
        };
        const result = buildTenantEmailFrom(tenant);
        
        if (!result || typeof result !== 'string') {
            throw new Error('Should return email format even without email config');
        }
    });

    // Test 12: buildTenantEmailFrom formats correctly
    test('buildTenantEmailFrom: Formats email correctly', () => {
        const tenant = {
            email_from_name: 'Test Store',
            email_from_address: 'test@example.com'
        };
        const result = buildTenantEmailFrom(tenant);
        
        // Should be in format "Name <email>" or just "email"
        if (!result.includes('test@example.com')) {
            throw new Error('Should include email address');
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


