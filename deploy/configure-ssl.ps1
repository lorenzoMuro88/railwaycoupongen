# CouponGen SSL Configuration Script
# Script per configurare SSL su Nginx

param(
    [string]$Server = "167.172.42.248",
    [string]$User = "root",
    [string]$Password = "hPmCLn7dk6YfjXV"
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
Write-ColorLog "🔒 Configurazione SSL CouponGen" "Info"
Write-ColorLog "Server: $Server" "Info"
Write-ColorLog "User: $User" "Info"

# Comandi SSH per configurare SSL
$sslCommands = @"
set -e
cd /opt/coupongen

echo "🔒 Configurazione SSL per platform.coupongen.it"

# Controlla certificati esistenti
echo "📋 Controllo certificati esistenti..."
ls -la /etc/letsencrypt/live/platform.coupongen.it/

# Copia configurazione Nginx aggiornata
echo "📝 Aggiornamento configurazione Nginx..."
cp nginx.conf.example /etc/nginx/nginx.conf

# Test configurazione
echo "🧪 Test configurazione Nginx..."
nginx -t

# Riavvia Nginx
echo "🔄 Riavvio Nginx..."
systemctl restart nginx

# Verifica stato
echo "✅ Verifica stato servizi..."
systemctl status nginx --no-pager -l

echo "🧪 Test HTTPS..."
curl -I https://platform.coupongen.it/healthz || echo "⚠️ Test HTTPS fallito"

echo "🎉 Configurazione SSL completata!"
"@

try {
    Write-ColorLog "Esecuzione configurazione SSL sul server..." "Info"
    Invoke-SSHCommand -Command $sslCommands -Server $Server -User $User -Password $Password
    Write-ColorLog "✅ Configurazione SSL completata con successo!" "Success"
    Write-ColorLog "🌐 Applicazione HTTPS: https://platform.coupongen.it" "Info"
} catch {
    Write-ColorLog "❌ Configurazione SSL fallita: $($_.Exception.Message)" "Error"
    exit 1
}
