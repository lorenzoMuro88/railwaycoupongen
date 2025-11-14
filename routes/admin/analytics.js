'use strict';

const { getDb } = require('../../utils/db');
const { registerAdminRoute, getTenantId } = require('../../utils/routeHelper');
const logger = require('../../utils/logger');

/**
 * Setup analytics routes
 */
function setupAnalyticsRoutes(app) {
    // GET /api/admin/analytics/summary and /t/:tenantSlug/api/admin/analytics/summary - Analytics summary
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

            res.json({
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


    // GET /api/admin/analytics/campaigns and /t/:tenantSlug/api/admin/analytics/campaigns - Analytics per campaign
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
            res.json(result);
        } catch (e) {
            logger.error({ err: e }, 'analytics/campaigns error');
            res.status(500).json({ error: 'Errore analytics' });
        }
    });


    // GET /api/admin/analytics/temporal and /t/:tenantSlug/api/admin/analytics/temporal - Temporal analytics
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

            res.json(temporalData);
        } catch (e) {
            logger.error({ err: e }, 'analytics/temporal error');
            res.status(500).json({ error: 'Errore analytics temporali' });
        }
    });


    // GET /api/admin/analytics/export and /t/:tenantSlug/api/admin/analytics/export - Export analytics
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
                res.json(data);
            }
        } catch (e) {
            logger.error({ err: e }, 'analytics/export error');
            res.status(500).json({ error: 'Errore export' });
        }
    });

}

module.exports = { setupAnalyticsRoutes };

