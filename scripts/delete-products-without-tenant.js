const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

async function main() {
  const nameArg = process.argv.slice(2).join(' ');
  const db = await open({
    filename: path.join(__dirname, '..', 'data', 'coupons.db'),
    driver: sqlite3.Database
  });

  let rows;
  if (nameArg) {
    rows = await db.all('SELECT id FROM products WHERE tenant_id IS NULL AND LOWER(name) = LOWER(?)', nameArg);
  } else {
    rows = await db.all('SELECT id FROM products WHERE tenant_id IS NULL');
  }
  const ids = rows.map(r => r.id);
  if (!ids.length) {
    console.log('No products without tenant found.');
    return;
  }
  const placeholders = ids.map(() => '?').join(',');
  await db.run(`DELETE FROM campaign_products WHERE product_id IN (${placeholders})`, ids);
  const res = await db.run(`DELETE FROM products WHERE id IN (${placeholders})`, ids);
  console.log(`Deleted ${res.changes} products without tenant.`);
}

main().catch((e) => { console.error(e); process.exit(1); });




