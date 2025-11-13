const sqlite = require('sqlite');
const sqlite3 = require('sqlite3');

(async () => {
    try {
        const db = await sqlite.open({ filename: './data/coupons.db', driver: sqlite3.Database });
        const users = await db.all('SELECT id, username, user_type, is_active FROM auth_users');
        console.log('Users in database:');
        users.forEach(u => {
            console.log(`  - ${u.username} (${u.user_type}), active: ${u.is_active}`);
        });
        await db.close();
    } catch (e) {
        console.error('Error:', e);
        process.exit(1);
    }
})();


