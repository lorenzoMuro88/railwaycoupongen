#!/usr/bin/env bash
set -euo pipefail

# CouponGen Restart Application Script
# Script dedicato per riavviare l'applicazione in produzione

# Carica configurazione se disponibile
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$SCRIPT_DIR/deploy-config.sh" ]]; then
    source "$SCRIPT_DIR/deploy-config.sh"
fi

# Colori per output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Funzione per logging colorato
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Funzione per eseguire comandi SSH con password automatica
ssh_with_password() {
    local commands="$1"
    local server="${2:-${DEPLOY_SERVER:-167.172.42.248}}"
    local user="${3:-${DEPLOY_USER:-root}}"
    local password="${4:-${DEPLOY_PASSWORD:-hPmCLn7dk6YfjXV}}"
    
    # Prova prima con sshpass se disponibile
    if command -v sshpass >/dev/null 2>&1; then
        log_info "Usando sshpass per autenticazione automatica"
        sshpass -p "$password" ssh -o StrictHostKeyChecking=no "$user@$server" "$commands"
    # Prova con expect se disponibile
    elif command -v expect >/dev/null 2>&1; then
        log_info "Usando expect per autenticazione automatica"
        expect -c "
            spawn ssh -o StrictHostKeyChecking=no $user@$server \"$commands\"
            expect \"password:\"
            send \"$password\r\"
            expect eof
        "
    # Prova con plink (PuTTY) se disponibile
    elif command -v plink >/dev/null 2>&1; then
        log_info "Usando plink per autenticazione automatica"
        plink -ssh -l "$user" -pw "$password" -o StrictHostKeyChecking=no "$server" "$commands"
    else
        # Ultimo fallback: chiedi all'utente di inserire la password
        log_warning "Nessun tool di autenticazione automatica trovato."
        log_warning "Inserisci la password quando richiesto:"
        ssh -o StrictHostKeyChecking=no "$user@$server" "$commands"
    fi
}

# Variabili di default
SERVER="${DEPLOY_SERVER:-167.172.42.248}"
USER="${DEPLOY_USER:-root}"
PASSWORD="${DEPLOY_PASSWORD:-hPmCLn7dk6YfjXV}"
APP_PATH="${DEPLOY_APP_PATH:-/opt/coupongen}"
ENVIRONMENT="production"
COMPOSE_FILE=""
PORT="3000"

# Parsing degli argomenti
while [[ $# -gt 0 ]]; do
    case $1 in
        -s|--server)
            SERVER="$2"
            shift 2
            ;;
        -u|--user)
            USER="$2"
            shift 2
            ;;
        -e|--env)
            ENVIRONMENT="$2"
            shift 2
            ;;
        -h|--help)
            echo "CouponGen Restart Application Script"
            echo ""
            echo "USAGE:"
            echo "    $0 [OPTIONS]"
            echo ""
            echo "OPTIONS:"
            echo "    -s, --server SERVER     IP del server"
            echo "    -u, --user USER         Utente SSH"
            echo "    -e, --env ENV           Ambiente: production/staging"
            echo "    -h, --help              Mostra questo help"
            echo ""
            echo "ESEMPI:"
            echo "    $0                      # Riavvia produzione"
            echo "    $0 --env staging        # Riavvia staging"
            echo "    $0 -s 192.168.1.100    # Riavvia su server specifico"
            exit 0
            ;;
        *)
            log_error "Opzione sconosciuta: $1"
            exit 1
            ;;
    esac
done

# Determina configurazione ambiente
if [[ "$ENVIRONMENT" == "staging" ]]; then
    COMPOSE_FILE="-f docker-compose.staging.yml"
    PORT="3001"
fi

log_info "🔄 Riavvio applicazione CouponGen"
log_info "Ambiente: $ENVIRONMENT"
log_info "Server: $SERVER"
log_info "User: $USER"
log_info "Porta: $PORT"

# Comandi SSH per riavvio
RESTART_COMMANDS="
set -e
cd $APP_PATH

echo '🔄 Riavvio applicazione $ENVIRONMENT...'
echo '  - Arresto container esistenti...'
docker compose $COMPOSE_FILE down

echo '  - Rimozione immagini non utilizzate...'
docker system prune -f

echo '  - Ricostruzione e avvio container...'
docker compose $COMPOSE_FILE up -d --build

echo '⏳ Attesa avvio applicazione...'
sleep 15

echo '🔍 Verifica stato container...'
docker compose $COMPOSE_FILE ps

echo '🔍 Verifica health check (tentativo 1/3)...'
for i in {1..3}; do
    if curl -f http://localhost:$PORT/healthz > /dev/null 2>&1; then
        echo \"✅ Health check OK (tentativo \$i)\"
        break
    else
        echo \"⏳ Health check fallito (tentativo \$i), attesa 5 secondi...\"
        if [ \$i -lt 3 ]; then
            sleep 5
        else
            echo \"❌ Health check fallito dopo 3 tentativi\"
            echo \"📋 Log applicazione:\"
            docker compose $COMPOSE_FILE logs --tail=30 app
            exit 1
        fi
    fi
done

echo '🧪 Test endpoint login...'
if curl -f -X POST http://localhost:$PORT/api/login \\
    -H 'Content-Type: application/json' \\
    -d '{\"username\":\"admin\",\"password\":\"admin123\",\"userType\":\"superadmin\"}' \\
    > /dev/null 2>&1; then
    echo '✅ Login endpoint funzionante'
else
    echo '⚠️  Login endpoint test fallito (controlla i log)'
fi

echo '📊 Stato finale container:'
docker compose $COMPOSE_FILE ps

echo '🎉 Riavvio completato con successo!'
"

# Esegui riavvio
log_info "Esecuzione riavvio sul server..."
if ! ssh_with_password "$RESTART_COMMANDS" "$SERVER" "$USER" "$PASSWORD"; then
    log_error "Riavvio fallito sul server"
    exit 1
fi

log_success "✅ Riavvio completato con successo!"
log_info "🌐 Applicazione disponibile su: https://platform.coupongen.it"
if [[ "$ENVIRONMENT" == "staging" ]]; then
    log_info "🧪 Staging disponibile su: https://staging.coupongen.it"
fi

echo
log_info "📋 Comandi utili per il monitoraggio:"
echo "  ssh $USER@$SERVER 'cd $APP_PATH && docker compose $COMPOSE_FILE logs -f app'"
echo "  ssh $USER@$SERVER 'cd $APP_PATH && docker compose $COMPOSE_FILE ps'"
echo "  curl https://platform.coupongen.it/healthz"
