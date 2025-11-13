const sqlite = require('sqlite');
const sqlite3 = require('sqlite3');

(async () => {
    try {
        const db = await sqlite.open({ filename: './data/coupons.db', driver: sqlite3.Database });
        const indexes = await db.all("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='campaigns'");
        console.log('Indexes on campaigns table:');
        indexes.forEach(idx => {
            console.log(`  - ${idx.name}: ${idx.sql || 'N/A'}`);
        });
        
        // Also check table definition for UNIQUE constraints
        const tableInfo = await db.all("SELECT sql FROM sqlite_master WHERE type='table' AND name='campaigns'");
        if (tableInfo.length > 0) {
            console.log('\nTable definition:');
            console.log(tableInfo[0].sql);
        }
        
        await db.close();
    } catch (e) {
        console.error('Error:', e);
        process.exit(1);
    }
})();


