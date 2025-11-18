'use strict';

/**
 * Input Validation Schemas
 * 
 * Centralized validation schemas using Joi for consistent input validation
 * across all routes. These schemas ensure data integrity and prevent injection attacks.
 * 
 * @module utils/validators
 */

const Joi = require('joi');
const logger = require('./logger');

/**
 * Email validation schema
 * 
 * Validates email format using Joi's built-in email validator.
 * 
 * @type {Joi.StringSchema}
 */
const emailSchema = Joi.string()
    .email({ tlds: { allow: false } }) // Allow emails without TLD validation (can be strict if needed)
    .max(255)
    .required()
    .messages({
        'string.email': 'Email non valida',
        'string.max': 'Email troppo lunga (max 255 caratteri)',
        'any.required': 'Email richiesta'
    });

/**
 * Name validation schema (first name, last name)
 * 
 * Validates names: alphanumeric, spaces, apostrophes, hyphens allowed.
 * Prevents injection attacks by rejecting special characters.
 * 
 * @type {Joi.StringSchema}
 */
const nameSchema = Joi.string()
    .trim()
    .min(1)
    .max(100)
    .pattern(/^[a-zA-ZÀ-ÿ\s'-]+$/) // Allow letters, spaces, apostrophes, hyphens
    .messages({
        'string.min': 'Il nome deve contenere almeno 1 carattere',
        'string.max': 'Il nome è troppo lungo (max 100 caratteri)',
        'string.pattern.base': 'Il nome contiene caratteri non validi'
    });

/**
 * Campaign name validation schema
 * 
 * @type {Joi.StringSchema}
 */
const campaignNameSchema = Joi.string()
    .trim()
    .min(1)
    .max(200)
    .required()
    .messages({
        'string.min': 'Il nome della campagna deve contenere almeno 1 carattere',
        'string.max': 'Il nome della campagna è troppo lungo (max 200 caratteri)',
        'any.required': 'Nome campagna richiesto'
    });

/**
 * Campaign description validation schema
 * 
 * @type {Joi.StringSchema}
 */
const campaignDescriptionSchema = Joi.string()
    .trim()
    .max(1000)
    .allow('', null)
    .messages({
        'string.max': 'La descrizione è troppo lunga (max 1000 caratteri)'
    });

/**
 * Discount type validation schema
 * 
 * @type {Joi.StringSchema}
 */
const discountTypeSchema = Joi.string()
    .valid('percent', 'fixed', 'text')
    .default('percent')
    .messages({
        'any.only': 'Tipo sconto non valido (deve essere: percent, fixed, o text)'
    });

/**
 * Discount value validation schema
 * 
 * @type {Joi.StringSchema}
 */
const discountValueSchema = Joi.string()
    .trim()
    .min(1)
    .max(50)
    .required()
    .messages({
        'string.min': 'Valore sconto richiesto',
        'string.max': 'Valore sconto troppo lungo (max 50 caratteri)',
        'any.required': 'Valore sconto richiesto'
    });

/**
 * Phone number validation schema
 * 
 * @type {Joi.StringSchema}
 */
const phoneSchema = Joi.string()
    .trim()
    .pattern(/^[\d\s\-\+\(\)]+$/) // Allow digits, spaces, hyphens, plus, parentheses
    .max(20)
    .allow('', null)
    .messages({
        'string.pattern.base': 'Numero di telefono non valido',
        'string.max': 'Numero di telefono troppo lungo (max 20 caratteri)'
    });

/**
 * Address validation schema
 * 
 * @type {Joi.StringSchema}
 */
const addressSchema = Joi.string()
    .trim()
    .max(500)
    .allow('', null)
    .messages({
        'string.max': 'Indirizzo troppo lungo (max 500 caratteri)'
    });

/**
 * User type validation schema
 * 
 * @type {Joi.StringSchema}
 */
const userTypeSchema = Joi.string()
    .valid('admin', 'store', 'superadmin')
    .required()
    .messages({
        'any.only': 'Tipo utente non valido (deve essere: admin, store, o superadmin)',
        'any.required': 'Tipo utente richiesto'
    });

/**
 * Username validation schema
 * 
 * @type {Joi.StringSchema}
 */
const usernameSchema = Joi.string()
    .trim()
    .min(3)
    .max(50)
    .pattern(/^[a-zA-Z0-9_-]+$/) // Alphanumeric, underscore, hyphen
    .required()
    .messages({
        'string.min': 'Username deve contenere almeno 3 caratteri',
        'string.max': 'Username troppo lungo (max 50 caratteri)',
        'string.pattern.base': 'Username può contenere solo lettere, numeri, underscore e trattini',
        'any.required': 'Username richiesto'
    });

/**
 * Password validation schema (basic - password policy enforced separately)
 * 
 * @type {Joi.StringSchema}
 */
const passwordSchema = Joi.string()
    .min(1)
    .required()
    .messages({
        'string.min': 'Password richiesta',
        'any.required': 'Password richiesta'
    });

/**
 * Tenant slug validation schema
 * 
 * @type {Joi.StringSchema}
 */
const tenantSlugSchema = Joi.string()
    .trim()
    .min(1)
    .max(100)
    .pattern(/^[a-z0-9-]+$/) // Lowercase, numbers, hyphens
    .required()
    .messages({
        'string.min': 'Slug tenant richiesto',
        'string.max': 'Slug tenant troppo lungo (max 100 caratteri)',
        'string.pattern.base': 'Slug tenant può contenere solo lettere minuscole, numeri e trattini',
        'any.required': 'Slug tenant richiesto'
    });

/**
 * Form submission validation schema
 * 
 * Validates form submission data including email, names, and optional fields.
 * 
 * @type {Joi.ObjectSchema}
 */
const formSubmissionSchema = Joi.object({
    email: emailSchema,
    firstName: nameSchema.allow('', null),
    lastName: nameSchema.allow('', null),
    phone: phoneSchema,
    address: addressSchema,
    allergies: Joi.string().trim().max(500).allow('', null),
    campaign_id: Joi.number().integer().positive().allow(null),
    form_token: Joi.string().trim().max(200).allow('', null),
    // Custom fields are validated dynamically based on campaign config
}).unknown(true); // Allow custom fields

/**
 * Campaign creation/update validation schema
 * 
 * @type {Joi.ObjectSchema}
 */
const campaignSchema = Joi.object({
    name: campaignNameSchema,
    description: campaignDescriptionSchema,
    is_active: Joi.boolean().default(false),
    discount_type: discountTypeSchema,
    discount_value: discountValueSchema,
    form_config: Joi.string().allow('', null), // JSON string, validated separately
    expiry_date: Joi.date().iso().allow(null),
    campaign_code: Joi.string().trim().max(50).allow('', null)
});

/**
 * User creation validation schema
 * 
 * @type {Joi.ObjectSchema}
 */
const userSchema = Joi.object({
    email: emailSchema,
    firstName: nameSchema.allow('', null),
    lastName: nameSchema.allow('', null),
    phone: phoneSchema,
    address: addressSchema
});

/**
 * Auth user creation validation schema
 * 
 * @type {Joi.ObjectSchema}
 */
const authUserSchema = Joi.object({
    username: usernameSchema,
    password: passwordSchema,
    userType: userTypeSchema,
    firstName: nameSchema.allow('', null),
    lastName: nameSchema.allow('', null),
    email: emailSchema.allow('', null),
    tenantId: Joi.number().integer().positive().allow(null)
});

/**
 * Login validation schema
 * 
 * @type {Joi.ObjectSchema}
 */
const loginSchema = Joi.object({
    username: usernameSchema,
    password: passwordSchema,
    userType: userTypeSchema
});

/**
 * Validate data against a schema
 * 
 * @param {Object} data - Data to validate
 * @param {Joi.Schema} schema - Joi validation schema
 * @param {Object} options - Validation options
 * @returns {Object} Validation result with { value, error }
 * 
 * @example
 * const result = validate({ email: 'user@example.com' }, emailSchema);
 * if (result.error) {
 *     return res.status(400).json({ error: result.error.details[0].message });
 * }
 */
function validate(data, schema, options = {}) {
    const defaultOptions = {
        abortEarly: false, // Return all errors, not just the first
        stripUnknown: true, // Remove unknown fields
        ...options
    };
    
    const { value, error } = schema.validate(data, defaultOptions);
    
    return { value, error };
}

/**
 * Validate and sanitize input data
 * 
 * Validates input against schema and returns sanitized value.
 * Throws error if validation fails (for use in middleware).
 * 
 * @param {Object} data - Data to validate
 * @param {Joi.Schema} schema - Joi validation schema
 * @param {Object} options - Validation options
 * @returns {Object} Sanitized and validated data
 * @throws {Error} If validation fails
 * 
 * @example
 * try {
 *     const validated = validateAndSanitize(req.body, formSubmissionSchema);
 *     // Use validated data
 * } catch (error) {
 *     return res.status(400).json({ error: error.message });
 * }
 */
function validateAndSanitize(data, schema, options = {}) {
    const result = validate(data, schema, options);
    
    if (result.error) {
        const errorMessages = result.error.details.map(detail => detail.message).join(', ');
        const validationError = new Error(errorMessages);
        validationError.statusCode = 400;
        validationError.details = result.error.details;
        throw validationError;
    }
    
    return result.value;
}

module.exports = {
    // Schemas
    emailSchema,
    nameSchema,
    campaignNameSchema,
    campaignDescriptionSchema,
    discountTypeSchema,
    discountValueSchema,
    phoneSchema,
    addressSchema,
    userTypeSchema,
    usernameSchema,
    passwordSchema,
    tenantSlugSchema,
    formSubmissionSchema,
    campaignSchema,
    userSchema,
    authUserSchema,
    loginSchema,
    
    // Validation functions
    validate,
    validateAndSanitize
};

