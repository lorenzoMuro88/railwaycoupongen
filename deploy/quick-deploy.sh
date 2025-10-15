#!/usr/bin/env bash
set -euo pipefail

# CouponGen Quick Deploy Script
# Script semplificato per deploy rapido in produzione

# Configurazione
SERVER="167.172.42.248"
USER="root"
PASSWORD="hPmCLn7dk6YfjXV"
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

# Funzione per eseguire comandi SSH con password automatica
ssh_with_password() {
    local commands="$1"
    
    # Prova prima con sshpass se disponibile
    if command -v sshpass >/dev/null 2>&1; then
        echo "$PASSWORD" | sshpass -p "$PASSWORD" ssh -o StrictHostKeyChecking=no "$USER@$SERVER" "$commands"
    else
        # Fallback: usa expect se disponibile
        if command -v expect >/dev/null 2>&1; then
            expect -c "
                spawn ssh -o StrictHostKeyChecking=no $USER@$SERVER \"$commands\"
                expect \"password:\"
                send \"$PASSWORD\r\"
                expect eof
            "
        else
            # Ultimo fallback: chiedi all'utente di inserire la password
            log_warning "sshpass e expect non disponibili. Inserisci la password quando richiesto:"
            ssh -o StrictHostKeyChecking=no "$USER@$SERVER" "$commands"
        fi
    fi
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

ssh_with_password "
set -e
cd $APP_PATH
echo '📥 Aggiornamento codice...'
git fetch origin
git reset --hard origin/$BRANCH

echo '🔄 Riavvio applicazione...'
echo '  - Arresto container esistenti...'
docker compose down

echo '  - Rimozione immagini non utilizzate...'
docker system prune -f

echo '  - Ricostruzione e avvio container...'
docker compose up -d --build

echo '⏳ Attesa avvio applicazione...'
sleep 15

echo '🔍 Verifica stato container...'
docker compose ps

echo '🔍 Verifica health check (tentativo 1/3)...'
for i in {1..3}; do
    if curl -f http://localhost:3000/healthz > /dev/null 2>&1; then
        echo \"✅ Health check OK (tentativo \$i)\"
        break
    else
        echo \"⏳ Health check fallito (tentativo \$i), attesa 5 secondi...\"
        if [ \$i -lt 3 ]; then
            sleep 5
        else
            echo \"❌ Health check fallito dopo 3 tentativi\"
            echo \"📋 Log applicazione:\"
            docker compose logs --tail=30 app
            exit 1
        fi
    fi
done

echo '🧪 Test endpoint login...'
if curl -f -X POST http://localhost:3000/api/login \\
    -H 'Content-Type: application/json' \\
    -d '{\"username\":\"admin\",\"password\":\"admin123\",\"userType\":\"superadmin\"}' \\
    > /dev/null 2>&1; then
    echo '✅ Login endpoint funzionante'
else
    echo '⚠️  Login endpoint test fallito (controlla i log)'
fi

echo '📊 Stato finale container:'
docker compose ps

echo '🎉 Deploy e riavvio completati con successo!'
"

log_success "✅ Deploy completato con successo!"
log_info "🌐 Applicazione: https://platform.coupongen.it"
