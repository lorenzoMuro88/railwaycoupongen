'use strict';

const { getDb } = require('../../utils/db');
const { registerAdminRoute, getTenantId, sendSanitizedJson } = require('../../utils/routeHelper');
const logger = require('../../utils/logger');

/**
 * Setup products routes.
 * 
 * Registers all product-related admin routes (both legacy and tenant-scoped variants).
 * 
 * Routes registered:
 * - GET /api/admin/products - List all products
 * - POST /api/admin/products - Create new product
 * - PUT /api/admin/products/:id - Update product
 * - DELETE /api/admin/products/:id - Delete product
 * 
 * @param {Express.App} app - Express application instance
 * @returns {void}
 */
function setupProductsRoutes(app) {
    /**
     * GET /api/admin/products and /t/:tenantSlug/api/admin/products - List products
     * 
     * Returns all products for the tenant, ordered by creation date (newest first).
     * 
     * @route GET /api/admin/products
     * @route GET /t/:tenantSlug/api/admin/products
     * @middleware requireAdmin (legacy) | tenantLoader, requireSameTenantAsSession, requireRole('admin') (tenant-scoped)
     * 
     * @param {ExpressRequest} req - Express request object
     * @param {Express.Response} res - Express response object
     * 
     * @returns {Array<Product>} Array of product objects
     * 
     * @throws {400} Bad Request - If tenant ID is invalid
     * @throws {500} Internal Server Error - If database query fails
     * 
     * @example
     * // Response
     * [
     *   {
     *     id: 1,
     *     name: "Prodotto A",
     *     value: 100.00,
     *     margin_price: 20.00,
     *     sku: "PROD-A-001",
     *     tenant_id: 1,
     *     created_at: "2024-01-01T00:00:00.000Z"
     *   }
     * ]
     */
    registerAdminRoute(app, '/products', 'get', async (req, res) => {
        try {
            const dbConn = await getDb();
            const tenantId = await getTenantId(req);
            if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
            const products = await dbConn.all('SELECT * FROM products WHERE tenant_id = ? ORDER BY created_at DESC', tenantId);
            // Sanitize output to prevent XSS
            sendSanitizedJson(res, products);
        } catch (error) {
            logger.error({ err: error }, 'Error fetching products');
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    /**
     * POST /api/admin/products and /t/:tenantSlug/api/admin/products - Create product
     * 
     * Creates a new product with name, value, margin price, and optional SKU.
     * SKU must be unique per tenant.
     * 
     * @route POST /api/admin/products
     * @route POST /t/:tenantSlug/api/admin/products
     * @middleware requireAdmin (legacy) | tenantLoader, requireSameTenantAsSession, requireRole('admin') (tenant-scoped)
     * 
     * @param {ExpressRequest} req - Express request object
     * @param {ExpressRequest.body} req.body - Request body
     * @param {string} req.body.name - Product name (required, non-empty string)
     * @param {number} req.body.value - Product value/price (required, numeric)
     * @param {number} req.body.margin_price - Margin price (required, numeric)
     * @param {string} [req.body.sku] - SKU code (optional, must be unique per tenant)
     * @param {Express.Response} res - Express response object
     * 
     * @returns {Object} Created product response
     * @returns {number} returns.id - Product ID
     * @returns {boolean} returns.success - Always true
     * 
     * @throws {400} Bad Request - If name is invalid, required fields missing, or SKU already exists
     * @throws {500} Internal Server Error - If database insert fails
     * 
     * @example
     * // Request body
     * {
     *   name: "Prodotto A",
     *   value: 100.00,
     *   margin_price: 20.00,
     *   sku: "PROD-A-001"
     * }
     * 
     * // Response
     * {
     *   id: 1,
     *   success: true
     * }
     */
    registerAdminRoute(app, '/products', 'post', async (req, res) => {
        try {
            const { name, value, margin_price, sku } = req.body;
            if (typeof name !== 'string' || !name.trim()) {
                return res.status(400).json({ error: 'Nome non valido' });
            }
            if (isNaN(parseFloat(value)) || isNaN(parseFloat(margin_price))) {
                return res.status(400).json({ error: 'Valori numerici non validi' });
            }
            
            if (!name || !value || !margin_price) {
                return res.status(400).json({ error: 'Name, value and margin_price are required' });
            }
            
            const dbConn = await getDb();
            const tenantId = await getTenantId(req);
            if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
            const result = await dbConn.run(
                'INSERT INTO products (name, value, margin_price, sku, tenant_id) VALUES (?, ?, ?, ?, ?)',
                [name, parseFloat(value), parseFloat(margin_price), sku || null, tenantId]
            );
            
            res.json({ id: result.lastID, success: true });
        } catch (error) {
            logger.error({ err: error }, 'Error creating product');
            if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                res.status(400).json({ error: 'SKU already exists' });
            } else {
                res.status(500).json({ error: 'Internal server error' });
            }
        }
    });

    /**
     * PUT /api/admin/products/:id and /t/:tenantSlug/api/admin/products/:id - Update product
     * 
     * Updates an existing product. All fields are required in request body.
     * SKU must be unique per tenant (can be same as current SKU for same product).
     * 
     * @route PUT /api/admin/products/:id
     * @route PUT /t/:tenantSlug/api/admin/products/:id
     * @middleware requireAdmin (legacy) | tenantLoader, requireSameTenantAsSession, requireRole('admin') (tenant-scoped)
     * 
     * @param {ExpressRequest} req - Express request object
     * @param {ExpressRequest.params} req.params - URL parameters
     * @param {string} req.params.id - Product ID to update
     * @param {ExpressRequest.body} req.body - Request body
     * @param {string} req.body.name - Product name (required, non-empty string)
     * @param {number} req.body.value - Product value/price (required, numeric)
     * @param {number} req.body.margin_price - Margin price (required, numeric)
     * @param {string} [req.body.sku] - SKU code (optional, must be unique per tenant)
     * @param {Express.Response} res - Express response object
     * 
     * @returns {Object} Success response
     * @returns {boolean} returns.success - Always true
     * 
     * @throws {400} Bad Request - If name is invalid, required fields missing, or SKU already exists
     * @throws {404} Not Found - If product doesn't exist or doesn't belong to tenant
     * @throws {500} Internal Server Error - If database update fails
     * 
     * @example
     * // Request: PUT /api/admin/products/1
     * // Body:
     * {
     *   name: "Prodotto A Aggiornato",
     *   value: 120.00,
     *   margin_price: 25.00,
     *   sku: "PROD-A-001"
     * }
     * // Response
     * {
     *   success: true
     * }
     */
    registerAdminRoute(app, '/products/:id', 'put', async (req, res) => {
        try {
            const { name, value, margin_price, sku } = req.body;
            if (typeof name !== 'string' || !name.trim()) {
                return res.status(400).json({ error: 'Nome non valido' });
            }
            if (isNaN(parseFloat(value)) || isNaN(parseFloat(margin_price))) {
                return res.status(400).json({ error: 'Valori numerici non validi' });
            }
            const dbConn = await getDb();
            const tenantId = await getTenantId(req);
            if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
            const result = await dbConn.run(
                'UPDATE products SET name = ?, value = ?, margin_price = ?, sku = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?',
                [name, parseFloat(value), parseFloat(margin_price), sku || null, req.params.id, tenantId]
            );
            if (result.changes === 0) return res.status(404).json({ error: 'Prodotto non trovato' });
            res.json({ success: true });
        } catch (error) {
            logger.error({ err: error }, 'Error updating product');
            if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                res.status(400).json({ error: 'SKU already exists' });
            } else {
                res.status(500).json({ error: 'Internal server error' });
            }
        }
    });

    /**
     * DELETE /api/admin/products/:id and /t/:tenantSlug/api/admin/products/:id - Delete product
     * 
     * Permanently deletes a product by ID. Only deletes products belonging to the tenant.
     * 
     * @route DELETE /api/admin/products/:id
     * @route DELETE /t/:tenantSlug/api/admin/products/:id
     * @middleware requireAdmin (legacy) | tenantLoader, requireSameTenantAsSession, requireRole('admin') (tenant-scoped)
     * 
     * @param {ExpressRequest} req - Express request object
     * @param {ExpressRequest.params} req.params - URL parameters
     * @param {string} req.params.id - Product ID to delete
     * @param {Express.Response} res - Express response object
     * 
     * @returns {Object} Success response
     * @returns {boolean} returns.success - Always true
     * 
     * @throws {400} Bad Request - If tenant ID is invalid
     * @throws {404} Not Found - If product doesn't exist or doesn't belong to tenant
     * @throws {500} Internal Server Error - If database operation fails
     * 
     * @example
     * // Request: DELETE /api/admin/products/1
     * // Response
     * {
     *   success: true
     * }
     */
    registerAdminRoute(app, '/products/:id', 'delete', async (req, res) => {
        try {
            const dbConn = await getDb();
            const tenantId = await getTenantId(req);
            if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
            const result = await dbConn.run('DELETE FROM products WHERE id = ? AND tenant_id = ?', req.params.id, tenantId);
            if (result.changes === 0) return res.status(404).json({ error: 'Prodotto non trovato' });
            res.json({ success: true });
        } catch (error) {
            logger.error({ err: error }, 'Error deleting product');
            res.status(500).json({ error: 'Internal server error' });
        }
    });

}

module.exports = { setupProductsRoutes };

