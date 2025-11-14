'use strict';

const logger = require('../utils/logger');

// Simple in-memory login rate limiter (per IP)
const loginAttempts = new Map(); // key: ip, value: { count, first, lockedUntil }
const LOGIN_WINDOW_MS = Number(process.env.LOGIN_WINDOW_MS || 10 * 60 * 1000); // 10 min
const LOGIN_MAX_ATTEMPTS = Number(process.env.LOGIN_MAX_ATTEMPTS || 10);
const LOGIN_LOCK_MS = Number(process.env.LOGIN_LOCK_MS || 30 * 60 * 1000); // 30 min

function checkLoginRateLimit(ip) {
    const now = Date.now();
    let entry = loginAttempts.get(ip);
    if (!entry) {
        entry = { count: 0, first: now, lockedUntil: 0 };
        loginAttempts.set(ip, entry);
    }
    if (entry.lockedUntil && now < entry.lockedUntil) {
        return { ok: false, retryAfterMs: entry.lockedUntil - now };
    }
    if (now - entry.first > LOGIN_WINDOW_MS) {
        entry.count = 0; entry.first = now; entry.lockedUntil = 0;
    }
    return { ok: true };
}

function recordLoginFailure(ip) {
    const now = Date.now();
    const entry = loginAttempts.get(ip) || { count: 0, first: now, lockedUntil: 0 };
    entry.count += 1;
    if (entry.count >= LOGIN_MAX_ATTEMPTS) {
        entry.lockedUntil = now + LOGIN_LOCK_MS;
    }
    loginAttempts.set(ip, entry);
}

function recordLoginSuccess(ip) {
    loginAttempts.delete(ip);
}

// Submit rate limiting (per IP + per Email)
const submitAttemptsByIp = new Map(); // key: ip, value: { count, first, lockedUntil }
const submitAttemptsByEmail = new Map(); // key: emailKey, value: { count, first, lockedUntil }

const SUBMIT_WINDOW_MS = Number(process.env.SUBMIT_WINDOW_MS || 10 * 60 * 1000); // 10 min
const SUBMIT_MAX_PER_IP = Number(process.env.SUBMIT_MAX_PER_IP || 20); // per window
const SUBMIT_LOCK_MS = Number(process.env.SUBMIT_LOCK_MS || 30 * 60 * 1000); // 30 min

const EMAIL_DAILY_WINDOW_MS = Number(process.env.EMAIL_DAILY_WINDOW_MS || 24 * 60 * 60 * 1000); // 24h
const EMAIL_MAX_PER_DAY = Number(process.env.EMAIL_MAX_PER_DAY || 3);
const EMAIL_LOCK_MS = Number(process.env.EMAIL_LOCK_MS || 24 * 60 * 60 * 1000);

function normalizeEmailForKey(email) {
    return String(email || '').trim().toLowerCase();
}

function getEmailKey(email, tenantId) {
    const base = normalizeEmailForKey(email);
    return typeof tenantId === 'number' ? `${tenantId}:${base}` : base;
}

function checkIpSubmitLimit(ip) {
    const now = Date.now();
    let entry = submitAttemptsByIp.get(ip);
    if (!entry) {
        entry = { count: 0, first: now, lockedUntil: 0 };
        submitAttemptsByIp.set(ip, entry);
    }
    if (entry.lockedUntil && now < entry.lockedUntil) {
        return { ok: false, retryAfterMs: entry.lockedUntil - now };
    }
    if (now - entry.first > SUBMIT_WINDOW_MS) {
        entry.count = 0; entry.first = now; entry.lockedUntil = 0;
    }
    return { ok: true };
}

function recordIpSubmit(ip) {
    const now = Date.now();
    const entry = submitAttemptsByIp.get(ip) || { count: 0, first: now, lockedUntil: 0 };
    entry.count += 1;
    if (entry.count >= SUBMIT_MAX_PER_IP) {
        entry.lockedUntil = now + SUBMIT_LOCK_MS;
    }
    submitAttemptsByIp.set(ip, entry);
}

function checkEmailDailyLimit(emailKey) {
    const now = Date.now();
    let entry = submitAttemptsByEmail.get(emailKey);
    if (!entry) {
        entry = { count: 0, first: now, lockedUntil: 0 };
        submitAttemptsByEmail.set(emailKey, entry);
    }
    if (entry.lockedUntil && now < entry.lockedUntil) {
        return { ok: false, retryAfterMs: entry.lockedUntil - now };
    }
    if (now - entry.first > EMAIL_DAILY_WINDOW_MS) {
        entry.count = 0; entry.first = now; entry.lockedUntil = 0;
    }
    if (entry.count >= EMAIL_MAX_PER_DAY) {
        return { ok: false, retryAfterMs: (entry.first + EMAIL_DAILY_WINDOW_MS) - now };
    }
    return { ok: true };
}

function recordEmailSubmit(emailKey) {
    const now = Date.now();
    const entry = submitAttemptsByEmail.get(emailKey) || { count: 0, first: now, lockedUntil: 0 };
    entry.count += 1;
    if (entry.count >= EMAIL_MAX_PER_DAY) {
        entry.lockedUntil = Math.max(entry.lockedUntil, entry.first + EMAIL_LOCK_MS);
    }
    submitAttemptsByEmail.set(emailKey, entry);
}

// Cleanup expired entries from rate limiter Maps to prevent memory leaks
function cleanupRateLimiters() {
    const now = Date.now();
    let cleaned = 0;
    
    // Clean login attempts: remove entries that are unlocked and past window
    for (const [ip, entry] of loginAttempts.entries()) {
        if (!entry.lockedUntil && (now - entry.first > LOGIN_WINDOW_MS * 2)) {
            loginAttempts.delete(ip);
            cleaned++;
        } else if (entry.lockedUntil && (now > entry.lockedUntil + LOGIN_LOCK_MS)) {
            // Remove entries that have been locked but lock expired
            loginAttempts.delete(ip);
            cleaned++;
        }
    }
    
    // Clean submit attempts by IP: remove entries past window
    for (const [ip, entry] of submitAttemptsByIp.entries()) {
        if (!entry.lockedUntil && (now - entry.first > SUBMIT_WINDOW_MS * 2)) {
            submitAttemptsByIp.delete(ip);
            cleaned++;
        } else if (entry.lockedUntil && (now > entry.lockedUntil + SUBMIT_LOCK_MS)) {
            submitAttemptsByIp.delete(ip);
            cleaned++;
        }
    }
    
    // Clean submit attempts by email: remove entries past daily window
    for (const [emailKey, entry] of submitAttemptsByEmail.entries()) {
        if (!entry.lockedUntil && (now - entry.first > EMAIL_DAILY_WINDOW_MS * 2)) {
            submitAttemptsByEmail.delete(emailKey);
            cleaned++;
        } else if (entry.lockedUntil && (now > entry.lockedUntil + EMAIL_LOCK_MS)) {
            submitAttemptsByEmail.delete(emailKey);
            cleaned++;
        }
    }
    
    if (cleaned > 0) {
        logger.debug({ cleaned }, 'Rate limiter cleanup');
    }
}

// Run cleanup every 5 minutes to prevent memory leaks
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
let cleanupInterval = null;

function startCleanupInterval() {
    if (cleanupInterval) return;
    cleanupInterval = setInterval(cleanupRateLimiters, CLEANUP_INTERVAL_MS);
    // Cleanup on shutdown
    process.on('SIGTERM', () => {
        if (cleanupInterval) clearInterval(cleanupInterval);
    });
    process.on('SIGINT', () => {
        if (cleanupInterval) clearInterval(cleanupInterval);
    });
}

function checkSubmitRateLimit(req, res, next) {
    // Skip rate limiting in test environment
    if (process.env.NODE_ENV === 'test' || process.env.DISABLE_RATE_LIMIT === 'true') {
        return next();
    }
    
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const email = req.body?.email;
    const tenantId = req.tenant?.id ?? req.session?.user?.tenantId;

    // Per-IP windowed limit
    const ipCheck = checkIpSubmitLimit(ip);
    if (!ipCheck.ok) {
        return res.status(429).send('Troppi invii da questo IP. Riprova più tardi.');
    }

    // Per-email daily limit
    const emailKey = getEmailKey(email, tenantId);
    const emailCheck = checkEmailDailyLimit(emailKey);
    if (!emailCheck.ok) {
        return res.status(429).send('Hai raggiunto il numero massimo di richieste per questa email.');
    }

    // Record immediately to mitigate bursts; we can roll back later if needed
    recordIpSubmit(ip);
    recordEmailSubmit(emailKey);
    next();
}

module.exports = {
    checkLoginRateLimit,
    recordLoginFailure,
    recordLoginSuccess,
    checkSubmitRateLimit,
    startCleanupInterval
};


