const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

async function main() {
  const db = await open({
    filename: path.join(__dirname, '..', 'data', 'coupons.db'),
    driver: sqlite3.Database
  });

  await db.exec('PRAGMA foreign_keys = OFF');

  const productsCols = await db.all("PRAGMA table_info(products)");
  const hasTenant = productsCols.some(c => c.name === 'tenant_id');

  // Ensure default tenant
  const DEFAULT_TENANT_SLUG = process.env.DEFAULT_TENANT_SLUG || 'default';
  let defaultTenant = await db.get('SELECT id FROM tenants WHERE slug = ?', DEFAULT_TENANT_SLUG);
  if (!defaultTenant) {
    await db.run('INSERT INTO tenants (slug, name) VALUES (?, ?)', DEFAULT_TENANT_SLUG, 'Default');
    defaultTenant = await db.get('SELECT id FROM tenants WHERE slug = ?', DEFAULT_TENANT_SLUG);
  }

  if (!hasTenant) {
    console.log('Adding tenant_id to products...');
    await db.exec('ALTER TABLE products ADD COLUMN tenant_id INTEGER');
  }

  console.log('Backfilling tenant_id on products...');
  await db.exec(`
    UPDATE products
    SET tenant_id = (
      SELECT c.tenant_id
      FROM campaign_products cp
      JOIN campaigns c ON c.id = cp.campaign_id
      WHERE cp.product_id = products.id
      LIMIT 1
    )
    WHERE tenant_id IS NULL
  `);
  await db.run('UPDATE products SET tenant_id = ? WHERE tenant_id IS NULL', defaultTenant.id);

  console.log('Done.');
}

main().catch((e) => { console.error(e); process.exit(1); });





