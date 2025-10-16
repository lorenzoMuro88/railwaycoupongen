#!/usr/bin/env bash
set -euo pipefail

# CouponGen Unified Deploy Script
# Push su GitHub + aggiornamento server con ricostruzione container

# Carica configurazione se disponibile
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "$SCRIPT_DIR/deploy/deploy-config.sh" ]]; then
    source "$SCRIPT_DIR/deploy/deploy-config.sh"
fi

# Colori per output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Configurazione di default
SERVER="${DEPLOY_SERVER:-167.172.42.248}"
USER="${DEPLOY_USER:-root}"
PASSWORD="${DEPLOY_PASSWORD:-hPmCLn7dk6YfjXV}"
BRANCH="${DEPLOY_BRANCH:-feature/migration-cloud-multitenant-prerelease}"
APP_PATH="${DEPLOY_APP_PATH:-/opt/coupongen}"
ENVIRONMENT="${1:-production}"

# Validazione ambiente
if [[ "$ENVIRONMENT" != "production" && "$ENVIRONMENT" != "staging" ]]; then
    log_error "Ambiente deve essere 'production' o 'staging'"
    echo "Uso: $0 [production|staging]"
    exit 1
fi

# Configurazione ambiente
if [[ "$ENVIRONMENT" == "staging" ]]; then
    COMPOSE_FILE="-f docker-compose.staging.yml"
    PORT="3001"
    URL="https://staging.coupongen.it"
else
    COMPOSE_FILE=""
    PORT="3000"
    URL="https://platform.coupongen.it"
fi

# Funzione SSH con autenticazione automatica
ssh_exec() {
    local commands="$1"
    
    # Prova diversi metodi di autenticazione automatica
    if command -v sshpass >/dev/null 2>&1; then
        sshpass -p "$PASSWORD" ssh -o StrictHostKeyChecking=no "$USER@$SERVER" "$commands"
    elif command -v expect >/dev/null 2>&1; then
        expect -c "
            spawn ssh -o StrictHostKeyChecking=no $USER@$SERVER \"$commands\"
            expect \"password:\"
            send \"$PASSWORD\r\"
            expect eof
        "
    elif command -v plink >/dev/null 2>&1; then
        plink -ssh -l "$USER" -pw "$PASSWORD" -o StrictHostKeyChecking=no "$SERVER" "$commands"
    else
        log_warning "Nessun tool di autenticazione automatica trovato"
        log_warning "Inserisci la password quando richiesto:"
        ssh -o StrictHostKeyChecking=no "$USER@$SERVER" "$commands"
    fi
}

# Main execution
log_info "🚀 Deploy CouponGen - Ambiente: $ENVIRONMENT"
log_info "Server: $SERVER"
log_info "Branch: $BRANCH"
log_info "URL: $URL"

# STEP 1: Commit e push su GitHub
log_info "📝 STEP 1: Commit e push su GitHub"

# Controlla se ci sono modifiche
if ! git diff --quiet || ! git diff --cached --quiet; then
    # Chiedi messaggio di commit
    read -p "Messaggio di commit: " COMMIT_MESSAGE
    if [[ -z "$COMMIT_MESSAGE" ]]; then
        COMMIT_MESSAGE="Deploy $ENVIRONMENT - $(date '+%Y-%m-%d %H:%M:%S')"
    fi
    
    git add .
    git commit -m "$COMMIT_MESSAGE"
    log_success "✅ Commit creato: $COMMIT_MESSAGE"
else
    log_warning "Nessuna modifica da committare"
fi

# Push al repository
git push origin "$BRANCH"
log_success "✅ Push completato su GitHub"

# STEP 2: Aggiornamento server
log_info "🔗 STEP 2: Aggiornamento server e ricostruzione container"

# Comandi SSH per aggiornamento e ricostruzione
SSH_COMMANDS="
set -e
cd $APP_PATH

echo '📥 Aggiornamento codice da branch $BRANCH...'
git fetch origin
git reset --hard origin/$BRANCH
echo '✅ Codice aggiornato'

echo '🔄 Ricostruzione container $ENVIRONMENT...'
echo '  - Arresto container esistenti...'
docker compose $COMPOSE_FILE down

echo '  - Pulizia sistema Docker...'
docker system prune -f

echo '  - Ricostruzione e avvio container...'
docker compose $COMPOSE_FILE up -d --build

echo '⏳ Attesa avvio applicazione...'
sleep 15

echo '🔍 Verifica stato container...'
docker compose $COMPOSE_FILE ps

echo '🔍 Verifica health check...'
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

echo '🎉 Deploy completato con successo!'
"

# Esegui comandi SSH
log_info "Esecuzione comandi sul server..."
if ! ssh_exec "$SSH_COMMANDS"; then
    log_error "Deploy fallito sul server"
    exit 1
fi

# STEP 3: Test finale
log_info "🧪 STEP 3: Test finale"

# Test health check esterno
log_info "Test health check esterno..."
if curl -f "$URL/healthz" > /dev/null 2>&1; then
    log_success "✅ Health check esterno OK"
else
    log_warning "⚠️  Health check esterno fallito (potrebbe essere normale se il server non è accessibile dall'esterno)"
fi

log_success "🎉 Deploy completato con successo!"
log_info "🌐 Applicazione disponibile su: $URL"

echo
log_info "📋 Comandi utili per il monitoraggio:"
echo "  ssh $USER@$SERVER 'cd $APP_PATH && docker compose $COMPOSE_FILE logs -f app'"
echo "  ssh $USER@$SERVER 'cd $APP_PATH && docker compose $COMPOSE_FILE ps'"
echo "  curl $URL/healthz"
