# CouponGen Quick Deploy Script - PowerShell Version
# Script semplificato per deploy rapido in produzione

param(
    [string]$CommitMessage = "",
    [string]$Server = "167.172.42.248",
    [string]$User = "root",
    [string]$Password = "hPmCLn7dk6YfjXV",
    [string]$Branch = "feature/migration-cloud-multitenant-prerelease",
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
    
    # Prova diversi metodi per SSH automatico
    $plinkPath = "C:\Program Files\PuTTY\plink.exe"
    if (Test-Path $plinkPath) {
        Write-ColorLog "Usando plink per SSH automatico" "Info"
        $plinkArgs = @(
            "-ssh"
            "-l", $User
            "-pw", $Password
            $Server
            $Command
        )
        & $plinkPath @plinkArgs
    } elseif (Get-Command sshpass -ErrorAction SilentlyContinue) {
        Write-ColorLog "Usando sshpass per SSH automatico" "Info"
        $env:SSHPASS = $Password
        sshpass -e ssh -o StrictHostKeyChecking=no "$User@$Server" $Command
    } else {
        # Metodo alternativo: crea un file temporaneo con expect
        Write-ColorLog "Creando script SSH temporaneo con expect" "Info"
        $expectScript = @"
spawn ssh -o StrictHostKeyChecking=no $User@$Server "$Command"
expect "password:"
send "$Password\r"
expect eof
"@
        $tempFile = [System.IO.Path]::GetTempFileName() + ".exp"
        $expectScript | Out-File -FilePath $tempFile -Encoding ASCII
        
        try {
            if (Get-Command expect -ErrorAction SilentlyContinue) {
                & expect $tempFile
            } else {
                Write-ColorLog "expect non trovato. Installazione richiesta per SSH automatico." "Error"
                Write-ColorLog "Alternative: installa plink, sshpass o expect" "Info"
                throw "SSH automatico non disponibile"
            }
        } finally {
            Remove-Item $tempFile -ErrorAction SilentlyContinue
        }
    }
}

# Main execution
Write-ColorLog "🚀 Quick Deploy CouponGen" "Info"
Write-ColorLog "Server: $Server" "Info"
Write-ColorLog "Branch: $Branch" "Info"

# Chiedi messaggio di commit se non fornito
if ([string]::IsNullOrEmpty($CommitMessage)) {
    $CommitMessage = Read-Host "Messaggio di commit"
    if ([string]::IsNullOrEmpty($CommitMessage)) {
        $CommitMessage = "Quick deploy - $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
    }
}

Write-ColorLog "Commit: $CommitMessage" "Info"

# STEP 1: Commit e push
Write-ColorLog "📝 Commit e push modifiche..." "Info"
try {
    git add .
    git commit -m $CommitMessage
} catch {
    Write-ColorLog "Nessuna modifica da committare" "Info"
}

git push origin $Branch

# STEP 2: Deploy sul server
Write-ColorLog "🔗 Deploy sul server..." "Info"

$sshCommands = @"
set -e
cd $AppPath
echo "📥 Aggiornamento codice..."
git fetch origin
git reset --hard origin/$Branch

echo "🔄 Riavvio applicazione..."
echo "  - Arresto container esistenti..."
docker compose down

echo "  - Rimozione immagini non utilizzate..."
docker system prune -f

echo "  - Ricostruzione e avvio container..."
docker compose up -d --build

echo "⏳ Attesa avvio applicazione..."
sleep 15

echo "🔍 Verifica stato container..."
docker compose ps

echo "🔍 Verifica health check (tentativo 1/3)..."
for i in {1..3}; do
    if curl -f http://localhost:3000/healthz > /dev/null 2>&1; then
        echo "✅ Health check OK (tentativo $i)"
        break
    else
        echo "⏳ Health check fallito (tentativo $i), attesa 5 secondi..."
        if [ $i -lt 3 ]; then
            sleep 5
        else
            echo "❌ Health check fallito dopo 3 tentativi"
            echo "📋 Log applicazione:"
            docker compose logs --tail=30 app
            exit 1
        fi
    fi
done

echo "🧪 Test endpoint login..."
if curl -f -X POST http://localhost:3000/api/login \
    -H "Content-Type: application/json" \
    -d '{"username":"admin","password":"admin123","userType":"superadmin"}' \
    > /dev/null 2>&1; then
    echo "✅ Login endpoint funzionante"
else
    echo "⚠️  Login endpoint test fallito (controlla i log)"
fi

echo "📊 Stato finale container:"
docker compose ps

echo "🎉 Deploy e riavvio completati con successo!"
"@

try {
    Invoke-SSHCommand -Command $sshCommands -Server $Server -User $User -Password $Password
    Write-ColorLog "✅ Deploy completato con successo!" "Success"
    Write-ColorLog "🌐 Applicazione: https://platform.coupongen.it" "Info"
} catch {
    Write-ColorLog "❌ Deploy fallito: $($_.Exception.Message)" "Error"
    exit 1
}
