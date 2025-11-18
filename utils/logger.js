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

/**
 * Audit logging helper for CRUD operations and sensitive actions.
 * 
 * Provides a convenient wrapper around logAction() for audit trail purposes.
 * Logs all CRUD operations (Create, Read, Update, Delete) and access to sensitive data.
 * 
 * @param {ExpressRequest} req - Express request object
 * @param {string} actionType - Type of action (e.g., 'create', 'update', 'delete', 'read', 'access')
 * @param {string} resourceType - Type of resource (e.g., 'campaign', 'user', 'coupon')
 * @param {string|number} [resourceId] - ID of the resource (optional)
 * @param {string} [actionDescription] - Human-readable description (auto-generated if not provided)
 * @param {Object} [details] - Additional details object (will be JSON stringified)
 * @param {string} [level='info'] - Log level ('info', 'success', 'warning', 'error')
 * @returns {Promise<void>}
 * 
 * @example
 * // Log creation
 * await auditLog(req, 'create', 'campaign', campaignId, 'Campaign created', { name: 'Summer Sale' });
 * 
 * @example
 * // Log update
 * await auditLog(req, 'update', 'user', userId, 'User updated', { fields: ['email', 'firstName'] });
 * 
 * @example
 * // Log deletion
 * await auditLog(req, 'delete', 'coupon', couponId, 'Coupon deleted');
 * 
 * @example
 * // Log access to sensitive data
 * await auditLog(req, 'access', 'users', null, 'User list accessed', { filter: 'active' }, 'info');
 * 
 * @description
 * This function:
 * 1. Extracts user and tenant context from request
 * 2. Generates action description if not provided
 * 3. Logs to system_logs table via logAction()
 * 4. Also logs to pino logger for immediate visibility
 * 
 * Action types:
 * - 'create' - Resource created
 * - 'update' - Resource updated
 * - 'delete' - Resource deleted
 * - 'read' - Resource read (for sensitive data)
 * - 'access' - Access to sensitive endpoint/data
 * 
 * @see {@link logAction} For the underlying logging function
 * @see {@link LLM_MD/TYPES.md} For ExpressRequest type definition
 */
async function auditLog(req, actionType, resourceType, resourceId, actionDescription, details, level = 'info') {
    const { logAction } = require('../routes/auth');
    
    // Generate description if not provided
    if (!actionDescription) {
        const resourceIdStr = resourceId ? ` #${resourceId}` : '';
        const actionMap = {
            'create': 'created',
            'update': 'updated',
            'delete': 'deleted',
            'read': 'read',
            'access': 'accessed'
        };
        actionDescription = `${resourceType}${resourceIdStr} ${actionMap[actionType] || actionType}`;
    }
    
    // Log to database via logAction
    await logAction(req, actionType, actionDescription, level, {
        resourceType,
        resourceId: resourceId || null,
        ...details
    });
    
    // Also log to pino for immediate visibility
    const logContext = logger.withRequest(req);
    logContext[level === 'error' ? 'error' : level === 'warning' ? 'warn' : 'info']({
        actionType,
        resourceType,
        resourceId,
        details
    }, `Audit: ${actionDescription}`);
}

module.exports = logger;
module.exports.auditLog = auditLog;

