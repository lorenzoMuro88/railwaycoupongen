#!/usr/bin/env bash
set -euo pipefail

# CouponGen Auto Deploy Script - Windows Compatible
# Versione ottimizzata per Windows con gestione password SSH

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
    local server="${2:-$SERVER}"
    local user="${3:-$USER}"
    local password="${4:-$PASSWORD}"
    
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

# Funzione per mostrare l'help
show_help() {
    cat << EOF
CouponGen Auto Deploy Script - Windows Compatible

USAGE:
    ./deploy/auto-deploy-windows.sh [OPTIONS]

OPTIONS:
    -h, --help              Mostra questo help
    -m, --message MESSAGE   Messaggio di commit personalizzato
    -s, --server SERVER     IP o hostname del server
    -u, --user USER         Utente SSH (default: root)
    -e, --env ENV           Ambiente: production o staging (default: production)
    -b, --branch BRANCH     Branch da deployare
    --no-commit             Salta commit e push (solo deploy)
    --no-restart            Salta riavvio applicazione
    --dry-run               Mostra cosa farebbe senza eseguire

ESEMPI:
    ./deploy/auto-deploy-windows.sh
    ./deploy/auto-deploy-windows.sh -m "Fix login error"
    ./deploy/auto-deploy-windows.sh --no-commit
    ./deploy/auto-deploy-windows.sh --dry-run

EOF
}

# Variabili di default (usano configurazione se disponibile)
COMMIT_MESSAGE=""
SERVER="${DEPLOY_SERVER:-167.172.42.248}"
USER="${DEPLOY_USER:-root}"
PASSWORD="${DEPLOY_PASSWORD:-hPmCLn7dk6YfjXV}"
ENVIRONMENT="production"
BRANCH="${DEPLOY_BRANCH:-feature/migration-cloud-multitenant-prerelease}"
NO_COMMIT=false
NO_RESTART=false
DRY_RUN=false

# Parsing degli argomenti
while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_help
            exit 0
            ;;
        -m|--message)
            COMMIT_MESSAGE="$2"
            shift 2
            ;;
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
        -b|--branch)
            BRANCH="$2"
            shift 2
            ;;
        --no-commit)
            NO_COMMIT=true
            shift
            ;;
        --no-restart)
            NO_RESTART=true
            shift
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        *)
            log_error "Opzione sconosciuta: $1"
            show_help
            exit 1
            ;;
    esac
done

# Funzione per eseguire comandi (con supporto dry-run)
run_cmd() {
    local cmd="$1"
    local description="$2"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "[DRY-RUN] $description"
        log_info "[DRY-RUN] Comando: $cmd"
        return 0
    fi
    
    log_info "$description"
    if ! eval "$cmd"; then
        log_error "Comando fallito: $cmd"
        exit 1
    fi
}

# Determina il path dell'applicazione sul server
if [[ "$ENVIRONMENT" == "staging" ]]; then
    APP_PATH="/opt/coupongen"
    COMPOSE_FILE="-f docker-compose.staging.yml"
    PORT="3001"
else
    APP_PATH="/opt/coupongen"
    COMPOSE_FILE=""
    PORT="3000"
fi

log_info "🚀 Avvio deploy CouponGen (Windows Compatible)"
log_info "Ambiente: $ENVIRONMENT"
log_info "Branch: $BRANCH"
log_info "Server: $SERVER"
log_info "User: $USER"

# Chiedi messaggio di commit se non fornito e non è no-commit
if [[ "$NO_COMMIT" == "false" && -z "$COMMIT_MESSAGE" ]]; then
    read -p "Messaggio di commit: " COMMIT_MESSAGE
    if [[ -z "$COMMIT_MESSAGE" ]]; then
        COMMIT_MESSAGE="Deploy automatico - $(date '+%Y-%m-%d %H:%M:%S')"
    fi
fi

echo
log_info "📋 Riepilogo operazioni:"
echo "  1. Commit e push modifiche locali"
echo "  2. Connessione al server $USER@$SERVER"
echo "  3. Aggiornamento codice da branch $BRANCH"
echo "  4. Riavvio applicazione $ENVIRONMENT"
echo

if [[ "$DRY_RUN" == "false" ]]; then
    read -p "Procedere? (y/N): " confirm
    if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
        log_info "Deploy annullato"
        exit 0
    fi
fi

# STEP 1: Commit e push modifiche locali
if [[ "$NO_COMMIT" == "false" ]]; then
    log_info "📝 STEP 1: Commit e push modifiche locali"
    
    # Controlla se ci sono modifiche
    if ! git diff --quiet || ! git diff --cached --quiet; then
        run_cmd "git add ." "Aggiunta file modificati"
        run_cmd "git commit -m \"$COMMIT_MESSAGE\"" "Commit modifiche"
    else
        log_warning "Nessuna modifica da committare"
    fi
    
    run_cmd "git push origin $BRANCH" "Push al repository remoto"
    log_success "✅ Modifiche caricate su GitHub"
else
    log_info "⏭️  STEP 1: Salto commit e push (--no-commit)"
fi

# STEP 2: Connessione server e aggiornamento
log_info "🔗 STEP 2: Connessione server e aggiornamento codice"

# Comando SSH per aggiornare e riavviare
SSH_COMMANDS="
set -e
cd $APP_PATH
echo '📥 Aggiornamento codice da branch $BRANCH...'
git fetch origin
git reset --hard origin/$BRANCH
echo '✅ Codice aggiornato'

if [[ '$NO_RESTART' == 'false' ]]; then
    echo '🔄 Riavvio applicazione $ENVIRONMENT...'
    echo '  - Arresto container esistenti...'
    docker compose $COMPOSE_FILE down
    
    echo '  - Rimozione immagini non utilizzate...'
    docker system prune -f
    
    echo '  - Ricostruzione e avvio container...'
    docker compose $COMPOSE_FILE up -d --build
    echo '✅ Applicazione riavviata'
    
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
else
    echo '⏭️  Salto riavvio applicazione (--no-restart)'
fi

echo '📊 Stato finale container:'
docker compose $COMPOSE_FILE ps

echo '🎉 Deploy e riavvio completati con successo!'
"

# Esegui comandi SSH
if [[ "$DRY_RUN" == "true" ]]; then
    log_info "[DRY-RUN] Comandi SSH da eseguire:"
    echo "$SSH_COMMANDS"
else
    log_info "Esecuzione comandi sul server..."
    if ! ssh_with_password "$SSH_COMMANDS" "$SERVER" "$USER" "$PASSWORD"; then
        log_error "Deploy fallito sul server"
        exit 1
    fi
fi

# STEP 3: Test finale
if [[ "$NO_RESTART" == "false" && "$DRY_RUN" == "false" ]]; then
    log_info "🧪 STEP 3: Test finale"
    
    # Test health check
    log_info "Test health check..."
    if curl -f "http://$SERVER:$PORT/healthz" > /dev/null 2>&1; then
        log_success "✅ Health check OK"
    else
        log_warning "⚠️  Health check fallito (potrebbe essere normale se il server non è accessibile dall'esterno)"
    fi
    
    # Test login endpoint (se possibile)
    log_info "Test login endpoint..."
    if curl -f -X POST "http://$SERVER:$PORT/api/login" \
        -H "Content-Type: application/json" \
        -d '{"username":"admin","password":"admin123","userType":"superadmin"}' \
        > /dev/null 2>&1; then
        log_success "✅ Login endpoint risponde correttamente"
    else
        log_warning "⚠️  Login endpoint test fallito (controlla i log)"
    fi
fi

log_success "🎉 Deploy completato con successo!"
log_info "🌐 Applicazione disponibile su: https://platform.coupongen.it"
if [[ "$ENVIRONMENT" == "staging" ]]; then
    log_info "🧪 Staging disponibile su: https://staging.coupongen.it"
fi

echo
log_info "📋 Comandi utili per il monitoraggio:"
echo "  ssh $USER@$SERVER 'cd $APP_PATH && docker compose $COMPOSE_FILE logs -f app'"
echo "  ssh $USER@$SERVER 'cd $APP_PATH && docker compose $COMPOSE_FILE ps'"
echo "  curl https://platform.coupongen.it/healthz"
