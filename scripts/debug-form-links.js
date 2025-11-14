const { open } = require('sqlite');
const sqlite3 = require('sqlite3');
const path = require('path');

async function checkFormLinks(token, tenantId) {
    const db = await open({
        filename: path.join(__dirname, '..', 'data', 'coupons.db'),
        driver: sqlite3.Database
    });
    
    try {
        // Check link status
        const link = await db.get(
            'SELECT id, token, used_at, tenant_id, campaign_id, created_at FROM form_links WHERE token = ?',
            token
        );
        
        if (!link) {
            console.log(`❌ Link ${token} NOT FOUND in database`);
            return;
        }
        
        console.log(`\n📋 Link Status for token: ${token.substring(0, 15)}...`);
        console.log(`   ID: ${link.id}`);
        console.log(`   Tenant ID: ${link.tenant_id} (expected: ${tenantId})`);
        console.log(`   Campaign ID: ${link.campaign_id}`);
        console.log(`   Used At: ${link.used_at || 'NULL (not used)'}`);
        console.log(`   Created At: ${link.created_at}`);
        
        // Check if tenant matches
        if (link.tenant_id !== tenantId) {
            console.log(`   ⚠️  WARNING: Tenant ID mismatch!`);
        }
        
        // Check campaign status
        const campaign = await db.get(
            'SELECT id, campaign_code, is_active, tenant_id FROM campaigns WHERE id = ?',
            link.campaign_id
        );
        
        if (campaign) {
            console.log(`\n📢 Campaign Status:`);
            console.log(`   ID: ${campaign.id}`);
            console.log(`   Code: ${campaign.campaign_code}`);
            console.log(`   Active: ${campaign.is_active ? 'YES' : 'NO'}`);
            console.log(`   Tenant ID: ${campaign.tenant_id}`);
        } else {
            console.log(`\n❌ Campaign NOT FOUND for campaign_id: ${link.campaign_id}`);
        }
        
        // Check all links for this campaign
        const allLinks = await db.all(
            'SELECT id, token, used_at FROM form_links WHERE campaign_id = ? ORDER BY id',
            link.campaign_id
        );
        
        console.log(`\n📊 All links for campaign ${link.campaign_id}:`);
        allLinks.forEach((l, idx) => {
            const status = l.used_at ? '🔴 USED' : '🟢 AVAILABLE';
            const isCurrent = l.token === token ? ' ⬅️ CURRENT' : '';
            console.log(`   ${idx + 1}. Token: ${l.token.substring(0, 15)}... ${status}${isCurrent}`);
        });
        
    } finally {
        await db.close();
    }
}

async function main() {
    const args = process.argv.slice(2);
    
    if (args.length < 2) {
        console.log('Usage: node scripts/debug-form-links.js <token> <tenantId>');
        console.log('Example: node scripts/debug-form-links.js ABC123 42');
        process.exit(1);
    }
    
    const token = args[0];
    const tenantId = parseInt(args[1]);
    
    await checkFormLinks(token, tenantId);
}

main().catch(console.error);


