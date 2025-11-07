const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

async function main() {
  const db = await open({
    filename: path.join(__dirname, '..', 'data', 'coupons.db'),
    driver: sqlite3.Database
  });

  const days = parseInt(process.env.CLEANUP_OLDER_THAN_DAYS || '30', 10);
  await db.exec('PRAGMA foreign_keys = OFF');

  // Identify test users
  const usersToDelete = await db.all(`
    SELECT id FROM users
    WHERE (
      LOWER(email) LIKE '%test%'
      OR LOWER(email) LIKE '%example%'
      OR LOWER(email) LIKE '%mailinator.%'
    )
    OR (
      id NOT IN (SELECT DISTINCT user_id FROM coupons)
      AND datetime(created_at) < datetime('now', ?)
    )
  `, [`-${days} days`]);

  const userIds = usersToDelete.map(u => u.id);
  if (userIds.length) {
    const placeholders = userIds.map(() => '?').join(',');
    console.log(`Deleting ${userIds.length} users (test/old)...`);
    await db.run(`DELETE FROM user_custom_data WHERE user_id IN (${placeholders})`, userIds);
    await db.run(`DELETE FROM coupons WHERE user_id IN (${placeholders})`, userIds);
    await db.run(`DELETE FROM users WHERE id IN (${placeholders})`, userIds);
  } else {
    console.log('No users matched cleanup criteria.');
  }

  // Identify products to delete: test-named or unassociated and old
  const productsToDelete = await db.all(`
    SELECT p.id
    FROM products p
    LEFT JOIN campaign_products cp ON cp.product_id = p.id
    WHERE (
      LOWER(p.name) LIKE 'test%'
      OR (p.sku IS NOT NULL AND UPPER(p.sku) LIKE 'TEST%')
    )
    OR (
      cp.id IS NULL AND datetime(p.created_at) < datetime('now', ?)
    )
  `, [`-${days} days`]);

  const productIds = productsToDelete.map(p => p.id);
  if (productIds.length) {
    const placeholders = productIds.map(() => '?').join(',');
    console.log(`Deleting ${productIds.length} products (test/old unassociated)...`);
    await db.run(`DELETE FROM campaign_products WHERE product_id IN (${placeholders})`, productIds);
    await db.run(`DELETE FROM products WHERE id IN (${placeholders})`, productIds);
  } else {
    console.log('No products matched cleanup criteria.');
  }

  console.log('Cleanup complete.');
}

main().catch((e) => { console.error(e); process.exit(1); });





