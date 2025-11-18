# Script Deploy Railway - CouponGen
# Esegui questo script DOPO aver fatto: railway login

Write-Host "=== Deploy CouponGen su Railway ===" -ForegroundColor Cyan
Write-Host ""

# Verifica login
Write-Host "Verificando autenticazione..." -ForegroundColor Yellow
$whoami = railway whoami 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERRORE: Non sei autenticato. Esegui prima: railway login" -ForegroundColor Red
    exit 1
}
Write-Host "Autenticato come: $whoami" -ForegroundColor Green
Write-Host ""

# Verifica se progetto già collegato
Write-Host "Verificando progetto Railway..." -ForegroundColor Yellow
$status = railway status 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "Nessun progetto collegato. Creazione/collegamento progetto..." -ForegroundColor Yellow
    Write-Host "Seleziona un'opzione:" -ForegroundColor Yellow
    Write-Host "1. Creare nuovo progetto" -ForegroundColor Cyan
    Write-Host "2. Collegare progetto esistente" -ForegroundColor Cyan
    $choice = Read-Host "Scelta (1 o 2)"
    
    if ($choice -eq "1") {
        railway init
    } else {
        railway link
    }
} else {
    Write-Host "Progetto già collegato" -ForegroundColor Green
}
Write-Host ""

# Genera SESSION_SECRET se non esiste
Write-Host "Configurando variabili d'ambiente..." -ForegroundColor Yellow

# Genera SESSION_SECRET sicuro
$sessionSecret = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 64 | ForEach-Object {[char]$_})
Write-Host "SESSION_SECRET generato" -ForegroundColor Green

# Configura variabili OBBLIGATORIE
Write-Host "Impostando variabili obbligatorie..." -ForegroundColor Yellow

railway variables set NODE_ENV=production
railway variables set PORT=3000
railway variables set DATA_DIR=/app/data
railway variables set UPLOADS_DIR=/app/data/uploads
railway variables set DEFAULT_TENANT_SLUG=default
railway variables set DEFAULT_TENANT_NAME="Default Tenant"
railway variables set ENFORCE_TENANT_PREFIX=false
railway variables set FORCE_HTTPS=true

Write-Host "IMPORTANTE: Configura manualmente queste variabili:" -ForegroundColor Red
Write-Host "  railway variables set SESSION_SECRET=<genera_con_openssl_rand_base64_48>" -ForegroundColor Yellow
Write-Host "  railway variables set SUPERADMIN_PASSWORD=<password_sicura>" -ForegroundColor Yellow
Write-Host "  railway variables set STORE_PASSWORD=<password_sicura>" -ForegroundColor Yellow
Write-Host ""
Write-Host "Per generare SESSION_SECRET:" -ForegroundColor Cyan
Write-Host "  openssl rand -base64 48" -ForegroundColor White
Write-Host ""

# Chiedi se configurare email
$configureEmail = Read-Host "Vuoi configurare Mailgun ora? (s/n)"
if ($configureEmail -eq "s" -or $configureEmail -eq "S") {
    $mailgunKey = Read-Host "MAILGUN_API_KEY"
    $mailgunDomain = Read-Host "MAILGUN_DOMAIN"
    $mailgunFrom = Read-Host "MAILGUN_FROM (es: CouponGen <no-reply@send.coupongen.it>)"
    
    railway variables set MAIL_PROVIDER=mailgun
    railway variables set MAILGUN_API_KEY=$mailgunKey
    railway variables set MAILGUN_DOMAIN=$mailgunDomain
    railway variables set MAILGUN_FROM=$mailgunFrom
    railway variables set MAILGUN_REGION=eu
    
    Write-Host "Email configurata" -ForegroundColor Green
}

Write-Host ""
Write-Host "=== IMPORTANTE: Aggiungi Volume Persistente ===" -ForegroundColor Yellow
Write-Host "1. Vai su railway.app → Il tuo progetto → Settings → Volumes" -ForegroundColor Cyan
Write-Host "2. Clicca 'Add Volume'" -ForegroundColor Cyan
Write-Host "3. Monta su: /app/data" -ForegroundColor Cyan
Write-Host ""

# Deploy
Write-Host "Avviando deploy..." -ForegroundColor Yellow
railway up

Write-Host ""
Write-Host "=== Deploy Completato ===" -ForegroundColor Green
Write-Host ""
Write-Host "Per vedere i log:" -ForegroundColor Cyan
Write-Host "  railway logs" -ForegroundColor White
Write-Host ""
Write-Host "Per ottenere l'URL:" -ForegroundColor Cyan
Write-Host "  railway domain" -ForegroundColor White
Write-Host ""

