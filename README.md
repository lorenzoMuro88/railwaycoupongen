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

**Autenticazione:**
- `POST /api/login` – login (admin/store), redirect tenant
- `POST /api/logout` – logout
- `POST /api/signup` – crea tenant + primo admin

**Admin API** (supportano sia `/api/admin/*` legacy che `/t/:tenantSlug/api/admin/*` tenant-scoped):
- `GET /api/admin/campaigns` – elenco campagne
- `POST /api/admin/campaigns` – crea campagna
- `PUT /api/admin/campaigns/:id` – aggiorna campagna
- `DELETE /api/admin/campaigns/:id` – elimina campagna
- `PUT /api/admin/campaigns/:id/activate` – attiva campagna
- `PUT /api/admin/campaigns/:id/deactivate` – disattiva campagna
- `GET /api/admin/users` – elenco utenti con filtri
- `GET /api/admin/users/export.csv` – export utenti CSV
- `GET /api/admin/users/:id` – dettaglio utente
- `PUT /api/admin/users/:id` – aggiorna utente
- `DELETE /api/admin/users/:id` – elimina utente
- `GET /api/admin/coupons/search` – ricerca coupon
- `GET /api/admin/coupons` – elenco coupon con filtri
- `DELETE /api/admin/coupons/:id` – elimina coupon
- `GET /api/admin/analytics/summary` – statistiche generali
- `GET /api/admin/analytics/campaigns` – statistiche per campagna
- `GET /api/admin/analytics/temporal` – statistiche temporali
- `GET /api/admin/analytics/export` – export analytics CSV/JSON
- `GET /api/admin/products` – elenco prodotti
- `POST /api/admin/products` – crea prodotto
- `PUT /api/admin/products/:id` – aggiorna prodotto
- `DELETE /api/admin/products/:id` – elimina prodotto
- `GET /api/admin/settings/test-email` – test invio email
- `GET /api/admin/settings/email-from-name` – get nome mittente
- `PUT /api/admin/settings/email-from-name` – aggiorna nome mittente
- `GET /api/admin/settings/email-template` – get template email
- `POST /api/admin/settings/email-template` – aggiorna template email
- `POST /api/admin/settings/upload-image` – upload immagine
- `GET /api/admin/auth-users` – elenco auth-users
- `POST /api/admin/auth-users` – crea auth-user
- `PUT /api/admin/auth-users/:id` – aggiorna auth-user
- `DELETE /api/admin/auth-users/:id` – elimina auth-user

**Store API:**
- `GET /t/:tenantSlug/api/store/coupons/*` – liste/ricerche store
- `POST /t/:tenantSlug/api/coupons/:code/redeem` – riscatto coupon

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
- **CSRF Protection** per route mutanti autenticate
- **Uploads** con whitelist MIME, size limit, sanitizzazione filename
- **Tenant Isolation** garantita a livello middleware e database
- **/healthz** con check DB; log strutturati con `requestId` e `tenant`
- **Logger strutturato** con pino per tracciabilità completa

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
├── server.js            # Server principale (setup Express e routing)
├── package.json         # Dipendenze
├── env.example          # Template configurazione
├── nixpacks.toml        # Configurazione build Railway
├── railway.json         # Configurazione deploy Railway
│
├── routes/              # Route handlers modulari
│   ├── auth.js          # Autenticazione (login, logout, signup)
│   └── admin/           # Route admin modulari
│       ├── index.js     # Entry point route admin
│       ├── campaigns.js # Gestione campagne (12 endpoint)
│       ├── users.js     # Gestione utenti (6 endpoint)
│       ├── coupons.js   # Gestione coupon (3 endpoint)
│       ├── analytics.js # Analytics e report (4 endpoint)
│       ├── settings.js  # Impostazioni (13 endpoint)
│       ├── products.js  # Gestione prodotti (4 endpoint)
│       └── auth-users.js # Gestione auth-users (4 endpoint)
│
├── middleware/          # Middleware Express
│   ├── auth.js          # Autenticazione e autorizzazione
│   ├── tenant.js        # Tenant loading e validazione
│   ├── rateLimit.js     # Rate limiting
│   └── csrf.js          # CSRF protection
│
└── utils/               # Utility functions
    ├── db.js            # Database connection e migrations
    ├── email.js         # Email transport e configurazione
    ├── qrcode.js        # Generazione QR code
    ├── logger.js        # Logger strutturato (pino)
    └── routeHelper.js   # Helper per unificare endpoint duplicati
```

### Architettura Modulare

Il progetto è stato refactorizzato in moduli organizzati per migliorare manutenibilità e testabilità:

- **Routes**: Endpoint organizzati per funzionalità (auth, admin/*)
- **Middleware**: Logica riutilizzabile per autenticazione, tenant isolation, rate limiting
- **Utils**: Funzioni helper per database, email, QR code, logging
- **Server.js**: Ridotto del 50% (da ~7000 a ~3500 righe), contiene solo setup e configurazione

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

## 🧪 Testing

Il progetto include una suite di test completa:

```bash
# Test CSRF protection
npm run test:csrf

# Test tenant isolation
npm run test:tenant-isolation

# Test autorizzazione
npm run test:authorization

# Test store functionality
npm run test:store

# Test superadmin
npm run test:superadmin

# Test admin estesi
npm run test:admin-extended

# Tutti i test
npm run test:all

# Test con coverage
npm run test:coverage
```

**Coverage attuale**: ~100% (157/157 endpoint coperti) ✅

**Test suite disponibili**:
- `npm run test:csrf` - Test CSRF protection
- `npm run test:tenant-isolation` - Test tenant isolation
- `npm run test:authorization` - Test autorizzazione
- `npm run test:store` - Test store functionality
- `npm run test:superadmin` - Test superadmin operations
- `npm run test:admin-extended` - Test admin endpoints estesi
- `npm run test:products` - Test suite completa per endpoint products (12+ test cases)
- `npm run test:settings` - Test suite per endpoint settings (8+ test cases)
- `npm run test:public` - Test suite per endpoint pubblici (12+ test cases)
- `npm run test:store-complete` - Test suite completa per endpoint store (8+ test cases)
- `npm run test:signup-auth` - Test suite per signup e auth pages (6+ test cases)
- `npm run test:misc` - Test suite per endpoint vari (7+ test cases)
- `npm run test:remaining` - Test suite per endpoint rimanenti (12+ test cases)
- `npm run test:form-links` - Test suite per form links parametrici
- `test-analytics.js` aggiornato con test per endpoint legacy export

## 📚 Documentazione Moduli

Vedi `docs/ARCHITECTURE.md` per documentazione dettagliata dell'architettura modulare.

### Moduli Principali

- **`routes/auth.js`**: Gestione autenticazione (login, logout, signup, password utilities)
- **`routes/admin/*`**: Route admin modulari per campagne, utenti, coupon, analytics, settings, prodotti, auth-users
- **`middleware/auth.js`**: Middleware per autenticazione e autorizzazione (requireAuth, requireAdmin, requireRole)
- **`middleware/tenant.js`**: Middleware per tenant loading e validazione (tenantLoader, requireSameTenantAsSession)
- **`utils/db.js`**: Database connection, migrations, e utility database
- **`utils/email.js`**: Email transport e configurazione tenant-specific
- **`utils/logger.js`**: Logger strutturato con pino e contesto request
- **`utils/routeHelper.js`**: Helper per unificare endpoint legacy e tenant-scoped

## 🔄 Changelog

### v2.0.0 (Refactoring & Ottimizzazioni)
- ✅ Refactoring modulare: server.js ridotto del 50% (da ~7000 a ~3500 righe)
- ✅ Eliminati 35 endpoint duplicati con `registerAdminRoute()`
- ✅ Migrazione completa a logger strutturato (0 console.log rimanenti)
- ✅ Ottimizzazioni performance: risolto N+1 query, eliminate correlated subqueries
- ✅ Aggiunti indici database compositi per query frequenti
- ✅ Codice organizzato in 15+ moduli ben definiti

### v1.0.0
- Rilascio iniziale
- Sistema completo gestione coupon
- Interfaccia admin e cassa
- Analytics e reporting
- Supporto email con QR code



