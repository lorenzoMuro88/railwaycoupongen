'use strict';

/**
 * CORS (Cross-Origin Resource Sharing) Configuration Middleware
 * 
 * Configures CORS headers to allow cross-origin requests from whitelisted domains.
 * By default, only same-origin requests are allowed. Configure ALLOWED_ORIGINS
 * environment variable to allow specific domains.
 * 
 * @module middleware/cors
 */

const cors = require('cors');
const logger = require('../utils/logger');

// Get allowed origins from environment variable
// Format: comma-separated list of origins, e.g., "https://example.com,https://app.example.com"
const ALLOWED_ORIGINS_STR = process.env.ALLOWED_ORIGINS || '';
const ALLOWED_ORIGINS = ALLOWED_ORIGINS_STR
    .split(',')
    .map(origin => origin.trim())
    .filter(origin => origin.length > 0);

// Default CORS configuration: only same-origin allowed
const corsOptions = {
    origin: function (origin, callback) {
        // Allow requests with no origin (mobile apps, Postman, etc.) - be careful in production
        if (!origin) {
            // In production, you might want to reject requests without origin
            // For now, we allow them but log a warning
            if (process.env.NODE_ENV === 'production') {
                logger.warn({ origin: 'none' }, 'CORS: Request without origin in production');
            }
            return callback(null, true);
        }
        
        // Always allow same-origin requests (when origin matches the request host)
        // This is handled by checking if origin matches any of the allowed origins
        // or if it's a same-origin request (no origin header means same-origin, but we already handled that above)
        
        // If no allowed origins configured, only allow same-origin
        if (ALLOWED_ORIGINS.length === 0) {
            // In development, allow all origins for easier testing
            if (process.env.NODE_ENV !== 'production') {
                return callback(null, true);
            }
            // In production, reject cross-origin requests if no whitelist configured
            logger.warn({ origin }, 'CORS: Cross-origin request rejected (no ALLOWED_ORIGINS configured)');
            return callback(new Error('CORS: Origin not allowed'));
        }
        
        // Check if origin is in whitelist
        if (ALLOWED_ORIGINS.includes(origin)) {
            callback(null, true);
        } else {
            logger.warn({ origin, allowedOrigins: ALLOWED_ORIGINS }, 'CORS: Origin not in whitelist');
            callback(new Error('CORS: Origin not allowed'));
        }
    },
    credentials: true, // Allow cookies and authentication headers
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-Requested-With'],
    exposedHeaders: ['X-CSRF-Token'],
    maxAge: 86400 // 24 hours
};

/**
 * CORS middleware configured with whitelist
 * 
 * @type {Function}
 * 
 * @example
 * // In server.js
 * const { corsMiddleware } = require('./middleware/cors');
 * app.use(corsMiddleware);
 * 
 * @description
 * - Allows same-origin requests always
 * - In development: Allows all origins (for easier testing)
 * - In production: Only allows origins in ALLOWED_ORIGINS env variable
 * - Supports credentials (cookies, auth headers)
 * - Preflight requests (OPTIONS) are handled automatically
 */
const corsMiddleware = cors(corsOptions);

module.exports = {
    corsMiddleware,
    corsOptions
};

