'use strict';

const pino = require('pino');
const crypto = require('crypto');

// Create logger instance
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

// Add request context helper
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

