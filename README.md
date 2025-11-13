# CouponGen

![Node.js](https://img.shields.io/badge/node.js-18+-green.svg)
![License](https://img.shields.io/badge/license-MIT-blue.svg)

**CouponGen** è un'applicazione Node.js multi-tenant per generare coupon via form web, inviare email con QR code e permettere il riscatto in negozio tramite interfaccia protetta. Ogni tenant ha area admin, store e configurazioni separate.

## 🚀 Caratteristiche

- **Generazione Coupon**: Form web personalizzabile per la raccolta dati utenti
- **Email Automatiche**: Invio automatico di email con QR code allegato
- **Gestione Campagne**: Sistema completo per gestire campagne promozionali
- **Interfaccia Cassa**: Sistema protetto per il riscatto coupon in negozio
- **Analytics**: Dashboard completa con statistiche e report
- **Multi-tenant (A+A)**: singolo DB con `tenant_id`, routing path-based `/t/{tenant}`
- **Database SQLite**: Nessun database esterno richiesto (migrazione a Postgres opzionale)
- **API REST**: API complete per integrazione con sistemi esterni

## 📋 Requisiti

- Node.js 18 o superiore
- Nessun database esterno (usa SQLite locale)

## ⚡ Installazione Rapida

1. **Clona il repository**
```bash
git clone https://github.com/lorenzoMuro88/CouponGenCloud.git
cd CouponGenCloud
```

2. **Installa le dipendenze**
```bash
npm install
```

3. **Configura l'ambiente**
```bash
cp env.example .env
# Modifica il file .env con le tue configurazioni
```

4. **Avvia l'applicazione**
```bash
# Sviluppo
npm run dev

# Produzione
npm start
```

## 🔧 Configurazione

### Variabili d'Ambiente (principali)

Copia `env.example` in `.env` e configura (su Railway puoi impostarle dal dashboard):

```env
# Server
PORT=3000
DATA_DIR=/app/data
UPLOADS_DIR=/app/data/uploads
SESSION_SECRET=change-me
DEFAULT_TENANT_SLUG=default
ENFORCE_TENANT_PREFIX=false
UPLOAD_MAX_BYTES=2097152

# Email (scegli un provider)
MAIL_PROVIDER=mailgun
MAILGUN_API_KEY=your_key
MAILGUN_DOMAIN=your_domain.mailgun.org
MAILGUN_FROM=CouponGen <no-reply@send.coupongen.it>

# Sessions
# Usa lo store in-memory (predefinito). Redis non è più necessario.
```

### Provider Email Supportati

1. **Mailgun** (Raccomandato)
2. **SMTP** (Gmail, Outlook, etc.)
3. **Modalità Sviluppo** (log in console)

## 🌐 Utilizzo

### Interfacce Principali (multi-tenant)

- **Form Pubblico**: `http://localhost:3000/t/{tenant}`
- **Interfaccia Cassa**: `http://localhost:3000/t/{tenant}/store` (protetta)
- **Pannello Admin**: `http://localhost:3000/t/{tenant}/admin` (protetto)
- **Analytics**: `http://localhost:3000/t/{tenant}/analytics` (protetto)
- Legacy senza prefisso reindirizzati se `ENFORCE_TENANT_PREFIX=true`

### API Endpoints

#### Pubblici
- `GET /t/:tenantSlug/api/campaigns/:code` - Dettagli campagna
- `POST /t/:tenantSlug/submit` - Invio form coupon

### Sicurezza Moduli Pubblici

- reCAPTCHA invisibile lato client e verifica lato server (abilitabile via env)
- Limite invii per IP in finestra (default 20/10min) con lock temporaneo
- Limite giornaliero per email (default 3/24h) per mitigare abusi

Variabili d'ambiente rilevanti:

```
RECAPTCHA_ENABLED=true
RECAPTCHA_SITE_KEY=la_tua_site_key
RECAPTCHA_SECRET=la_tua_secret_key

SUBMIT_WINDOW_MS=600000
SUBMIT_MAX_PER_IP=20
SUBMIT_LOCK_MS=1800000

EMAIL_DAILY_WINDOW_MS=86400000
EMAIL_MAX_PER_DAY=3
EMAIL_LOCK_MS=86400000
```

Se `RECAPTCHA_ENABLED=true`, inserisci il tag script con la `RECAPTCHA_SITE_KEY` nella pagina del form. Il backend accetta il token in `recaptchaToken` o `g-recaptcha-response`.

#### Protetti (sessione + ruoli per-tenant)
- `POST /api/login` – login (admin/store), redirect tenant
- `POST /api/logout` – logout
- `POST /api/signup` – crea tenant + primo admin
- `GET /t/:tenantSlug/api/admin/campaigns` – elenco campagne
- `POST /t/:tenantSlug/api/admin/campaigns` – crea campagna
- `PUT /t/:tenantSlug/api/admin/campaigns/:id/(activate|deactivate)` – stato campagna
- `GET /t/:tenantSlug/api/store/coupons/*` – liste/ricerche store
- `POST /t/:tenantSlug/api/coupons/:code/redeem` – riscatto

## 📊 Funzionalità

### Gestione Campagne
- Creazione e configurazione campagne promozionali
- Campi personalizzati per il form
- Configurazione sconti (percentuale o fisso)
- Associazione prodotti

### Sistema Coupon
- Generazione automatica codici unici
- QR code per riscatto rapido
- Tracking stato (attivo, riscattato, scaduto)
- Email automatiche con template personalizzabili

### Interfaccia Cassa
- Ricerca coupon per codice o cognome
- Riscatto immediato
- Lista coupon attivi e riscattati
- Interfaccia ottimizzata per tablet

### Analytics
- Dashboard con statistiche complete
- Report per campagna
- Export dati in CSV
- Grafici temporali

## 🔒 Sicurezza

- **Sessione per-tenant** con rigenerazione al login; ruoli `admin` e `store`
- **Validazione input** su endpoint critici
- **Prepared statements** per query SQLite
- **Rate limit login** con lockout progressivo
- **Uploads** con whitelist MIME, size limit, sanitizzazione filename
- **/healthz** con check DB; log strutturati con `requestId` e `tenant`

## 🚀 Deploy in Produzione

### Railway (Raccomandato)

Il progetto è configurato per il deploy su Railway con Nixpacks. Vedi `docs/DEPLOY_RAILWAY.md` per istruzioni dettagliate.

**Vantaggi:**
- ✅ Deploy automatico da GitHub
- ✅ SSL automatico
- ✅ Volume persistente per database e uploads
- ✅ Zero configurazione

**Deploy rapido:**
1. Collega il repository a Railway
2. Configura le variabili d'ambiente dal dashboard
3. Il deploy parte automaticamente

### Deploy Locale con PM2

```bash
npm install -g pm2
pm2 start server.js --name "couongen"
pm2 startup
pm2 save
```

### Checklist Produzione

1. **Configura HTTPS** (automatico su Railway)
2. **Imposta credenziali sicure** in `.env`
3. **Configura provider email reale**
4. **Considera backup automatici** del database SQLite
5. **Usa un process manager** come PM2 (per deploy locale)

## 📁 Struttura Progetto

```
CouponGenCloud/
├── data/                 # Database SQLite
├── static/              # File CSS/JS statici (+ uploads per-tenant)
├── views/               # Template HTML
├── server.js            # Server principale
├── package.json         # Dipendenze
├── env.example          # Template configurazione
├── nixpacks.toml        # Configurazione build Railway
├── railway.json         # Configurazione deploy Railway
└── README.md           # Documentazione
```

## 🤝 Contribuire

1. Fork del progetto
2. Crea un branch per la tua feature (`git checkout -b feature/AmazingFeature`)
3. Commit delle modifiche (`git commit -m 'Add some AmazingFeature'`)
4. Push al branch (`git push origin feature/AmazingFeature`)
5. Apri una Pull Request

## 📝 Licenza

Distribuito sotto licenza MIT. Vedi `LICENSE` per maggiori informazioni.

## 🆘 Supporto

Per supporto e domande:
- Apri una [Issue](https://github.com/lorenzoMuro88/CouponGenCloud/issues)
- Controlla la [documentazione](https://github.com/lorenzoMuro88/CouponGenCloud/wiki)

## 🔄 Changelog

### v1.0.0
- Rilascio iniziale
- Sistema completo gestione coupon
- Interfaccia admin e cassa
- Analytics e reporting
- Supporto email con QR code



