# CouponGen Deploy Script - Versione Pulita

param(
    [string]$Environment = "production"
)

# Colori per output
function Write-ColorLog {
    param(
        [string]$Message,
        [string]$Level = "Info"
    )
    $color = switch ($Level) {
        "Info" { "Cyan" }
        "Success" { "Green" }
        "Warning" { "Yellow" }
        "Error" { "Red" }
        default { "White" }
    }
    Write-Host "[$Level] $Message" -ForegroundColor $color
}

# Configurazione
$SERVER = "167.172.42.248"
$USER = "root"
$PASSWORD = "hPmCLn7dk6YfjXV"
$BRANCH = "main"
$APP_PATH = "/opt/coupongen"

# Configurazione ambiente
if ($Environment -eq "staging") {
    $COMPOSE_FILE = "-f docker-compose.staging.yml"
    $PORT = "3001"
    $URL = "https://staging.coupongen.it"
} else {
    $COMPOSE_FILE = ""
    $PORT = "3000"
    $URL = "https://platform.coupongen.it"
}

Write-ColorLog "Deploy CouponGen - Ambiente: $Environment" "Info"
Write-ColorLog "Server: $SERVER" "Info"
Write-ColorLog "Branch: $BRANCH" "Info"
Write-ColorLog "URL: $URL" "Info"

# STEP 1: Commit e push su GitHub
Write-ColorLog "STEP 1: Commit e push su GitHub" "Info"

$gitStatus = git status --porcelain
if ($gitStatus) {
    $COMMIT_MESSAGE = Read-Host "Messaggio di commit"
    if ([string]::IsNullOrEmpty($COMMIT_MESSAGE)) {
        $COMMIT_MESSAGE = "Deploy $Environment - $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
    }
    
    git add .
    git commit -m $COMMIT_MESSAGE
    Write-ColorLog "Commit creato: $COMMIT_MESSAGE" "Success"
} else {
    Write-ColorLog "Nessuna modifica da committare" "Warning"
}

git push cloud $BRANCH
Write-ColorLog "Push completato su GitHub" "Success"

# STEP 2: Comandi SSH semplificati
Write-ColorLog "STEP 2: Aggiornamento server" "Info"

$sshCommands = @(
    "set -e",
    "cd $APP_PATH",
    "echo 'Aggiornamento codice da branch $BRANCH...'",
    "git fetch cloud",
    "git reset --hard cloud/$BRANCH",
    "echo 'Codice aggiornato'",
    "echo 'Ricostruzione container $Environment...'",
    "docker compose $COMPOSE_FILE down",
    "docker system prune -f",
    "docker compose $COMPOSE_FILE up -d --build",
    "echo 'Attesa avvio applicazione...'",
    "sleep 15",
    "echo 'Verifica stato container...'",
    "docker compose $COMPOSE_FILE ps",
    "echo 'Deploy completato con successo!'"
)

$commandString = $sshCommands -join "; "

Write-ColorLog "Esecuzione comandi sul server..." "Info"
Write-ColorLog "Comando: $commandString" "Info"

# STEP 3: Test finale
Write-ColorLog "STEP 3: Test finale" "Info"

try {
    $response = Invoke-WebRequest -Uri "$URL/healthz" -UseBasicParsing -TimeoutSec 10
    if ($response.StatusCode -eq 200) {
        Write-ColorLog "Health check esterno OK" "Success"
    } else {
        Write-ColorLog "Health check esterno fallito (Status: $($response.StatusCode))" "Warning"
    }
} catch {
    Write-ColorLog "Health check esterno fallito (potrebbe essere normale se il server non e accessibile dall esterno)" "Warning"
}

Write-ColorLog "Deploy completato con successo!" "Success"
Write-ColorLog "Applicazione disponibile su: $URL" "Info"

Write-Host ""
Write-ColorLog "Comandi utili per il monitoraggio:" "Info"
Write-Host "  ssh root@167.172.42.248"
Write-Host "  cd /opt/coupongen"
Write-Host "  docker compose logs -f app"
Write-Host "  docker compose ps"
Write-Host "  curl https://platform.coupongen.it/healthz"
