'use strict';

/**
 * Input/Output Sanitization Utilities
 * 
 * Functions for sanitizing user input and output to prevent XSS attacks.
 * Server-side sanitization for data before storing or sending to client.
 * 
 * @module utils/sanitize
 */

const escapeHtml = require('escape-html');
const logger = require('./logger');

/**
 * Escape HTML entities in a string to prevent XSS
 * 
 * Converts special HTML characters to their entity equivalents:
 * < → &lt;
 * > → &gt;
 * & → &amp;
 * " → &quot;
 * ' → &#x27;
 * 
 * @param {string} input - String to escape
 * @returns {string} Escaped string safe for HTML output
 * 
 * @example
 * const userInput = '<script>alert("xss")</script>';
 * const safe = escapeHtmlSafe(userInput);
 * // Returns: '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
 */
function escapeHtmlSafe(input) {
    if (input === null || input === undefined) {
        return '';
    }
    return escapeHtml(String(input));
}

/**
 * Sanitize object by escaping all string values
 * 
 * Recursively escapes all string values in an object to prevent XSS.
 * Useful for sanitizing user input before storing in database or sending to client.
 * 
 * @param {Object} obj - Object to sanitize
 * @param {Array<string>} excludeKeys - Keys to exclude from sanitization (optional)
 * @returns {Object} Sanitized object with all string values escaped
 * 
 * @example
 * const userData = { name: '<script>alert("xss")</script>', email: 'user@example.com' };
 * const sanitized = sanitizeObject(userData);
 * // Returns: { name: '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;', email: 'user@example.com' }
 */
function sanitizeObject(obj, excludeKeys = []) {
    if (!obj || typeof obj !== 'object') {
        return obj;
    }
    
    if (Array.isArray(obj)) {
        return obj.map(item => sanitizeObject(item, excludeKeys));
    }
    
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
        if (excludeKeys.includes(key)) {
            sanitized[key] = value; // Don't sanitize excluded keys
        } else if (typeof value === 'string') {
            sanitized[key] = escapeHtmlSafe(value);
        } else if (typeof value === 'object' && value !== null) {
            sanitized[key] = sanitizeObject(value, excludeKeys);
        } else {
            sanitized[key] = value;
        }
    }
    return sanitized;
}

/**
 * Sanitize string for use in HTML attributes
 * 
 * Escapes HTML and also handles quotes for use in HTML attributes.
 * 
 * @param {string} input - String to sanitize
 * @returns {string} Sanitized string safe for HTML attributes
 * 
 * @example
 * const userInput = 'value with "quotes"';
 * const safe = sanitizeForAttribute(userInput);
 * // Safe to use in: <div data-value="${safe}">
 */
function sanitizeForAttribute(input) {
    if (input === null || input === undefined) {
        return '';
    }
    return escapeHtmlSafe(String(input))
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
}

/**
 * Sanitize string for use in JavaScript strings
 * 
 * Escapes special characters for use in JavaScript string literals.
 * 
 * @param {string} input - String to sanitize
 * @returns {string} Sanitized string safe for JavaScript
 * 
 * @example
 * const userInput = "User's name";
 * const safe = sanitizeForJavaScript(userInput);
 * // Safe to use in: const name = "${safe}";
 */
function sanitizeForJavaScript(input) {
    if (input === null || input === undefined) {
        return '';
    }
    return String(input)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t');
}

/**
 * Sanitize text while preserving valid formatting characters
 * 
 * Allows apostrophes and hyphens in names while escaping dangerous characters.
 * Useful for names and addresses.
 * 
 * @param {string} input - String to sanitize
 * @returns {string} Sanitized string
 */
function sanitizeText(input) {
    if (input === null || input === undefined) {
        return '';
    }
    // Escape HTML but allow common text characters
    return escapeHtmlSafe(String(input));
}

/**
 * Sanitize email address (basic - validation should be done separately)
 * 
 * @param {string} email - Email to sanitize
 * @returns {string} Sanitized email
 */
function sanitizeEmail(email) {
    if (!email || typeof email !== 'string') {
        return '';
    }
    // Email validation is done by validators.js
    // Here we just escape HTML to prevent XSS
    return escapeHtmlSafe(email.trim().toLowerCase());
}

/**
 * Sanitize URL to prevent javascript: and data: XSS
 * 
 * @param {string} url - URL to sanitize
 * @returns {string} Sanitized URL or empty string if dangerous
 */
function sanitizeUrl(url) {
    if (!url || typeof url !== 'string') {
        return '';
    }
    
    const trimmed = url.trim().toLowerCase();
    
    // Block dangerous protocols
    if (trimmed.startsWith('javascript:') || 
        trimmed.startsWith('data:') ||
        trimmed.startsWith('vbscript:') ||
        trimmed.startsWith('on')) {
        logger.warn({ url: trimmed }, 'Dangerous URL protocol blocked');
        return '';
    }
    
    // Allow http, https, mailto, tel
    if (trimmed.startsWith('http://') || 
        trimmed.startsWith('https://') ||
        trimmed.startsWith('mailto:') ||
        trimmed.startsWith('tel:')) {
        return escapeHtmlSafe(url);
    }
    
    // Relative URLs are OK
    if (trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../')) {
        return escapeHtmlSafe(url);
    }
    
    // Block everything else
    logger.warn({ url: trimmed }, 'Invalid URL format blocked');
    return '';
}

module.exports = {
    escapeHtmlSafe,
    sanitizeObject,
    sanitizeForAttribute,
    sanitizeForJavaScript,
    sanitizeText,
    sanitizeEmail,
    sanitizeUrl
};

