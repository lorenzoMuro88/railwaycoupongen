'use strict';

const nodemailer = require('nodemailer');
const formData = require('form-data');
const Mailgun = require('mailgun.js');
const logger = require('./logger');

const DEFAULT_TENANT_NAME = process.env.DEFAULT_TENANT_NAME || 'Default Tenant';

/**
 * Parse email from string format (e.g., "Name <email@example.com>").
 * 
 * Extracts display name and email address from formatted email string.
 * Handles formats: "Name <email>", "email", or quoted names.
 * 
 * @param {string} [value] - Email string to parse
 * @returns {Object} Parsed email object
 * @returns {string|null} returns.name - Display name (null if not present)
 * @returns {string|null} returns.address - Email address (null if invalid)
 * 
 * @example
 * parseMailFrom("Mario's Store <noreply@example.com>");
 * // Returns: { name: "Mario's Store", address: "noreply@example.com" }
 * 
 * @example
 * parseMailFrom("noreply@example.com");
 * // Returns: { name: null, address: "noreply@example.com" }
 * 
 * @example
 * parseMailFrom('"Mario Store" <noreply@example.com>');
 * // Returns: { name: "Mario Store", address: "noreply@example.com" }
 */
function parseMailFrom(value) {
    if (!value) return { name: null, address: null };
    const trimmed = String(value).trim();
    if (!trimmed) return { name: null, address: null };
    const match = trimmed.match(/^(.*)<([^>]+)>\s*$/);
    if (match) {
        const name = match[1].trim().replace(/^"|"$/g, '');
        return {
            name: name || null,
            address: match[2].trim()
        };
    }
    return { name: null, address: trimmed };
}

/**
 * Build email transport based on configuration.
 * 
 * Creates and returns an email transport instance based on environment variables.
 * Supports Mailgun (recommended), SMTP, or JSON transport (development fallback).
 * 
 * Priority order:
 * 1. Mailgun (if MAIL_PROVIDER=mailgun and credentials configured)
 * 2. SMTP (if SMTP_HOST configured)
 * 3. JSON transport (fallback, logs emails to console)
 * 
 * @returns {Object} Email transport object with sendMail method
 * 
 * @description
 * **Mailgun Transport:**
 * - Wraps Mailgun SDK in Nodemailer-like interface
 * - Supports inline attachments (QR codes)
 * - Configurable region (us/eu)
 * - Optional tracking (opens, clicks)
 * - Timeout: 30 seconds
 * 
 * **SMTP Transport:**
 * - Uses nodemailer SMTP transport
 * - Connection pooling enabled
 * - Configurable timeouts (connection, greeting, socket)
 * - Rate limiting: 5 messages per 20 seconds
 * 
 * **JSON Transport (Development):**
 * - Logs email content to console
 * - No actual email sending
 * - Useful for local development
 * 
 * @example
 * const transporter = buildTransport();
 * await transporter.sendMail({
 *   from: 'noreply@example.com',
 *   to: 'user@example.com',
 *   subject: 'Test',
 *   html: '<p>Test email</p>'
 * });
 * 
 * @see {@link LLM_MD/CONFIGURATION.md} For email configuration options
 */
function buildTransport() {
    // Prefer Mailgun when configured
    if ((process.env.MAIL_PROVIDER || '').toLowerCase() === 'mailgun' && process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN) {
        const mailgun = new Mailgun(formData);
        const mg = mailgun.client({
            username: 'api',
            key: process.env.MAILGUN_API_KEY,
            url: (process.env.MAILGUN_REGION || 'eu') === 'us' ? 'https://api.mailgun.net' : 'https://api.eu.mailgun.net',
            timeout: 30000  // 30 seconds timeout for Mailgun API calls
        });
        // Wrap Mailgun client in a Nodemailer-like interface used below
        return {
            async sendMail(message) {
                // Build Mailgun message
                const data = {
                    from: message.from || (process.env.MAILGUN_FROM || 'CouponGen <no-reply@send.coupongen.it>'),
                    to: message.to,
                    subject: message.subject || 'Il tuo coupon',
                    html: message.html,
                };
                // Attachments (QR inline)
                if (Array.isArray(message.attachments) && message.attachments.length > 0) {
                    // Separate inline and regular attachments
                    const regularAttachments = message.attachments.filter(a => !a.cid);
                    const inlineAttachments = message.attachments.filter(a => a.cid);
                    
                    if (regularAttachments.length > 0) {
                        data.attachment = regularAttachments.map(att => ({
                            filename: att.filename,
                            data: att.content,
                            knownLength: att.content?.length
                        }));
                    }
                    
                    if (inlineAttachments.length > 0) {
                        // Mailgun inline attachments: CID must match filename (without extension)
                        // For filename "coupon-qr.png", use cid:coupon-qr in HTML
                        data.inline = inlineAttachments.map(att => {
                            // Extract CID without "cid:" prefix and file extension
                            const cid = att.cid.replace(/^cid:/i, '').replace(/\.[^.]+$/, '');
                            return {
                                filename: att.filename,
                                data: att.content,
                                cid: cid
                            };
                        });
                    }
                }
                
                // Optional: Reply-To header
                if (message.replyTo) {
                    data['h:Reply-To'] = message.replyTo;
                } else if (process.env.MAILGUN_REPLY_TO) {
                    data['h:Reply-To'] = process.env.MAILGUN_REPLY_TO;
                }
                
                // Optional: Tracking
                if (process.env.MAILGUN_TRACKING === 'true') {
                    data['o:tracking'] = 'yes';
                    data['o:tracking-clicks'] = 'yes';
                    data['o:tracking-opens'] = 'yes';
                }
                
                try {
                    const domain = process.env.MAILGUN_DOMAIN;
                    const result = await mg.messages.create(domain, data);
                    logger.info({ 
                        messageId: result.id, 
                        domain, 
                        to: message.to 
                    }, 'Email sent via Mailgun');
                    return {
                        messageId: result.id,
                        accepted: [message.to],
                        rejected: []
                    };
                } catch (error) {
                    logger.error({ 
                        err: error, 
                        status: error.status, 
                        details: error.message 
                    }, 'Mailgun send error');
                    throw error; // Re-throw per permettere gestione errori a monte
                }
            },
            options: { provider: 'mailgun' }
        };
    }
    // If using Ethereal (dev) or SMTP credentials
    if (process.env.SMTP_HOST) {
        return nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT || 587),
            secure: process.env.SMTP_SECURE === 'true',
            auth: process.env.SMTP_USER ? {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            } : undefined,
            // Add timeout configurations for SMTP
            connectionTimeout: 30000,  // 30 seconds to establish connection
            greetingTimeout: 30000,    // 30 seconds for SMTP greeting
            socketTimeout: 30000,      // 30 seconds for socket operations
            pool: true,                // Enable connection pooling
            maxConnections: 5,         // Max concurrent connections
            maxMessages: 100,          // Max messages per connection
            rateDelta: 20000,          // Rate limiting: 1 message per 20 seconds
            rateLimit: 5               // Max 5 messages per rateDelta
        });
    }
    // Fallback to JSON transport (logs emails to console)
    return nodemailer.createTransport({ jsonTransport: true });
}

/**
 * Build email "from" address for a tenant.
 * 
 * Constructs formatted email address string ("Name <email>") for tenant-specific
 * email sending. Falls back to global configuration if tenant doesn't have custom settings.
 * 
 * @param {Tenant} [tenant] - Tenant object (may be null/undefined)
 * @returns {string} Formatted email address string ("Display Name <email@domain.com>")
 * 
 * @description
 * Priority order for email address:
 * 1. `tenant.email_from_address` (if set)
 * 2. `tenant.mailgun_domain` (if set, uses no-reply@domain)
 * 3. Global `MAIL_FROM` or `MAILGUN_FROM` env variable
 * 4. Default: "CouponGen <no-reply@send.coupongen.it>"
 * 
 * Display name priority:
 * 1. `tenant.email_from_name` (if set)
 * 2. `DEFAULT_TENANT_NAME` env variable
 * 3. Default: "CouponGen"
 * 
 * @example
 * const tenant = { email_from_name: "Mario's Store", email_from_address: "noreply@mariostore.com" };
 * buildTenantEmailFrom(tenant);
 * // Returns: "Mario's Store <noreply@mariostore.com>"
 * 
 * @example
 * const tenant = { email_from_name: "Mario's Store", mailgun_domain: "mg.mariostore.com" };
 * buildTenantEmailFrom(tenant);
 * // Returns: "Mario's Store <no-reply@mariostore.com>"
 * 
 * @see {@link LLM_MD/TYPES.md} For Tenant type definition
 */
function buildTenantEmailFrom(tenant) {
    const displayName = (tenant && tenant.email_from_name) || DEFAULT_TENANT_NAME || 'CouponGen';
    if (tenant && tenant.email_from_address) {
        return `${displayName} <${tenant.email_from_address}>`;
    }
    // If tenant has Mailgun custom domain, use no-reply@ that domain
    if (tenant && tenant.mailgun_domain) {
        return `${displayName} <no-reply@${tenant.mailgun_domain.replace(/^mg\./, '')}>`;
    }
    // Fallback to global sender
    const globalFrom = process.env.MAIL_FROM || process.env.MAILGUN_FROM || 'CouponGen <no-reply@send.coupongen.it>';
    // Replace display name while preserving address
    const addrMatch = globalFrom.match(/<([^>]+)>/);
    const address = addrMatch ? addrMatch[1] : 'no-reply@send.coupongen.it';
    return `${displayName} <${address}>`;
}

/**
 * Get tenant Mailgun domain with fallback to global configuration.
 * 
 * Returns Mailgun domain for tenant-specific email sending, or falls back to
 * global MAILGUN_DOMAIN if tenant doesn't have custom domain configured.
 * 
 * @param {Tenant} [tenant] - Tenant object (may be null/undefined)
 * @returns {string|null} Mailgun domain string or null if not configured
 * 
 * @example
 * const tenant = { mailgun_domain: "mg.mariostore.com" };
 * getTenantMailgunDomain(tenant);
 * // Returns: "mg.mariostore.com"
 * 
 * @example
 * const tenant = {}; // No custom domain
 * // MAILGUN_DOMAIN=mg.example.com in env
 * getTenantMailgunDomain(tenant);
 * // Returns: "mg.example.com"
 * 
 * @see {@link LLM_MD/TYPES.md} For Tenant type definition
 */
function getTenantMailgunDomain(tenant) {
    if (tenant && tenant.mailgun_domain) return tenant.mailgun_domain;
    return process.env.MAILGUN_DOMAIN || null;
}

// Create transporter instance
const transporter = buildTransport();

module.exports = {
    parseMailFrom,
    buildTransport,
    buildTenantEmailFrom,
    getTenantMailgunDomain,
    transporter
};

