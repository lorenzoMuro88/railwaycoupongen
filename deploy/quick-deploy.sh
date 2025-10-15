#!/usr/bin/env bash
set -euo pipefail

# CouponGen Quick Deploy Script
# Script semplificato per deploy rapido in produzione

# Configurazione
SERVER="167.172.42.248"
USER="root"
BRANCH="feature/migration-cloud-multitenant-prerelease"
APP_PATH="/opt/coupongen"

# Colori
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Chiedi messaggio di commit
read -p "Messaggio di commit: " COMMIT_MESSAGE
if [[ -z "$COMMIT_MESSAGE" ]]; then
    COMMIT_MESSAGE="Quick deploy - $(date '+%Y-%m-%d %H:%M:%S')"
fi

log_info "🚀 Quick Deploy CouponGen"
log_info "Server: $SERVER"
log_info "Branch: $BRANCH"
log_info "Commit: $COMMIT_MESSAGE"

# STEP 1: Commit e push
log_info "📝 Commit e push modifiche..."
git add .
git commit -m "$COMMIT_MESSAGE" || log_info "Nessuna modifica da committare"
git push origin $BRANCH

# STEP 2: Deploy sul server
log_info "🔗 Deploy sul server..."

ssh -o StrictHostKeyChecking=no $USER@$SERVER << EOF
set -e
cd $APP_PATH
echo "📥 Aggiornamento codice..."
git fetch origin
git reset --hard origin/$BRANCH

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
EOF

log_success "✅ Deploy completato con successo!"
log_info "🌐 Applicazione: https://platform.coupongen.it"
