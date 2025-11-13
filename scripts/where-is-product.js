const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

async function main() {
  const name = process.argv.slice(2).join(' ') || 'nuovo test';
  const db = await open({
    filename: path.join(__dirname, '..', 'data', 'coupons.db'),
    driver: sqlite3.Database
  });

  const rows = await db.all(`
    SELECT p.id, p.name, p.sku, p.tenant_id, t.slug as tenant_slug, t.name as tenant_name
    FROM products p
    LEFT JOIN tenants t ON t.id = p.tenant_id
    WHERE LOWER(p.name) = LOWER(?)
    ORDER BY p.id DESC
  `, name);

  if (!rows.length) {
    console.log(JSON.stringify({ found: 0, products: [] }, null, 2));
    return;
  }
  console.log(JSON.stringify({ found: rows.length, products: rows }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });






