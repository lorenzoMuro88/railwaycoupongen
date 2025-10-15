# CouponGen Database Initialization Script
# Script per inizializzare il database con utenti di default

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
Write-ColorLog "Inizializzazione database CouponGen" "Info"
Write-ColorLog "Server: $Server" "Info"
Write-ColorLog "User: $User" "Info"

# Comandi per inizializzare il database
$initCommands = @"
set -e
cd $AppPath

echo "=== INIZIALIZZAZIONE DATABASE COUPONGEN ==="
echo ""

echo "1. Backup database esistente (se presente):"
if [ -f "data/coupons.db" ]; then
    cp data/coupons.db data/coupons.db.backup.\$(date +%Y%m%d_%H%M%S)
    echo "✅ Backup creato"
else
    echo "Nessun database esistente da backup"
fi
echo ""

echo "2. Rimozione database esistente:"
rm -f data/coupons.db
echo "✅ Database rimosso"
echo ""

echo "3. Riavvio applicazione per ricreare database:"
docker compose down
docker compose up -d --build
echo "✅ Applicazione riavviata"
echo ""

echo "4. Attesa inizializzazione database:"
sleep 20
echo ""

echo "5. Verifica database creato:"
if [ -f "data/coupons.db" ]; then
    echo "✅ Database creato: data/coupons.db"
    ls -la data/coupons.db
else
    echo "❌ Database non creato"
    exit 1
fi
echo ""

echo "6. Verifica utenti di default:"
docker compose exec app node -e "
    const sqlite3 = require('sqlite3').verbose();
    const { open } = require('sqlite');
    async function checkUsers() {
        try {
            const db = await open({ filename: 'data/coupons.db', driver: sqlite3.Database });
            
            const users = await db.all('SELECT id, username, user_type, is_active, tenant_id FROM auth_users');
            console.log('Utenti trovati:', users.length);
            users.forEach(user => {
                console.log(\`  - ID: \${user.id}, Username: \${user.username}, Type: \${user.user_type}, Active: \${user.is_active}, Tenant: \${user.tenant_id}\`);
            });
            
            const tenants = await db.all('SELECT id, slug, name FROM tenants');
            console.log('Tenant trovati:', tenants.length);
            tenants.forEach(tenant => {
                console.log(\`  - ID: \${tenant.id}, Slug: \${tenant.slug}, Name: \${tenant.name}\`);
            });
            
            await db.close();
        } catch (error) {
            console.log('❌ Errore verifica utenti:', error.message);
        }
    }
    checkUsers();
"
echo ""

echo "7. Test endpoint login:"
curl -f -X POST http://localhost:3000/api/login \
    -H "Content-Type: application/json" \
    -d '{"username":"admin","password":"admin123","userType":"superadmin"}' \
    && echo "✅ Login test OK" || echo "❌ Login test fallito"
echo ""

echo "=== INIZIALIZZAZIONE COMPLETATA ==="
"@

try {
    Write-ColorLog "Esecuzione inizializzazione database sul server..." "Info"
    Invoke-SSHCommand -Command $initCommands -Server $Server -User $User -Password $Password
    Write-ColorLog "Inizializzazione database completata!" "Success"
} catch {
    Write-ColorLog "Inizializzazione database fallita: $($_.Exception.Message)" "Error"
    exit 1
}
