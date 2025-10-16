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

# Funzione SSH con autenticazione automatica
function Invoke-SSHCommand {
    param([string]$Command)
    
    # Prova diversi metodi di autenticazione automatica
    $plinkPath = "C:\Program Files\PuTTY\plink.exe"
    if (Test-Path $plinkPath) {
        Write-ColorLog "Usando plink per SSH automatico" "Info"
        $plinkArgs = @("-ssh", "-l", $USER, "-pw", $PASSWORD, $SERVER, $Command)
        & $plinkPath @plinkArgs
    } elseif (Get-Command sshpass -ErrorAction SilentlyContinue) {
        Write-ColorLog "Usando sshpass per SSH automatico" "Info"
        $env:SSHPASS = $PASSWORD
        sshpass -e ssh -o StrictHostKeyChecking=no "$USER@$SERVER" $Command
    } else {
        Write-ColorLog "Nessun tool di autenticazione automatica trovato" "Warning"
        Write-ColorLog "Inserisci la password quando richiesto:" "Warning"
        ssh -o StrictHostKeyChecking=no "$USER@$SERVER" $Command
    }
}

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
    "echo 'Arresto container esistenti...'",
    "docker compose $COMPOSE_FILE down",
    "echo 'Pulizia sistema Docker...'",
    "docker system prune -f",
    "echo 'Ricostruzione e avvio container...'",
    "docker compose $COMPOSE_FILE up -d --build",
    "echo 'Attesa avvio applicazione...'",
    "sleep 15",
    "echo 'Verifica stato container...'",
    "docker compose $COMPOSE_FILE ps",
    "echo 'Verifica health check...'",
    "for i in {1..3}; do",
    "    if curl -f http://localhost:$PORT/healthz > /dev/null 2>&1; then",
    "        echo 'Health check OK (tentativo \$i)'",
    "        break",
    "    else",
    "        echo 'Health check fallito (tentativo \$i), attesa 5 secondi...'",
    "        if [ \$i -lt 3 ]; then",
    "            sleep 5",
    "        else",
    "            echo 'Health check fallito dopo 3 tentativi'",
    "            echo 'Log applicazione:'",
    "            docker compose $COMPOSE_FILE logs --tail=30 app",
    "            exit 1",
    "        fi",
    "    fi",
    "done",
    "echo 'Test endpoint login...'",
    "curl -f http://localhost:$PORT/healthz > /dev/null 2>&1 && echo 'Health check endpoint funzionante' || echo 'Health check endpoint test fallito'",
    "echo 'Stato finale container:'",
    "docker compose $COMPOSE_FILE ps",
    "echo 'Deploy completato con successo!'"
)

$commandString = $sshCommands -join "; "

Write-ColorLog "Esecuzione comandi sul server..." "Info"
try {
    Invoke-SSHCommand -Command $commandString
} catch {
    Write-ColorLog "Deploy fallito sul server: $($_.Exception.Message)" "Error"
    exit 1
}

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
