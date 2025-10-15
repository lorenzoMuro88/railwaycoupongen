# CouponGen Server Diagnostics Script
# Script per diagnosticare problemi sul server

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
Write-ColorLog "Diagnostica server CouponGen" "Info"
Write-ColorLog "Server: $Server" "Info"
Write-ColorLog "User: $User" "Info"

# Comandi di diagnostica
$diagnosticCommands = @"
set -e
cd $AppPath

echo "=== DIAGNOSTICA SERVER COUPONGEN ==="
echo ""

echo "1. Stato container Docker:"
docker compose ps
echo ""

echo "2. Log applicazione (ultimi 30):"
docker compose logs --tail=30 app
echo ""

echo "3. Verifica database:"
if [ -f "data/coupons.db" ]; then
    echo "Database trovato: data/coupons.db"
    ls -la data/coupons.db
    echo ""
    echo "Test connessione database:"
    docker compose exec app node -e "
        const sqlite3 = require('sqlite3').verbose();
        const { open } = require('sqlite');
        async function testDb() {
            try {
                const db = await open({ filename: 'data/coupons.db', driver: sqlite3.Database });
                const result = await db.get('SELECT COUNT(*) as count FROM auth_users');
                console.log('✅ Database OK - Utenti auth:', result.count);
                await db.close();
            } catch (error) {
                console.log('❌ Errore database:', error.message);
            }
        }
        testDb();
    "
else
    echo "❌ Database non trovato: data/coupons.db"
fi
echo ""

echo "4. Verifica file di configurazione:"
if [ -f ".env" ]; then
    echo "File .env trovato"
    echo "Variabili principali:"
    grep -E "^(NODE_ENV|PORT|SESSION_SECRET|DEFAULT_TENANT_SLUG)" .env || echo "Variabili non trovate"
else
    echo "❌ File .env non trovato"
fi
echo ""

echo "5. Verifica permessi file:"
ls -la server.js
ls -la data/
echo ""

echo "6. Test endpoint locali:"
echo "Health check:"
curl -f http://localhost:3000/healthz && echo "✅ Health check OK" || echo "❌ Health check fallito"
echo ""

echo "7. Verifica processi Node.js:"
ps aux | grep node || echo "Nessun processo Node.js trovato"
echo ""

echo "8. Verifica porte in ascolto:"
netstat -tlnp | grep :3000 || echo "Porta 3000 non in ascolto"
echo ""

echo "=== FINE DIAGNOSTICA ==="
"@

try {
    Write-ColorLog "Esecuzione diagnostica sul server..." "Info"
    Invoke-SSHCommand -Command $diagnosticCommands -Server $Server -User $User -Password $Password
} catch {
    Write-ColorLog "Diagnostica fallita: $($_.Exception.Message)" "Error"
    exit 1
}
