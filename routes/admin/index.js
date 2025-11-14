'use strict';

const { setupCampaignsRoutes } = require('./campaigns');
const { setupUsersRoutes } = require('./users');
const { setupCouponsRoutes } = require('./coupons');
const { setupAnalyticsRoutes } = require('./analytics');
const { setupSettingsRoutes } = require('./settings');
const { setupProductsRoutes } = require('./products');
const { setupAuthUsersRoutes } = require('./auth-users');

/**
 * Setup all admin routes
 */
function setupAdminRoutes(app) {
    setupCampaignsRoutes(app);
    setupUsersRoutes(app);
    setupCouponsRoutes(app);
    setupAnalyticsRoutes(app);
    setupSettingsRoutes(app);
    setupProductsRoutes(app);
    setupAuthUsersRoutes(app);
}

module.exports = { setupAdminRoutes };

