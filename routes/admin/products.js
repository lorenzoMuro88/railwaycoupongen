'use strict';

const { getDb } = require('../../utils/db');
const { registerAdminRoute, getTenantId } = require('../../utils/routeHelper');
const logger = require('../../utils/logger');

/**
 * Setup products routes
 */
function setupProductsRoutes(app) {
    // GET /api/admin/products and /t/:tenantSlug/api/admin/products - List products
    registerAdminRoute(app, '/products', 'get', async (req, res) => {
        try {
            const dbConn = await getDb();
            const tenantId = await getTenantId(req);
            if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
            const products = await dbConn.all('SELECT * FROM products WHERE tenant_id = ? ORDER BY created_at DESC', tenantId);
            res.json(products);
        } catch (error) {
            logger.error({ err: error }, 'Error fetching products');
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // POST /api/admin/products and /t/:tenantSlug/api/admin/products - Create product
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

    // PUT /api/admin/products/:id and /t/:tenantSlug/api/admin/products/:id - Update product
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

    // DELETE /api/admin/products/:id and /t/:tenantSlug/api/admin/products/:id - Delete product
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

