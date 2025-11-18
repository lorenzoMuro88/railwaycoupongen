'use strict';

const { getDb } = require('../../utils/db');
const { registerAdminRoute, getTenantId, sendSanitizedJson } = require('../../utils/routeHelper');
const logger = require('../../utils/logger');

/**
 * Setup analytics routes.
 * 
 * Registers all analytics-related admin routes for campaign and coupon analytics.
 * 
 * Routes registered:
 * - GET /api/admin/analytics/summary - Get analytics summary
 * - GET /api/admin/analytics/campaigns - Get analytics per campaign
 * - GET /api/admin/analytics/temporal - Get temporal analytics
 * - GET /api/admin/analytics/export - Export analytics data
 * 
 * @param {Express.App} app - Express application instance
 * @returns {void}
 */
function setupAnalyticsRoutes(app) {
    /**
     * GET /api/admin/analytics/summary and /t/:tenantSlug/api/admin/analytics/summary - Analytics summary
     * 
     * Returns aggregated analytics summary including total campaigns, coupons issued/redeemed,
     * redemption rate, and estimated discount/margin calculations.
     * 
     * @route GET /api/admin/analytics/summary
     * @route GET /t/:tenantSlug/api/admin/analytics/summary
     * @middleware requireAdmin (legacy) | tenantLoader, requireSameTenantAsSession, requireRole('admin') (tenant-scoped)
     * 
     * @param {ExpressRequest} req - Express request object
     * @param {ExpressRequest.query} req.query - Query parameters
     * @param {string} [req.query.start] - Start date filter (YYYY-MM-DD format, optional)
     * @param {string} [req.query.end] - End date filter (YYYY-MM-DD format, optional)
     * @param {string} [req.query.campaignId] - Filter by campaign ID (optional)
     * @param {string} [req.query.status] - Filter by status: "active" or "redeemed" (optional)
     * @param {Express.Response} res - Express response object
     * 
     * @returns {Object} Analytics summary object
     * @returns {number} returns.totalCampaigns - Total number of campaigns
     * @returns {number} returns.totalCouponsIssued - Total number of coupons issued
     * @returns {number} returns.totalCouponsRedeemed - Total number of coupons redeemed
     * @returns {number} returns.redemptionRate - Redemption rate (0-1)
     * @returns {number} returns.estimatedDiscountIssued - Estimated total discount for issued coupons
     * @returns {number} returns.estimatedDiscountRedeemed - Estimated total discount for redeemed coupons
     * @returns {number} returns.estimatedGrossMarginOnRedeemed - Estimated gross margin on redeemed coupons
     * @returns {number} returns.estimatedNetMarginAfterDiscount - Estimated net margin after discount
     * 
     * @throws {400} Bad Request - If tenant ID is invalid, date format invalid, or status invalid
     * @throws {500} Internal Server Error - If database query fails
     * 
     * @example
     * // Request: GET /api/admin/analytics/summary?start=2024-01-01&end=2024-12-31
     * // Response
     * {
     *   totalCampaigns: 5,
     *   totalCouponsIssued: 1000,
     *   totalCouponsRedeemed: 750,
     *   redemptionRate: 0.75,
     *   estimatedDiscountIssued: 5000.00,
     *   estimatedDiscountRedeemed: 3750.00,
     *   estimatedGrossMarginOnRedeemed: 10000.00,
     *   estimatedNetMarginAfterDiscount: 6250.00
     * }
     */
    registerAdminRoute(app, '/analytics/summary', 'get', async (req, res) => {
        try {
            const dbConn = await getDb();
            const tenantId = await getTenantId(req);
            if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
            
            const { start, end, campaignId, status } = req.query;

            // Validate status
            if (status && status !== 'active' && status !== 'redeemed') {
                return res.status(400).json({ error: 'status deve essere "active" o "redeemed"' });
            }

            // Validate date format (YYYY-MM-DD)
            const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
            if (start && !dateRegex.test(start)) {
                return res.status(400).json({ error: 'Formato data non valido per start (atteso: YYYY-MM-DD)' });
            }
            if (end && !dateRegex.test(end)) {
                return res.status(400).json({ error: 'Formato data non valido per end (atteso: YYYY-MM-DD)' });
            }

            // Validate campaignId is numeric if provided
            if (campaignId && isNaN(parseInt(campaignId))) {
                return res.status(400).json({ error: 'campaignId deve essere un numero' });
            }

            const where = ['tenant_id = ?'];
            const params = [tenantId];
            if (campaignId) { where.push('campaign_id = ?'); params.push(parseInt(campaignId)); }
            if (start) { where.push('date(issued_at) >= date(?)'); params.push(start); }
            if (end) { where.push('date(issued_at) <= date(?)'); params.push(end); }
            if (status) { where.push('status = ?'); params.push(status); }
            const whereSql = 'WHERE ' + where.join(' AND ');

            const coupons = await dbConn.all(
                `SELECT discount_type AS discountType, discount_value AS discountValue, status, campaign_id AS campaignId, issued_at AS issuedAt, redeemed_at AS redeemedAt FROM coupons ${whereSql}`,
                params
            );
            const campaigns = await dbConn.all('SELECT id FROM campaigns WHERE tenant_id = ?', tenantId);

            // Build avg value/margin per campaign from associated products (tenant-scoped)
            const rows = await dbConn.all(`
                SELECT cp.campaign_id AS campaignId, AVG(p.value) AS avgValue, AVG(p.margin_price) AS avgMargin
                FROM campaign_products cp
                JOIN products p ON p.id = cp.product_id AND p.tenant_id = ?
                JOIN campaigns c ON c.id = cp.campaign_id AND c.tenant_id = ?
                WHERE c.tenant_id = ?
                GROUP BY cp.campaign_id
            `, tenantId, tenantId, tenantId);
            const campaignAverages = new Map(rows.map(r => [r.campaignId, { avgValue: r.avgValue || 0, avgMargin: r.avgMargin || 0 }]));

            let totalIssued = coupons.length;
            let totalRedeemed = coupons.filter(c => c.status === 'redeemed').length;
            let estDiscountIssued = 0;
            let estDiscountRedeemed = 0;
            let estMarginGross = 0; // sum of avg margins for redeemed

            for (const c of coupons) {
                const avg = campaignAverages.get(c.campaignId) || { avgValue: 0, avgMargin: 0 };
                const base = Math.max(0, avg.avgValue || 0);
                const disc = c.discountType === 'percent' ? (base * (Number(c.discountValue) || 0) / 100) :
                             c.discountType === 'fixed' ? (Number(c.discountValue) || 0) : 0;
                estDiscountIssued += disc;
                if (c.status === 'redeemed') {
                    estDiscountRedeemed += disc;
                    estMarginGross += Math.max(0, avg.avgMargin || 0);
                }
            }

            // Sanitize output to prevent XSS
            sendSanitizedJson(res, {
                totalCampaigns: campaigns.length,
                totalCouponsIssued: totalIssued,
                totalCouponsRedeemed: totalRedeemed,
                redemptionRate: totalIssued ? (totalRedeemed / totalIssued) : 0,
                estimatedDiscountIssued: estDiscountIssued,
                estimatedDiscountRedeemed: estDiscountRedeemed,
                estimatedGrossMarginOnRedeemed: estMarginGross,
                estimatedNetMarginAfterDiscount: Math.max(0, estMarginGross - estDiscountRedeemed)
            });
        } catch (e) {
            logger.error({ err: e }, 'analytics/summary error');
            res.status(500).json({ error: 'Errore analytics' });
        }
    });


    /**
     * GET /api/admin/analytics/campaigns and /t/:tenantSlug/api/admin/analytics/campaigns - Analytics per campaign
     * 
     * Returns analytics data grouped by campaign, including issued/redeemed counts,
     * redemption rates, and estimated discount/margin calculations per campaign.
     * 
     * @route GET /api/admin/analytics/campaigns
     * @route GET /t/:tenantSlug/api/admin/analytics/campaigns
     * @middleware requireAdmin (legacy) | tenantLoader, requireSameTenantAsSession, requireRole('admin') (tenant-scoped)
     * 
     * @param {ExpressRequest} req - Express request object
     * @param {ExpressRequest.query} req.query - Query parameters
     * @param {string} [req.query.start] - Start date filter (YYYY-MM-DD format, optional)
     * @param {string} [req.query.end] - End date filter (YYYY-MM-DD format, optional)
     * @param {string} [req.query.campaignId] - Filter by campaign ID (optional)
     * @param {string} [req.query.status] - Filter by status: "active" or "redeemed" (optional)
     * @param {Express.Response} res - Express response object
     * 
     * @returns {Array<Object>} Array of campaign analytics objects
     * @returns {number} returns[].id - Campaign ID
     * @returns {string} returns[].name - Campaign name
     * @returns {number} returns[].issued - Number of coupons issued for this campaign
     * @returns {number} returns[].redeemed - Number of coupons redeemed for this campaign
     * @returns {number} returns[].redemptionRate - Redemption rate for this campaign (0-1)
     * @returns {number} returns[].estDiscountIssued - Estimated total discount for issued coupons
     * @returns {number} returns[].estDiscountRedeemed - Estimated total discount for redeemed coupons
     * @returns {number} returns[].estGrossMarginRedeemed - Estimated gross margin on redeemed coupons
     * @returns {number} returns[].estNetMarginAfterDiscount - Estimated net margin after discount
     * 
     * @throws {400} Bad Request - If tenant ID is invalid, date format invalid, or status invalid
     * @throws {500} Internal Server Error - If database query fails
     * 
     * @example
     * // Request: GET /api/admin/analytics/campaigns?start=2024-01-01
     * // Response
     * [
     *   {
     *     id: 1,
     *     name: "Sconto 20%",
     *     issued: 500,
     *     redeemed: 375,
     *     redemptionRate: 0.75,
     *     estDiscountIssued: 2500.00,
     *     estDiscountRedeemed: 1875.00,
     *     estGrossMarginRedeemed: 5000.00,
     *     estNetMarginAfterDiscount: 3125.00
     *   }
     * ]
     */
    registerAdminRoute(app, '/analytics/campaigns', 'get', async (req, res) => {
        try {
            const dbConn = await getDb();
            const tenantId = await getTenantId(req);
            if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
            
            const { start, end, campaignId, status } = req.query;

            // Validate status
            if (status && status !== 'active' && status !== 'redeemed') {
                return res.status(400).json({ error: 'status deve essere "active" o "redeemed"' });
            }

            // Validate date format (YYYY-MM-DD)
            const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
            if (start && !dateRegex.test(start)) {
                return res.status(400).json({ error: 'Formato data non valido per start (atteso: YYYY-MM-DD)' });
            }
            if (end && !dateRegex.test(end)) {
                return res.status(400).json({ error: 'Formato data non valido per end (atteso: YYYY-MM-DD)' });
            }

            // Validate campaignId is numeric if provided
            if (campaignId && isNaN(parseInt(campaignId))) {
                return res.status(400).json({ error: 'campaignId deve essere un numero' });
            }

            const campaigns = await dbConn.all('SELECT id, name FROM campaigns WHERE tenant_id = ? ORDER BY created_at DESC', tenantId);

            const where = ['c.tenant_id = ?'];
            const params = [tenantId];
            if (campaignId) { where.push('c.campaign_id = ?'); params.push(parseInt(campaignId)); }
            if (start) { where.push('date(c.issued_at) >= date(?)'); params.push(start); }
            if (end) { where.push('date(c.issued_at) <= date(?)'); params.push(end); }
            if (status) { where.push('c.status = ?'); params.push(status); }
            const whereSql = 'WHERE ' + where.join(' AND ');

            const coupons = await dbConn.all(
                `SELECT c.campaign_id AS campaignId, c.discount_type AS discountType, c.discount_value AS discountValue, c.status FROM coupons c ${whereSql}`,
                params
            );
            const avgs = await dbConn.all(`
                SELECT cp.campaign_id AS campaignId, AVG(p.value) AS avgValue, AVG(p.margin_price) AS avgMargin
                FROM campaign_products cp
                JOIN products p ON p.id = cp.product_id AND p.tenant_id = ?
                JOIN campaigns c ON c.id = cp.campaign_id AND c.tenant_id = ?
                WHERE c.tenant_id = ?
                GROUP BY cp.campaign_id
            `, tenantId, tenantId, tenantId);
            const avgMap = new Map(avgs.map(r => [r.campaignId, { avgValue: r.avgValue || 0, avgMargin: r.avgMargin || 0 }]));

            const byCamp = new Map();
            for (const camp of campaigns) {
                byCamp.set(camp.id, { id: camp.id, name: camp.name, issued: 0, redeemed: 0, estDiscountIssued: 0, estDiscountRedeemed: 0, estGrossMarginRedeemed: 0 });
            }
            for (const c of coupons) {
                const bucket = byCamp.get(c.campaignId);
                if (!bucket) continue;
                const avg = avgMap.get(c.campaignId) || { avgValue: 0, avgMargin: 0 };
                const base = Math.max(0, avg.avgValue || 0);
                const disc = c.discountType === 'percent' ? (base * (Number(c.discountValue) || 0) / 100) :
                             c.discountType === 'fixed' ? (Number(c.discountValue) || 0) : 0;
                bucket.issued += 1;
                bucket.estDiscountIssued += disc;
                if (c.status === 'redeemed') {
                    bucket.redeemed += 1;
                    bucket.estDiscountRedeemed += disc;
                    bucket.estGrossMarginRedeemed += Math.max(0, avg.avgMargin || 0);
                }
            }
            const result = Array.from(byCamp.values()).map(b => ({
                ...b,
                redemptionRate: b.issued ? (b.redeemed / b.issued) : 0,
                estNetMarginAfterDiscount: Math.max(0, b.estGrossMarginRedeemed - b.estDiscountRedeemed)
            }));
            // Sanitize output to prevent XSS
            sendSanitizedJson(res, result);
        } catch (e) {
            logger.error({ err: e }, 'analytics/campaigns error');
            res.status(500).json({ error: 'Errore analytics' });
        }
    });


    /**
     * GET /api/admin/analytics/temporal and /t/:tenantSlug/api/admin/analytics/temporal - Temporal analytics
     * 
     * Returns analytics data grouped by time period (day or week), showing trends
     * over time for coupons issued/redeemed, discounts applied, and margins.
     * 
     * @route GET /api/admin/analytics/temporal
     * @route GET /t/:tenantSlug/api/admin/analytics/temporal
     * @middleware requireAdmin (legacy) | tenantLoader, requireSameTenantAsSession, requireRole('admin') (tenant-scoped)
     * 
     * @param {ExpressRequest} req - Express request object
     * @param {ExpressRequest.query} req.query - Query parameters
     * @param {string} [req.query.start] - Start date filter (YYYY-MM-DD format, optional)
     * @param {string} [req.query.end] - End date filter (YYYY-MM-DD format, optional)
     * @param {string} [req.query.campaignId] - Filter by campaign ID (optional)
     * @param {string} [req.query.status] - Filter by status: "active" or "redeemed" (optional)
     * @param {string} [req.query.groupBy='day'] - Group by "day" or "week" (default: "day")
     * @param {Express.Response} res - Express response object
     * 
     * @returns {Array<Object>} Array of temporal analytics objects
     * @returns {string} returns[].period - Time period (YYYY-MM-DD for day, YYYY-Www for week)
     * @returns {number} returns[].issued - Number of coupons issued in this period
     * @returns {number} returns[].redeemed - Number of coupons redeemed in this period
     * @returns {number} returns[].discount_applied - Total discount applied in this period
     * @returns {number} returns[].gross_margin - Gross margin for redeemed coupons in this period
     * 
     * @throws {400} Bad Request - If tenant ID is invalid, date format invalid, status invalid, or groupBy invalid
     * @throws {500} Internal Server Error - If database query fails
     * 
     * @example
     * // Request: GET /api/admin/analytics/temporal?start=2024-01-01&groupBy=day
     * // Response
     * [
     *   {
     *     period: "2024-01-01",
     *     issued: 50,
     *     redeemed: 35,
     *     discount_applied: 175.00,
     *     gross_margin: 500.00
     *   }
     * ]
     */
    registerAdminRoute(app, '/analytics/temporal', 'get', async (req, res) => {
        try {
            const dbConn = await getDb();
            const tenantId = await getTenantId(req);
            if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
            
            const { start, end, campaignId, status, groupBy = 'day' } = req.query;

            // Validate groupBy
            if (groupBy && groupBy !== 'day' && groupBy !== 'week') {
                return res.status(400).json({ error: 'groupBy deve essere "day" o "week"' });
            }

            // Validate status
            if (status && status !== 'active' && status !== 'redeemed') {
                return res.status(400).json({ error: 'status deve essere "active" o "redeemed"' });
            }

            // Validate date format (YYYY-MM-DD)
            const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
            if (start && !dateRegex.test(start)) {
                return res.status(400).json({ error: 'Formato data non valido per start (atteso: YYYY-MM-DD)' });
            }
            if (end && !dateRegex.test(end)) {
                return res.status(400).json({ error: 'Formato data non valido per end (atteso: YYYY-MM-DD)' });
            }

            // Validate campaignId is numeric if provided
            if (campaignId && isNaN(parseInt(campaignId))) {
                return res.status(400).json({ error: 'campaignId deve essere un numero' });
            }

            const where = ['c.tenant_id = ?'];
            const params = [tenantId];
            if (campaignId) { where.push('c.campaign_id = ?'); params.push(parseInt(campaignId)); }
            if (start) { where.push('date(c.issued_at) >= date(?)'); params.push(start); }
            if (end) { where.push('date(c.issued_at) <= date(?)'); params.push(end); }
            if (status) { where.push('c.status = ?'); params.push(status); }
            const whereSql = 'WHERE ' + where.join(' AND ');

            // Pre-compute campaign averages to avoid correlated subqueries (performance optimization)
            const campaignAverages = await dbConn.all(`
                SELECT cp.campaign_id AS campaignId, AVG(p.value) AS avgValue, AVG(p.margin_price) AS avgMargin
                FROM campaign_products cp
                JOIN products p ON p.id = cp.product_id AND p.tenant_id = ?
                JOIN campaigns camp ON camp.id = cp.campaign_id AND camp.tenant_id = ?
                WHERE camp.tenant_id = ?
                GROUP BY cp.campaign_id
            `, tenantId, tenantId, tenantId);
            const avgMap = new Map(campaignAverages.map(r => [r.campaignId, { avgValue: r.avgValue || 0, avgMargin: r.avgMargin || 0 }]));

            // Get temporal aggregation with pre-computed averages
            const dateFormat = groupBy === 'week' ? "strftime('%Y-W%W', c.issued_at)" : "date(c.issued_at)";
            const temporalDataRaw = await dbConn.all(`
                SELECT 
                    ${dateFormat} as period,
                    c.campaign_id,
                    c.discount_type,
                    c.discount_value,
                    c.status
                FROM coupons c
                ${whereSql}
                ORDER BY ${groupBy === 'week' ? "strftime('%Y', c.issued_at), strftime('%W', c.issued_at)" : "date(c.issued_at)"}
            `, ...params);

            // Aggregate by period with pre-computed averages
            const temporalMap = new Map();
            for (const row of temporalDataRaw) {
                if (!temporalMap.has(row.period)) {
                    temporalMap.set(row.period, { period: row.period, issued: 0, redeemed: 0, discount_applied: 0, gross_margin: 0 });
                }
                const periodData = temporalMap.get(row.period);
                periodData.issued++;
                if (row.status === 'redeemed') {
                    periodData.redeemed++;
                    const avg = avgMap.get(row.campaign_id) || { avgValue: 0, avgMargin: 0 };
                    const discount = row.discount_type === 'percent' ? (avg.avgValue * (Number(row.discount_value) || 0) / 100) :
                                   row.discount_type === 'fixed' ? (Number(row.discount_value) || 0) : 0;
                    periodData.discount_applied += discount;
                    periodData.gross_margin += Math.max(0, avg.avgMargin || 0);
                }
            }
            const temporalData = Array.from(temporalMap.values());

            // Sanitize output to prevent XSS
            sendSanitizedJson(res, temporalData);
        } catch (e) {
            logger.error({ err: e }, 'analytics/temporal error');
            res.status(500).json({ error: 'Errore analytics temporali' });
        }
    });


    /**
     * GET /api/admin/analytics/export and /t/:tenantSlug/api/admin/analytics/export - Export analytics
     * 
     * Exports detailed analytics data as CSV or JSON format.
     * Includes coupon details, user information, campaign data, and calculated averages.
     * 
     * @route GET /api/admin/analytics/export
     * @route GET /t/:tenantSlug/api/admin/analytics/export
     * @middleware requireAdmin (legacy) | tenantLoader, requireSameTenantAsSession, requireRole('admin') (tenant-scoped)
     * 
     * @param {ExpressRequest} req - Express request object
     * @param {ExpressRequest.query} req.query - Query parameters
     * @param {string} [req.query.start] - Start date filter (YYYY-MM-DD format, optional)
     * @param {string} [req.query.end] - End date filter (YYYY-MM-DD format, optional)
     * @param {string} [req.query.campaignId] - Filter by campaign ID (optional)
     * @param {string} [req.query.status] - Filter by status: "active" or "redeemed" (optional)
     * @param {string} [req.query.format='csv'] - Export format: "csv" or "json" (default: "csv")
     * @param {Express.Response} res - Express response object
     * 
     * @returns {string|Object} CSV file content (if format=csv) or JSON object (if format=json)
     * @returns {string} Content-Type: text/csv (if CSV) or application/json (if JSON)
     * @returns {string} Content-Disposition: attachment; filename="analytics-export.csv" (if CSV)
     * 
     * CSV Columns (if format=csv):
     * - Code, Status, Issued At, Redeemed At, Campaign, First Name, Last Name, Email, Discount Type, Discount Value, Avg Product Value, Avg Margin
     * 
     * JSON Structure (if format=json):
     * Array of objects with: code, status, issued_at, redeemed_at, campaign_id, campaign_name, first_name, last_name, email, discount_type, discount_value, avg_product_value, avg_margin
     * 
     * @throws {400} Bad Request - If tenant ID is invalid, date format invalid, or status invalid
     * @throws {500} Internal Server Error - If database query fails or export generation fails
     * 
     * @example
     * // Request: GET /api/admin/analytics/export?format=csv&start=2024-01-01
     * // Response: CSV file download with headers
     * // Content-Type: text/csv
     * // Content-Disposition: attachment; filename="analytics-export.csv"
     * 
     * @example
     * // Request: GET /api/admin/analytics/export?format=json
     * // Response
     * [
     *   {
     *     code: "ABC123XYZ456",
     *     status: "redeemed",
     *     issued_at: "2024-01-01T00:00:00.000Z",
     *     redeemed_at: "2024-01-15T00:00:00.000Z",
     *     campaign_id: 1,
     *     campaign_name: "Sconto 20%",
     *     first_name: "Mario",
     *     last_name: "Rossi",
     *     email: "mario@example.com",
     *     discount_type: "percent",
     *     discount_value: "20",
     *     avg_product_value: 100.00,
     *     avg_margin: 30.00
     *   }
     * ]
     */
    registerAdminRoute(app, '/analytics/export', 'get', async (req, res) => {
        try {
            const dbConn = await getDb();
            const tenantId = await getTenantId(req);
            if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
            
            const { start, end, campaignId, status, format = 'csv' } = req.query;

            // Pre-compute campaign averages to avoid correlated subqueries (performance optimization)
            const campaignAverages = await dbConn.all(`
                SELECT cp.campaign_id AS campaignId, AVG(p.value) AS avgValue, AVG(p.margin_price) AS avgMargin
                FROM campaign_products cp
                JOIN products p ON p.id = cp.product_id AND p.tenant_id = ?
                JOIN campaigns camp ON camp.id = cp.campaign_id AND camp.tenant_id = ?
                WHERE camp.tenant_id = ?
                GROUP BY cp.campaign_id
            `, tenantId, tenantId, tenantId);
            const avgMap = new Map(campaignAverages.map(r => [r.campaignId, { avgValue: r.avgValue || 0, avgMargin: r.avgMargin || 0 }]));

            const where = ['c.tenant_id = ?'];
            const params = [tenantId];
            if (campaignId) { where.push('c.campaign_id = ?'); params.push(campaignId); }
            if (start) { where.push('date(c.issued_at) >= date(?)'); params.push(start); }
            if (end) { where.push('date(c.issued_at) <= date(?)'); params.push(end); }
            if (status) { where.push('c.status = ?'); params.push(status); }
            const whereSql = 'WHERE ' + where.join(' AND ');

            const dataRaw = await dbConn.all(`
                SELECT 
                    c.code,
                    c.status,
                    c.issued_at as issued_at,
                    c.redeemed_at as redeemed_at,
                    c.campaign_id,
                    camp.name as campaign_name,
                    u.first_name,
                    u.last_name,
                    u.email,
                    c.discount_type,
                    c.discount_value
                FROM coupons c
                LEFT JOIN campaigns camp ON camp.id = c.campaign_id AND camp.tenant_id = c.tenant_id
                LEFT JOIN users u ON u.id = c.user_id AND u.tenant_id = c.tenant_id
                ${whereSql}
                ORDER BY c.issued_at DESC
            `, ...params);

            // Add pre-computed averages to each row
            const data = dataRaw.map(row => {
                const avg = avgMap.get(row.campaign_id) || { avgValue: 0, avgMargin: 0 };
                return {
                    ...row,
                    avg_product_value: avg.avgValue,
                    avg_margin: avg.avgMargin
                };
            });

            if (format === 'csv') {
                const headers = ['Code', 'Status', 'Issued At', 'Redeemed At', 'Campaign', 'First Name', 'Last Name', 'Email', 'Discount Type', 'Discount Value', 'Avg Product Value', 'Avg Margin'];
                const csvContent = [
                    headers.join(','),
                    ...data.map(row => [
                        row.code,
                        row.status,
                        row.issued_at,
                        row.redeemed_at || '',
                        `"${(row.campaign_name || '').replace(/"/g, '""')}"`,
                        `"${(row.first_name || '').replace(/"/g, '""')}"`,
                        `"${(row.last_name || '').replace(/"/g, '""')}"`,
                        `"${(row.email || '').replace(/"/g, '""')}"`,
                        row.discount_type,
                        row.discount_value,
                        row.avg_product_value || 0,
                        row.avg_margin || 0
                    ].join(','))
                ].join('\n');

                res.setHeader('Content-Type', 'text/csv');
                res.setHeader('Content-Disposition', 'attachment; filename="analytics-export.csv"');
                res.send(csvContent);
            } else {
                // Sanitize output to prevent XSS
                sendSanitizedJson(res, data);
            }
        } catch (e) {
            logger.error({ err: e }, 'analytics/export error');
            res.status(500).json({ error: 'Errore export' });
        }
    });

}

module.exports = { setupAnalyticsRoutes };

