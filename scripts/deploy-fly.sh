#!/usr/bin/env bash
set -euo pipefail

# FLYCouponGen Deploy Script for Fly.io
# Unified deployment script for production and staging environments

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

# Configurazione
ENVIRONMENT="${1:-production}"
BRANCH="${2:-main}"

# Validazione ambiente
if [[ "$ENVIRONMENT" != "production" && "$ENVIRONMENT" != "staging" ]]; then
    log_error "Ambiente deve essere 'production' o 'staging'"
    echo "Uso: $0 [production|staging] [branch]"
    exit 1
fi

# Configurazione ambiente
if [[ "$ENVIRONMENT" == "staging" ]]; then
    FLY_CONFIG="fly.staging.toml"
    APP_NAME="flycoupongen-staging"
    URL="https://flycoupongen-staging.fly.dev"
else
    FLY_CONFIG="fly.toml"
    APP_NAME="flycoupongen"
    URL="https://flycoupongen.fly.dev"
fi

# Verifica prerequisiti
check_prerequisites() {
    log_info "🔍 Verifica prerequisiti..."
    
    if ! command -v fly &> /dev/null; then
        log_error "Fly CLI non installato. Installa da: https://fly.io/docs/hands-on/install-flyctl/"
        exit 1
    fi
    
    if ! fly auth whoami &> /dev/null; then
        log_error "Non autenticato con Fly.io. Esegui: fly auth login"
        exit 1
    fi
    
    if [[ ! -f "$FLY_CONFIG" ]]; then
        log_error "File di configurazione $FLY_CONFIG non trovato"
        exit 1
    fi
    
    log_success "✅ Prerequisiti verificati"
}

# Commit e push su GitHub
git_operations() {
    log_info "📝 STEP 1: Commit e push su GitHub"
    
    # Controlla se ci sono modifiche
    if ! git diff --quiet || ! git diff --cached --quiet; then
        # Chiedi messaggio di commit
        read -p "Messaggio di commit: " COMMIT_MESSAGE
        if [[ -z "$COMMIT_MESSAGE" ]]; then
            COMMIT_MESSAGE="Deploy $ENVIRONMENT to Fly.io - $(date '+%Y-%m-%d %H:%M:%S')"
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
}

# Deploy su Fly.io
deploy_to_fly() {
    log_info "🚀 STEP 2: Deploy su Fly.io"
    log_info "App: $APP_NAME"
    log_info "Config: $FLY_CONFIG"
    log_info "URL: $URL"
    
    # Verifica se l'app esiste
    if ! fly apps list | grep -q "$APP_NAME"; then
        log_info "📱 Creazione app $APP_NAME..."
        fly apps create "$APP_NAME" --generate-name=false
    fi
    
    # Crea volume se non esiste
    VOLUME_NAME="${APP_NAME}_data"
    if ! fly volumes list -a "$APP_NAME" | grep -q "$VOLUME_NAME"; then
        log_info "💾 Creazione volume $VOLUME_NAME..."
        fly volumes create "$VOLUME_NAME" -a "$APP_NAME" --region fra --size 1
    fi
    
    # Deploy
    log_info "🔄 Deploy in corso..."
    fly deploy -c "$FLY_CONFIG" -a "$APP_NAME"
    
    log_success "✅ Deploy completato"
}

# Verifica deploy
verify_deployment() {
    log_info "🧪 STEP 3: Verifica deployment"
    
    # Attendi che l'app sia pronta
    log_info "⏳ Attesa avvio applicazione..."
    sleep 10
    
    # Test health check
    log_info "🔍 Test health check..."
    for i in {1..5}; do
        if curl -f "$URL/healthz" > /dev/null 2>&1; then
            log_success "✅ Health check OK (tentativo $i)"
            break
        else
            log_warning "⏳ Health check fallito (tentativo $i), attesa 10 secondi..."
            if [ $i -lt 5 ]; then
                sleep 10
            else
                log_error "❌ Health check fallito dopo 5 tentativi"
                log_info "📋 Log applicazione:"
                fly logs -a "$APP_NAME" --tail=20
                exit 1
            fi
        fi
    done
    
    # Test endpoint login
    log_info "🧪 Test endpoint login..."
    if curl -f -X POST "$URL/api/login" \
        -H 'Content-Type: application/json' \
        -d '{"username":"admin","password":"admin123","userType":"superadmin"}' \
        > /dev/null 2>&1; then
        log_success "✅ Login endpoint funzionante"
    else
        log_warning "⚠️  Login endpoint test fallito (controlla i log)"
    fi
    
    # Mostra stato
    log_info "📊 Stato app:"
    fly status -a "$APP_NAME"
}

# Main execution
main() {
    log_info "🚀 Deploy FLYCouponGen su Fly.io - Ambiente: $ENVIRONMENT"
    log_info "Branch: $BRANCH"
    log_info "URL finale: $URL"
    
    check_prerequisites
    git_operations
    deploy_to_fly
    verify_deployment
    
    log_success "🎉 Deploy completato con successo!"
    log_info "🌐 Applicazione disponibile su: $URL"
    
    echo
    log_info "📋 Comandi utili per il monitoraggio:"
    echo "  fly logs -a $APP_NAME -f"
    echo "  fly status -a $APP_NAME"
    echo "  fly ssh console -a $APP_NAME"
    echo "  curl $URL/healthz"
}

# Esegui main
main "$@"
