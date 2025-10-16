# 🚀 Checklist Deploy Railway - FLYCouponGen

## ✅ Pre-Deploy Setup

### 1. Account e CLI Railway
- [ ] Account Railway creato su [railway.app](https://railway.app)
- [ ] Railway CLI installato: `npm install -g @railway/cli` o `brew install railway`
- [ ] Login Railway: `railway login`

### 2. Repository GitHub
- [ ] Branch `feature/railway-migration` pushato su GitHub
- [ ] Repository pubblico o privato accessibile da Railway

### 3. Variabili d'Ambiente Preparate
Prepara queste variabili per il deploy:

```bash
# Server Configuration
PORT=3000
DATA_DIR=/app/data
UPLOADS_DIR=/app/data/uploads

# Session & Security
SESSION_SECRET=your-super-secret-key-change-this
DEFAULT_TENANT_SLUG=default
DEFAULT_TENANT_NAME=Default Tenant
ENFORCE_TENANT_PREFIX=false

# Email Configuration (Mailgun)
MAIL_PROVIDER=mailgun
MAILGUN_API_KEY=your_mailgun_api_key
MAILGUN_DOMAIN=your_domain.mailgun.org
MAILGUN_FROM=CouponGen <no-reply@send.coupongen.it>
MAILGUN_REGION=eu

# Upload Limits
UPLOAD_MAX_BYTES=2097152

# Rate Limiting
LOGIN_WINDOW_MS=600000
LOGIN_MAX_ATTEMPTS=10
LOGIN_LOCK_MS=1800000
SUBMIT_WINDOW_MS=600000
SUBMIT_MAX_PER_IP=20
SUBMIT_LOCK_MS=1800000
EMAIL_DAILY_WINDOW_MS=86400000
EMAIL_MAX_PER_DAY=3
EMAIL_LOCK_MS=86400000

# Optional: reCAPTCHA
RECAPTCHA_ENABLED=false
# RECAPTCHA_SITE_KEY=your_site_key
# RECAPTCHA_SECRET=your_secret_key
```

## 🚀 Deploy Steps

### 1. Deploy Automatico (Raccomandato)
- [ ] Vai su [railway.app](https://railway.app)
- [ ] Clicca "New Project"
- [ ] Seleziona "Deploy from GitHub repo"
- [ ] Scegli il repository FLYCouponGen
- [ ] Seleziona branch `feature/railway-migration`

### 2. Deploy Manuale (Script)
```bash
# Clona e vai nel branch
git clone https://github.com/lorenzoMuro88/CouponGen.git
cd CouponGen
git checkout feature/railway-migration

# Deploy
chmod +x scripts/deploy-railway.sh
./scripts/deploy-railway.sh production
```

### 3. Configurazione Variabili d'Ambiente
- [ ] Vai su Railway Dashboard → Settings → Variables
- [ ] Aggiungi tutte le variabili dalla lista sopra
- [ ] **IMPORTANTE**: `SESSION_SECRET` deve essere unico e sicuro
- [ ] **IMPORTANTE**: Configura Mailgun per email funzionanti

### 4. Verifica Deploy
- [ ] App si avvia senza errori
- [ ] Health check: `curl https://your-app.up.railway.app/healthz`
- [ ] Login test: `curl -X POST https://your-app.up.railway.app/api/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin123","userType":"superadmin"}'`
- [ ] Interfaccia web accessibile

## 📁 Migrazione Dati

### 1. Backup Dati Locali
```bash
# Backup database SQLite
cp data/coupons.db backup-coupons-$(date +%Y%m%d).db

# Backup uploads
tar -czf uploads-backup-$(date +%Y%m%d).tar.gz static/uploads/
```

### 2. Upload su Railway
```bash
# Via Railway CLI
railway shell

# Crea directory
mkdir -p /app/data/uploads

# Upload database (se necessario)
# Usa Railway dashboard Files per uploadare coupons.db in /app/data/

# Upload files (se necessario)
# Usa Railway dashboard Files per uploadare uploads in /app/data/uploads/
```

### 3. Verifica Dati
- [ ] Database accessibile dall'app
- [ ] File uploads funzionanti
- [ ] Immagini visualizzate correttamente

## 🔧 Post-Deploy Configuration

### 1. Dominio Personalizzato (Opzionale)
- [ ] Vai su Railway Dashboard → Settings → Domains
- [ ] Aggiungi il tuo dominio (es. `platform.coupongen.it`)
- [ ] Configura DNS:
  ```
  CNAME platform.coupongen.it → your-app.up.railway.app
  ```
- [ ] SSL automatico gestito da Railway

### 2. Monitoraggio
- [ ] Railway Dashboard → Metrics per CPU/RAM
- [ ] Railway Dashboard → Logs per debug
- [ ] Imposta alerting se necessario

### 3. Backup Strategy
- [ ] Railway fa backup automatici del database PostgreSQL (se usato)
- [ ] Per SQLite: considera backup manuali periodici
- [ ] File uploads: backup manuali o script automatizzati

## 🧪 Test Completi

### 1. Test Funzionalità Base
- [ ] **Login**: SuperAdmin e Store
- [ ] **Form Pubblico**: Creazione coupon
- [ ] **Email**: Invio email con QR code
- [ ] **Upload Immagini**: Admin e tenant
- [ ] **Riscatto**: Interfaccia store
- [ ] **Analytics**: Dashboard statistiche

### 2. Test Multi-Tenant
- [ ] **Creazione Tenant**: `/api/signup`
- [ ] **Routing**: `/t/{tenant}/admin`, `/t/{tenant}/store`
- [ ] **Isolamento**: Dati separati per tenant
- [ ] **Uploads**: File separati per tenant

### 3. Test Performance
- [ ] **Health Check**: Risposta < 1 secondo
- [ ] **Upload**: File fino a 2MB
- [ ] **Concorrenza**: Multipli utenti simultanei
- [ ] **Memory**: Monitoraggio uso RAM

## 🚨 Troubleshooting

### Problemi Comuni

#### App non si avvia
```bash
# Controlla logs
railway logs

# Verifica variabili ambiente
railway variables

# Test locale
npm start
```

#### Database non accessibile
```bash
# Verifica DATA_DIR
railway shell
ls -la /app/data/

# Controlla permessi
chmod 755 /app/data
```

#### Uploads non funzionano
```bash
# Verifica UPLOADS_DIR
railway shell
ls -la /app/data/uploads/

# Controlla permessi
chmod 755 /app/data/uploads
```

#### Email non inviate
- [ ] Verifica `MAILGUN_API_KEY` e `MAILGUN_DOMAIN`
- [ ] Controlla logs per errori Mailgun
- [ ] Test con `MAIL_TEST_TO` in sviluppo

## 📊 Costi Stimati

### Piano Hobby ($5/mese)
- [ ] App Node.js: Incluso
- [ ] Database PostgreSQL: 1GB incluso
- [ ] Storage: 1GB incluso
- [ ] SSL: Incluso
- [ ] **Totale**: ~$8-9/mese

### Monitoraggio Costi
- [ ] Railway Dashboard → Billing
- [ ] Imposta limiti se necessario
- [ ] Monitora utilizzo storage

## ✅ Deploy Completato

Quando tutti i test passano:
- [ ] Merge branch `feature/railway-migration` in `main`
- [ ] Tag release: `git tag v2.0.0-railway`
- [ ] Push tag: `git push origin v2.0.0-railway`
- [ ] Aggiorna documentazione principale
- [ ] Notifica team del nuovo deploy

## 🆘 Supporto

- [Railway Docs](https://docs.railway.app/)
- [Railway Discord](https://discord.gg/railway)
- [GitHub Issues](https://github.com/lorenzoMuro88/CouponGen/issues)

---

**Note**: Questa checklist è specifica per Railway. Per altri provider (Fly.io, Render) vedi le rispettive guide.
