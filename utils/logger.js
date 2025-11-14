'use strict';

const pino = require('pino');
const crypto = require('crypto');

/**
 * Structured logger instance using pino.
 * 
 * Provides structured logging with different output formats:
 * - Development: Pretty-printed colored output (pino-pretty)
 * - Production: JSON output for log aggregation tools
 * 
 * Log levels: debug, info, warn, error
 * 
 * @type {pino.Logger}
 * 
 * @example
 * // Basic logging
 * logger.info('Server started');
 * logger.error({ err }, 'Database error');
 * 
 * @example
 * // With context
 * logger.info({ userId: 1, action: 'login' }, 'User logged in');
 * 
 * @example
 * // With request context (preferred)
 * const logContext = logger.withRequest(req);
 * logContext.info('Processing request');
 * logContext.error({ err }, 'Request failed');
 * 
 * @description
 * Configuration:
 * - Level: Controlled by LOG_LEVEL env variable (default: 'info')
 * - Development: Pretty output with colors
 * - Production: JSON output (structured logs)
 * - Timestamps: ISO format
 * 
 * @see {@link logger.withRequest} For request-scoped logging
 */
const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    transport: process.env.NODE_ENV === 'development' 
        ? {
            target: 'pino-pretty',
            options: {
                colorize: true,
                translateTime: 'SYS:standard',
                ignore: 'pid,hostname'
            }
        }
        : undefined, // In production, use default JSON output
    formatters: {
        level: (label) => {
            return { level: label.toUpperCase() };
        }
    },
    timestamp: pino.stdTimeFunctions.isoTime
});

/**
 * Create logger instance with request context.
 * 
 * Returns a child logger instance enriched with request-specific context:
 * - requestId: Unique request ID (from req.id, x-request-id header, or generated)
 * - tenant: Tenant slug (from req.tenant or req.session.user)
 * - method: HTTP method
 * - path: Request path
 * - ip: Client IP address
 * 
 * @param {ExpressRequest} req - Express request object
 * @returns {pino.Logger} Child logger instance with request context
 * 
 * @example
 * // In route handler
 * app.get('/api/campaigns', async (req, res) => {
 *     const log = logger.withRequest(req);
 *     log.info('Fetching campaigns');
 *     // Logs include: { requestId, tenant, method, path, ip, ... }
 * });
 * 
 * @example
 * // Error logging with context
 * try {
 *     // ... code
 * } catch (err) {
 *     logger.withRequest(req).error({ err }, 'Request failed');
 *     // Logs include full request context for debugging
 * }
 * 
 * @description
 * Request ID resolution order:
 * 1. req.id (if set by middleware)
 * 2. x-request-id header
 * 3. Generated UUID
 * 
 * Tenant resolution order:
 * 1. req.tenant.slug (if tenantLoader executed)
 * 2. req.session.user.tenantSlug (if authenticated)
 * 3. 'unknown'
 * 
 * @see {@link LLM_MD/TYPES.md} For ExpressRequest type definition
 */
logger.withRequest = (req) => {
    const requestId = req.id || req.headers['x-request-id'] || crypto.randomUUID();
    const tenant = req.tenant?.slug || req.session?.user?.tenantSlug || 'unknown';
    
    return logger.child({
        requestId,
        tenant,
        method: req.method,
        path: req.path,
        ip: req.ip
    });
};

module.exports = logger;

