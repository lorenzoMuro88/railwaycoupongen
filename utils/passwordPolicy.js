'use strict';

/**
 * Password Policy Enforcement
 * 
 * Validates password strength and enforces security requirements.
 * Prevents weak passwords that are vulnerable to brute force attacks.
 * 
 * @module utils/passwordPolicy
 */

const logger = require('./logger');

/**
 * Minimum password length requirement
 */
const MIN_PASSWORD_LENGTH = 12;

/**
 * Common passwords that should be rejected
 * In production, consider loading from external file or database
 */
const COMMON_PASSWORDS = [
    'password',
    'password123',
    '12345678',
    '123456789',
    '1234567890',
    'qwerty',
    'abc123',
    'letmein',
    'welcome',
    'admin',
    'administrator',
    'root',
    'user',
    'test',
    'guest'
];

/**
 * Validate password against policy
 * 
 * Checks password meets all requirements:
 * - Minimum length (12 characters)
 * - Contains uppercase letter
 * - Contains lowercase letter
 * - Contains number
 * - Contains special character
 * - Not in common passwords list
 * 
 * @param {string} password - Password to validate
 * @returns {Object} Validation result
 * @returns {boolean} returns.valid - Whether password meets policy
 * @returns {Array<string>} returns.errors - Array of error messages if invalid
 * 
 * @example
 * const result = validatePassword('MyP@ssw0rd123');
 * if (!result.valid) {
 *     return res.status(400).json({ error: result.errors.join(', ') });
 * }
 */
function validatePassword(password) {
    const errors = [];
    
    if (!password || typeof password !== 'string') {
        return {
            valid: false,
            errors: ['Password richiesta']
        };
    }
    
    // Check minimum length
    if (password.length < MIN_PASSWORD_LENGTH) {
        errors.push(`La password deve contenere almeno ${MIN_PASSWORD_LENGTH} caratteri`);
    }
    
    // Check for uppercase letter
    if (!/[A-Z]/.test(password)) {
        errors.push('La password deve contenere almeno una lettera maiuscola');
    }
    
    // Check for lowercase letter
    if (!/[a-z]/.test(password)) {
        errors.push('La password deve contenere almeno una lettera minuscola');
    }
    
    // Check for number
    if (!/\d/.test(password)) {
        errors.push('La password deve contenere almeno un numero');
    }
    
    // Check for special character
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
        errors.push('La password deve contenere almeno un carattere speciale (!@#$%^&* etc.)');
    }
    
    // Check against common passwords
    const passwordLower = password.toLowerCase();
    if (COMMON_PASSWORDS.includes(passwordLower)) {
        errors.push('La password non può essere una password comune');
    }
    
    // Check for common patterns (e.g., "password123")
    if (COMMON_PASSWORDS.some(common => passwordLower.includes(common))) {
        // Allow if it's part of a longer, complex password
        // Only reject if password is just common password + simple suffix
        const simpleSuffix = /^[0-9]{1,3}$/;
        const withoutCommon = passwordLower.replace(new RegExp(COMMON_PASSWORDS.join('|'), 'g'), '');
        if (withoutCommon.length < 8) {
            errors.push('La password non può essere basata su una password comune');
        }
    }
    
    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Get password policy requirements as human-readable string
 * 
 * @returns {string} Policy requirements description
 */
function getPolicyRequirements() {
    return `La password deve contenere almeno ${MIN_PASSWORD_LENGTH} caratteri, inclusi: una lettera maiuscola, una minuscola, un numero e un carattere speciale.`;
}

/**
 * Check if password needs to be changed (for password rotation)
 * 
 * @param {Date|null} passwordChangedAt - Date when password was last changed
 * @param {number} maxAgeDays - Maximum age in days (default: 90)
 * @returns {boolean} True if password needs to be changed
 */
function needsPasswordChange(passwordChangedAt, maxAgeDays = 90) {
    if (!passwordChangedAt) {
        return true; // Password never changed, force change
    }
    
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
    const ageMs = Date.now() - new Date(passwordChangedAt).getTime();
    
    return ageMs > maxAgeMs;
}

module.exports = {
    validatePassword,
    getPolicyRequirements,
    needsPasswordChange,
    MIN_PASSWORD_LENGTH
};

