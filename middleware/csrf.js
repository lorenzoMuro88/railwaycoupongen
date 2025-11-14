'use strict';

const csrf = require('csurf');
const logger = require('../utils/logger');

// CSRF protection setup (session-based for better compatibility with JavaScript POST requests)
// Session-based CSRF stores token in session instead of cookie, which works better with sameSite restrictions
const csrfProtection = csrf({
    cookie: false  // Use session-based CSRF instead of cookie-based
});

/**
 * Apply CSRF only to authenticated mutating routes
 */
function csrfIfProtectedRoute(req, res, next) {
    const method = req.method.toUpperCase();
    // Skip CSRF for read-only requests
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();
    
    const url = req.path || '';
    
    // Exclude login endpoints from CSRF (client doesn't have token yet)
    // After login, they'll get token and subsequent requests will be protected
    const csrfExemptPaths = [
        '/api/login',
        '/api/superadmin/login',
        '/api/signup',
        '/submit',
        '/t/:tenantSlug/submit'
    ];
    
    // Check if this is an exempt path (exact match or pattern match)
    const isExempt = csrfExemptPaths.some(exempt => {
        if (exempt.includes(':')) {
            // Pattern match for tenant-scoped routes
            const exemptPattern = exempt.replace(/:\w+/g, '[^/]+');
            const regex = new RegExp('^' + exemptPattern.replace(/\//g, '\\/') + '$');
            return regex.test(url);
        }
        return url === exempt || url.startsWith(exempt + '/');
    });
    
    if (isExempt) {
        return next();
    }
    
    // Apply CSRF to protected endpoints
    const protectedPrefixes = [
        '/api/admin',
        '/api/store',
        '/api/superadmin'
    ];
    const isTenantScoped = url.startsWith('/t/') && url.includes('/api/');
    const isProtected = protectedPrefixes.some(p => url.startsWith(p));
    
    if (isProtected || isTenantScoped) {
        // Log CSRF token info for debugging
        const csrfTokenHeader = req.headers['x-csrf-token'];
        const hasSession = req.session && req.session.id;
        logger.debug({ 
            method: req.method, 
            url, 
            hasToken: !!csrfTokenHeader, 
            hasSession 
        }, 'CSRF check');
        return csrfProtection(req, res, next);
    }
    
    return next();
}

module.exports = {
    csrfProtection,
    csrfIfProtectedRoute
};


