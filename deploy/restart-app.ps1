# CouponGen Restart Application Script - PowerShell Version
# Script dedicato per riavviare l'applicazione in produzione

param(
    [string]$Server = "167.172.42.248",
    [string]$User = "root",
    [string]$Password = "hPmCLn7dk6YfjXV",
    [string]$AppPath = "/opt/coupongen",
    [string]$Environment = "production"
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

# Determina configurazione ambiente
$ComposeFile = if ($Environment -eq "staging") { "-f docker-compose.staging.yml" } else { "" }
$Port = if ($Environment -eq "staging") { "3001" } else { "3000" }

# Main execution
Write-ColorLog "🔄 Riavvio applicazione CouponGen" "Info"
Write-ColorLog "Ambiente: $Environment" "Info"
Write-ColorLog "Server: $Server" "Info"
Write-ColorLog "User: $User" "Info"
Write-ColorLog "Porta: $Port" "Info"

# Comandi SSH per riavvio
$restartCommands = @"
set -e
cd $AppPath

echo "🔄 Riavvio applicazione $Environment..."
echo "  - Arresto container esistenti..."
docker compose $ComposeFile down

echo "  - Rimozione immagini non utilizzate..."
docker system prune -f

echo "  - Ricostruzione e avvio container..."
docker compose $ComposeFile up -d --build

echo "⏳ Attesa avvio applicazione..."
sleep 15

echo "🔍 Verifica stato container..."
docker compose $ComposeFile ps

echo "🔍 Verifica health check (tentativo 1/3)..."
for i in {1..3}; do
    if curl -f http://localhost:$Port/healthz > /dev/null 2>&1; then
        echo "✅ Health check OK (tentativo \$i)"
        break
    else
        echo "⏳ Health check fallito (tentativo \$i), attesa 5 secondi..."
        if [ \$i -lt 3 ]; then
            sleep 5
        else
            echo "❌ Health check fallito dopo 3 tentativi"
            echo "📋 Log applicazione:"
            docker compose $ComposeFile logs --tail=30 app
            exit 1
        fi
    fi
done

echo "🧪 Test endpoint login..."
if curl -f -X POST http://localhost:$Port/api/login \
    -H "Content-Type: application/json" \
    -d '{"username":"admin","password":"admin123","userType":"superadmin"}' \
    > /dev/null 2>&1; then
    echo "✅ Login endpoint funzionante"
else
    echo "⚠️  Login endpoint test fallito (controlla i log)"
fi

echo "📊 Stato finale container:"
docker compose $ComposeFile ps

echo "🎉 Riavvio completato con successo!"
"@

try {
    Write-ColorLog "Esecuzione riavvio sul server..." "Info"
    Invoke-SSHCommand -Command $restartCommands -Server $Server -User $User -Password $Password
    Write-ColorLog "Riavvio completato con successo!" "Success"
    Write-ColorLog "Applicazione disponibile su: https://platform.coupongen.it" "Info"
    
    if ($Environment -eq "staging") {
        Write-ColorLog "Staging disponibile su: https://staging.coupongen.it" "Info"
    }
    
    Write-Host ""
    Write-ColorLog "Comandi utili per il monitoraggio:" "Info"
    Write-Host "  ssh $User@$Server 'cd $AppPath && docker compose $ComposeFile logs -f app'"
    Write-Host "  ssh $User@$Server 'cd $AppPath && docker compose $ComposeFile ps'"
    Write-Host "  curl https://platform.coupongen.it/healthz"
    
} catch {
    Write-ColorLog "Riavvio fallito: $($_.Exception.Message)" "Error"
    exit 1
}
