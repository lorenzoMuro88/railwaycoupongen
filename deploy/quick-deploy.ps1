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
docker compose down
docker compose up -d --build

echo "⏳ Attesa avvio..."
sleep 10

echo "🔍 Verifica health check..."
if curl -f http://localhost:3000/healthz > /dev/null 2>&1; then
    echo "✅ Health check OK"
else
    echo "❌ Health check fallito"
    docker compose logs --tail=20 app
    exit 1
fi

echo "📊 Stato container:"
docker compose ps

echo "🎉 Deploy completato!"
"@

try {
    Invoke-SSHCommand -Command $sshCommands -Server $Server -User $User -Password $Password
    Write-ColorLog "✅ Deploy completato con successo!" "Success"
    Write-ColorLog "🌐 Applicazione: https://platform.coupongen.it" "Info"
} catch {
    Write-ColorLog "❌ Deploy fallito: $($_.Exception.Message)" "Error"
    exit 1
}
