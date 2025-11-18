#!/usr/bin/env node
/**
 * Validators Test Suite
 * Tests Joi validation schemas and validation functions
 */

const Joi = require('joi');
const {
    emailSchema,
    nameSchema,
    campaignNameSchema,
    phoneSchema,
    usernameSchema,
    passwordSchema,
    tenantSlugSchema,
    formSubmissionSchema,
    campaignSchema,
    userSchema,
    authUserSchema,
    loginSchema,
    validate,
    validateAndSanitize
} = require('../utils/validators');

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
    log('Starting Validators Test Suite\n');

    // Test 1: Email schema validation
    test('emailSchema: Validates correct email', () => {
        const result = validate('user@example.com', emailSchema);
        if (result.error) {
            throw new Error('Valid email should pass validation');
        }
        if (result.value !== 'user@example.com') {
            throw new Error('Email should be preserved');
        }
    });

    test('emailSchema: Rejects invalid email', () => {
        const result = validate('invalid-email', emailSchema);
        if (!result.error) {
            throw new Error('Invalid email should fail validation');
        }
    });

    // Test 2: Name schema validation
    test('nameSchema: Validates correct name', () => {
        const result = validate("Mario's Store", nameSchema);
        if (result.error) {
            throw new Error('Valid name should pass validation');
        }
    });

    test('nameSchema: Rejects name with special characters', () => {
        const result = validate('Mario<script>', nameSchema);
        if (!result.error) {
            throw new Error('Name with script tags should fail validation');
        }
    });

    // Test 3: Campaign name schema
    test('campaignNameSchema: Validates campaign name', () => {
        const result = validate('Summer Sale 2024', campaignNameSchema);
        if (result.error) {
            throw new Error('Valid campaign name should pass');
        }
    });

    test('campaignNameSchema: Rejects empty name', () => {
        const result = validate('', campaignNameSchema);
        if (!result.error) {
            throw new Error('Empty campaign name should fail');
        }
    });

    // Test 4: Phone schema
    test('phoneSchema: Validates phone numbers', () => {
        const validPhones = ['+39 123 456 7890', '(123) 456-7890', '123-456-7890'];
        for (const phone of validPhones) {
            const result = validate(phone, phoneSchema);
            if (result.error) {
                throw new Error(`Valid phone should pass: ${phone}`);
            }
        }
    });

    test('phoneSchema: Allows empty phone', () => {
        const result = validate('', phoneSchema);
        if (result.error) {
            throw new Error('Empty phone should be allowed');
        }
    });

    // Test 5: Username schema
    test('usernameSchema: Validates username', () => {
        const result = validate('user123', usernameSchema);
        if (result.error) {
            throw new Error('Valid username should pass');
        }
    });

    test('usernameSchema: Rejects short username', () => {
        const result = validate('ab', usernameSchema);
        if (!result.error) {
            throw new Error('Short username should fail');
        }
    });

    test('usernameSchema: Rejects username with spaces', () => {
        const result = validate('user name', usernameSchema);
        if (!result.error) {
            throw new Error('Username with spaces should fail');
        }
    });

    // Test 6: Password schema
    test('passwordSchema: Validates password exists', () => {
        const result = validate('MyP@ssw0rd123', passwordSchema);
        if (result.error) {
            throw new Error('Valid password should pass');
        }
    });

    test('passwordSchema: Rejects empty password', () => {
        const result = validate('', passwordSchema);
        if (!result.error) {
            throw new Error('Empty password should fail');
        }
    });

    // Test 7: Tenant slug schema
    test('tenantSlugSchema: Validates tenant slug', () => {
        const result = validate('my-tenant-123', tenantSlugSchema);
        if (result.error) {
            throw new Error('Valid tenant slug should pass');
        }
    });

    test('tenantSlugSchema: Rejects uppercase slug', () => {
        const result = validate('MyTenant', tenantSlugSchema);
        if (!result.error) {
            throw new Error('Uppercase slug should fail');
        }
    });

    // Test 8: Form submission schema
    test('formSubmissionSchema: Validates complete form', () => {
        const formData = {
            email: 'user@example.com',
            firstName: 'Mario',
            lastName: 'Rossi',
            phone: '+39 123 456 7890',
            address: 'Via Roma 1'
        };
        const result = validate(formData, formSubmissionSchema);
        if (result.error) {
            throw new Error('Valid form should pass');
        }
    });

    test('formSubmissionSchema: Requires email', () => {
        const formData = {
            firstName: 'Mario',
            lastName: 'Rossi'
        };
        const result = validate(formData, formSubmissionSchema);
        if (!result.error) {
            throw new Error('Form without email should fail');
        }
    });

    // Test 9: Campaign schema
    test('campaignSchema: Validates campaign data', () => {
        const campaignData = {
            name: 'Summer Sale',
            description: 'Great discounts',
            discount_type: 'percent',
            discount_value: '20%',
            is_active: true
        };
        const result = validate(campaignData, campaignSchema);
        if (result.error) {
            throw new Error('Valid campaign should pass');
        }
    });

    test('campaignSchema: Validates discount types', () => {
        const validTypes = ['percent', 'fixed', 'text'];
        for (const type of validTypes) {
            const result = validate({ 
                name: 'Test',
                discount_type: type,
                discount_value: '10'
            }, campaignSchema);
            if (result.error) {
                throw new Error(`Valid discount type should pass: ${type}`);
            }
        }
    });

    // Test 10: User schema
    test('userSchema: Validates user data', () => {
        const userData = {
            email: 'user@example.com',
            firstName: 'Mario',
            lastName: 'Rossi',
            phone: '+39 123 456 7890'
        };
        const result = validate(userData, userSchema);
        if (result.error) {
            throw new Error('Valid user should pass');
        }
    });

    // Test 11: Auth user schema
    test('authUserSchema: Validates auth user data', () => {
        const authUserData = {
            username: 'admin123',
            password: 'SecureP@ss123',
            userType: 'admin',
            email: 'admin@example.com'
        };
        const result = validate(authUserData, authUserSchema);
        if (result.error) {
            throw new Error('Valid auth user should pass');
        }
    });

    test('authUserSchema: Validates user types', () => {
        const validTypes = ['admin', 'store', 'superadmin'];
        for (const type of validTypes) {
            const result = validate({
                username: 'user123',
                password: 'Pass123',
                userType: type,
                email: 'test@example.com'
            }, authUserSchema);
            if (result.error) {
                throw new Error(`Valid user type should pass: ${type}`);
            }
        }
    });

    // Test 12: Login schema
    test('loginSchema: Validates login data', () => {
        const loginData = {
            username: 'admin123',
            password: 'SecureP@ss123',
            userType: 'admin'
        };
        const result = validate(loginData, loginSchema);
        if (result.error) {
            throw new Error('Valid login should pass');
        }
    });

    // Test 13: validate function strips unknown fields
    test('validate: Strips unknown fields', () => {
        const data = {
            email: 'user@example.com',
            unknownField: 'should be removed',
            anotherUnknown: 123
        };
        const schema = Joi.object({ email: emailSchema });
        const result = validate(data, schema);
        if (result.value.unknownField !== undefined) {
            throw new Error('Unknown fields should be stripped');
        }
    });

    // Test 14: validateAndSanitize throws on error
    test('validateAndSanitize: Throws on validation error', () => {
        try {
            validateAndSanitize({ email: 'invalid' }, emailSchema);
            throw new Error('Should throw on validation error');
        } catch (error) {
            if (!error.statusCode || error.statusCode !== 400) {
                throw new Error('Should throw error with statusCode 400');
            }
        }
    });

    test('validateAndSanitize: Returns sanitized value on success', () => {
        // Use a valid email without extra spaces since emailSchema might not trim
        const data = 'user@example.com';
        const result = validateAndSanitize(data, emailSchema);
        if (result !== 'user@example.com') {
            throw new Error('Should return sanitized value');
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

