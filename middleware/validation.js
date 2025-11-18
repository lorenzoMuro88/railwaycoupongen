'use strict';

/**
 * Validation Middleware
 * 
 * Express middleware for validating request data using Joi schemas.
 * Automatically validates request body, query, and params against provided schemas.
 * 
 * @module middleware/validation
 */

const { validate } = require('../utils/validators');
const logger = require('../utils/logger');

/**
 * Create validation middleware for request body
 * 
 * @param {Joi.Schema} schema - Joi validation schema
 * @param {Object} options - Validation options
 * @returns {Function} Express middleware function
 * 
 * @example
 * const { formSubmissionSchema } = require('../utils/validators');
 * app.post('/submit', validateBody(formSubmissionSchema), handler);
 */
function validateBody(schema, options = {}) {
    return (req, res, next) => {
        const result = validate(req.body || {}, schema, options);
        
        if (result.error) {
            const errorMessages = result.error.details.map(detail => detail.message).join(', ');
            logger.warn({ 
                validationErrors: result.error.details,
                body: req.body 
            }, 'Validation failed for request body');
            
            return res.status(400).json({ 
                error: 'Dati non validi',
                details: errorMessages,
                fields: result.error.details.map(d => ({
                    field: d.path.join('.'),
                    message: d.message
                }))
            });
        }
        
        // Replace req.body with validated and sanitized data
        req.body = result.value;
        next();
    };
}

/**
 * Create validation middleware for request query parameters
 * 
 * @param {Joi.Schema} schema - Joi validation schema
 * @param {Object} options - Validation options
 * @returns {Function} Express middleware function
 * 
 * @example
 * const { Joi } = require('joi');
 * const querySchema = Joi.object({ page: Joi.number().integer().min(1) });
 * app.get('/items', validateQuery(querySchema), handler);
 */
function validateQuery(schema, options = {}) {
    return (req, res, next) => {
        const result = validate(req.query || {}, schema, options);
        
        if (result.error) {
            const errorMessages = result.error.details.map(detail => detail.message).join(', ');
            logger.warn({ 
                validationErrors: result.error.details,
                query: req.query 
            }, 'Validation failed for query parameters');
            
            return res.status(400).json({ 
                error: 'Parametri query non validi',
                details: errorMessages
            });
        }
        
        // Replace req.query with validated and sanitized data
        req.query = result.value;
        next();
    };
}

/**
 * Create validation middleware for URL parameters
 * 
 * @param {Joi.Schema} schema - Joi validation schema
 * @param {Object} options - Validation options
 * @returns {Function} Express middleware function
 * 
 * @example
 * const { tenantSlugSchema } = require('../utils/validators');
 * app.get('/t/:tenantSlug', validateParams(Joi.object({ tenantSlug: tenantSlugSchema })), handler);
 */
function validateParams(schema, options = {}) {
    return (req, res, next) => {
        const result = validate(req.params || {}, schema, options);
        
        if (result.error) {
            const errorMessages = result.error.details.map(detail => detail.message).join(', ');
            logger.warn({ 
                validationErrors: result.error.details,
                params: req.params 
            }, 'Validation failed for URL parameters');
            
            return res.status(400).json({ 
                error: 'Parametri URL non validi',
                details: errorMessages
            });
        }
        
        // Replace req.params with validated and sanitized data
        req.params = result.value;
        next();
    };
}

module.exports = {
    validateBody,
    validateQuery,
    validateParams
};

