# CouponGen Database Check Script
# Script per verificare lo stato del database

param(
    [string]$Server = "167.172.42.248",
    [string]$User = "root",
    [string]$Password = "hPmCLn7dk6YfjXV",
    [string]$AppPath = "/opt/coupongen"
)

# Colori per output
$Colors = @{
    Info = "Cyan"
    Success = "Green"
    Warning = "Yellow"
    Error = "Red"
}

function Write-ColorLog {
    param(
        [string]$Message,
        [string]$Level = "Info"
    )
    $color = if ($Colors.ContainsKey($Level)) { $Colors[$Level] } else { "White" }
    Write-Host "[$Level] $Message" -ForegroundColor $color
}

function Invoke-SSHCommand {
    param(
        [string]$Command,
        [string]$Server,
        [string]$User,
        [string]$Password
    )
    
    # Usa plink (PuTTY) se disponibile, altrimenti ssh
    if (Get-Command plink -ErrorAction SilentlyContinue) {
        $plinkArgs = @(
            "-ssh"
            "-l", $User
            "-pw", $Password
            "-o", "StrictHostKeyChecking=no"
            $Server
            $Command
        )
        & plink @plinkArgs
    } else {
        # Fallback: usa ssh standard (richiederà password manuale)
        Write-ColorLog "plink non trovato. Usando ssh standard. Inserisci la password quando richiesto." "Warning"
        ssh -o StrictHostKeyChecking=no "$User@$Server" $Command
    }
}

# Main execution
Write-ColorLog "Verifica database CouponGen" "Info"
Write-ColorLog "Server: $Server" "Info"
Write-ColorLog "User: $User" "Info"

# Comandi per verificare il database
$dbCheckCommands = @"
set -e
cd $AppPath

echo "=== VERIFICA DATABASE COUPONGEN ==="
echo ""

echo "1. Verifica file database:"
if [ -f "data/coupons.db" ]; then
    echo "✅ Database trovato: data/coupons.db"
    ls -la data/coupons.db
    echo ""
    
    echo "2. Test connessione database:"
    docker compose exec app node -e "
        const sqlite3 = require('sqlite3').verbose();
        const { open } = require('sqlite');
        async function testDb() {
            try {
                console.log('Tentativo connessione database...');
                const db = await open({ filename: 'data/coupons.db', driver: sqlite3.Database });
                console.log('✅ Connessione database riuscita');
                
                console.log('Verifica tabelle...');
                const tables = await db.all(\"SELECT name FROM sqlite_master WHERE type='table'\");
                console.log('Tabelle trovate:', tables.map(t => t.name).join(', '));
                
                console.log('Verifica tabella auth_users...');
                const authUsers = await db.all('SELECT COUNT(*) as count FROM auth_users');
                console.log('✅ Utenti auth trovati:', authUsers[0].count);
                
                console.log('Lista utenti auth:');
                const users = await db.all('SELECT id, username, user_type, is_active, tenant_id FROM auth_users');
                users.forEach(user => {
                    console.log(\`  - ID: \${user.id}, Username: \${user.username}, Type: \${user.user_type}, Active: \${user.is_active}, Tenant: \${user.tenant_id}\`);
                });
                
                console.log('Verifica tabella tenants...');
                const tenants = await db.all('SELECT COUNT(*) as count FROM tenants');
                console.log('✅ Tenant trovati:', tenants[0].count);
                
                const tenantList = await db.all('SELECT id, slug, name FROM tenants');
                tenantList.forEach(tenant => {
                    console.log(\`  - ID: \${tenant.id}, Slug: \${tenant.slug}, Name: \${tenant.name}\`);
                });
                
                await db.close();
                console.log('✅ Test database completato con successo');
            } catch (error) {
                console.log('❌ Errore database:', error.message);
                console.log('Stack:', error.stack);
            }
        }
        testDb();
    "
else
    echo "❌ Database non trovato: data/coupons.db"
    echo "Creazione database..."
    docker compose exec app node -e "
        const sqlite3 = require('sqlite3').verbose();
        const { open } = require('sqlite');
        async function createDb() {
            try {
                const db = await open({ filename: 'data/coupons.db', driver: sqlite3.Database });
                console.log('✅ Database creato');
                await db.close();
            } catch (error) {
                console.log('❌ Errore creazione database:', error.message);
            }
        }
        createDb();
    "
fi
echo ""

echo "3. Verifica permessi file:"
ls -la data/
echo ""

echo "4. Test endpoint login con debug:"
docker compose exec app node -e "
    const sqlite3 = require('sqlite3').verbose();
    const { open } = require('sqlite');
    async function testLogin() {
        try {
            const db = await open({ filename: 'data/coupons.db', driver: sqlite3.Database });
            
            console.log('Test query login...');
            const user = await db.get(
                'SELECT * FROM auth_users WHERE username = ? AND user_type = ? AND is_active = 1',
                'admin', 'superadmin'
            );
            
            if (user) {
                console.log('✅ Utente admin trovato:', user);
                console.log('Password hash:', user.password_hash);
                
                // Test verifica password
                const testPassword = 'admin123';
                const testHash = Buffer.from(testPassword).toString('base64');
                console.log('Test hash:', testHash);
                console.log('Hash match:', user.password_hash === testHash);
            } else {
                console.log('❌ Utente admin non trovato');
            }
            
            await db.close();
        } catch (error) {
            console.log('❌ Errore test login:', error.message);
        }
    }
    testLogin();
"
echo ""

echo "=== FINE VERIFICA DATABASE ==="
"@

try {
    Write-ColorLog "Esecuzione verifica database sul server..." "Info"
    Invoke-SSHCommand -Command $dbCheckCommands -Server $Server -User $User -Password $Password
} catch {
    Write-ColorLog "Verifica database fallita: $($_.Exception.Message)" "Error"
    exit 1
}
