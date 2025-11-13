const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

async function main() {
	const db = await open({
		filename: path.join(__dirname, '..', 'data', 'coupons.db'),
		driver: sqlite3.Database
	});

	// Count before
	const before = await db.get("SELECT COUNT(*) AS cnt FROM auth_users WHERE user_type IN ('admin','store')");
	// Delete admin/store users, preserving superadmin
	const res = await db.run("DELETE FROM auth_users WHERE user_type IN ('admin','store')");
	const after = await db.get("SELECT COUNT(*) AS cnt FROM auth_users WHERE user_type IN ('admin','store')");

	console.log(JSON.stringify({ deleted: res.changes || 0, before: before.cnt, after: after.cnt }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });




