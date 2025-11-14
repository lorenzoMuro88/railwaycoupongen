# Configuration Reference - FLYCouponGen

Documentazione completa di tutte le variabili d'ambiente configurabili in FLYCouponGen.

## Panoramica

FLYCouponGen utilizza variabili d'ambiente per la configurazione. Copia `env.example` in `.env` e modifica i valori secondo le tue esigenze.

## Variabili d'Ambiente

### Server Configuration

#### PORT
- **Descrizione:** Porta su cui il server Express ascolta
- **Tipo:** Number
- **Default:** `3000`
- **Esempio:** `PORT=3000`
- **Quando necessaria:** Sempre (ma ha default)

#### DATA_DIR
- **Descrizione:** Directory dove viene creato il database SQLite
- **Tipo:** String (path assoluto o relativo)
- **Default:** `./data`
- **Esempio:** `DATA_DIR=/app/data` (produzione) o `DATA_DIR=./data` (sviluppo)
- **Quando necessaria:** Opzionale (ha default)

#### UPLOADS_DIR
- **Descrizione:** Directory dove vengono salvati gli upload (immagini header form)
- **Tipo:** String (path assoluto o relativo)
- **Default:** `./static/uploads`
- **Esempio:** `UPLOADS_DIR=/app/data/uploads`
- **Quando necessaria:** Opzionale (ha default)

---

### Authentication & Security

#### SESSION_SECRET
- **Descrizione:** Secret key per firmare le sessioni Express
- **Tipo:** String (almeno 64 caratteri raccomandati)
- **Default:** Nessuno (REQUIRED)
- **Esempio:** `SESSION_SECRET=your_secure_random_string_here`
- **Quando necessaria:** **REQUIRED in produzione**
- **Generazione:** `openssl rand -base64 48`

#### SUPERADMIN_PASSWORD
- **Descrizione:** Password per utente superadmin di default (creato automaticamente se auth_users è vuoto)
- **Tipo:** String
- **Default:** Nessuno (REQUIRED)
- **Esempio:** `SUPERADMIN_PASSWORD=secure_password_here`
- **Quando necessaria:** **REQUIRED in produzione**
- **Nota:** Username superadmin di default è "admin" (configurabile via SUPERADMIN_USERNAME)

#### STORE_PASSWORD
- **Descrizione:** Password per utente store di default (creato automaticamente se auth_users è vuoto)
- **Tipo:** String
- **Default:** Nessuno (REQUIRED)
- **Esempio:** `STORE_PASSWORD=secure_password_here`
- **Quando necessaria:** **REQUIRED in produzione**

#### SUPERADMIN_USERNAME
- **Descrizione:** Username per utente superadmin di default
- **Tipo:** String
- **Default:** `admin`
- **Esempio:** `SUPERADMIN_USERNAME=superadmin`
- **Quando necessaria:** Opzionale

---

### Tenant Configuration

#### DEFAULT_TENANT_SLUG
- **Descrizione:** Slug del tenant di default (creato automaticamente se non esiste)
- **Tipo:** String
- **Default:** `default`
- **Esempio:** `DEFAULT_TENANT_SLUG=main`
- **Quando necessaria:** Opzionale

#### DEFAULT_TENANT_NAME
- **Descrizione:** Nome del tenant di default
- **Tipo:** String
- **Default:** `Default Tenant`
- **Esempio:** `DEFAULT_TENANT_NAME=Main Organization`
- **Quando necessaria:** Opzionale

#### ENFORCE_TENANT_PREFIX
- **Descrizione:** Se true, forza tutti gli URL ad avere prefisso tenant (`/t/:tenantSlug/...`)
- **Tipo:** Boolean (string "true" o "false")
- **Default:** `false`
- **Esempio:** `ENFORCE_TENANT_PREFIX=true`
- **Quando necessaria:** Opzionale

---

### Rate Limiting - Login

#### LOGIN_WINDOW_MS
- **Descrizione:** Finestra temporale per rate limiting login (in millisecondi)
- **Tipo:** Number
- **Default:** `600000` (10 minuti)
- **Esempio:** `LOGIN_WINDOW_MS=600000`
- **Quando necessaria:** Opzionale

#### LOGIN_MAX_ATTEMPTS
- **Descrizione:** Numero massimo di tentativi login falliti nella finestra temporale
- **Tipo:** Number
- **Default:** `10`
- **Esempio:** `LOGIN_MAX_ATTEMPTS=5`
- **Quando necessaria:** Opzionale

#### LOGIN_LOCK_MS
- **Descrizione:** Durata lockout dopo troppi tentativi falliti (in millisecondi)
- **Tipo:** Number
- **Default:** `1800000` (30 minuti)
- **Esempio:** `LOGIN_LOCK_MS=3600000` (1 ora)
- **Quando necessaria:** Opzionale

---

### Rate Limiting - Form Submission

#### SUBMIT_WINDOW_MS
- **Descrizione:** Finestra temporale per rate limiting form submission (in millisecondi)
- **Tipo:** Number
- **Default:** `600000` (10 minuti)
- **Esempio:** `SUBMIT_WINDOW_MS=600000`
- **Quando necessaria:** Opzionale

#### SUBMIT_MAX_PER_IP
- **Descrizione:** Numero massimo di submission per IP nella finestra temporale
- **Tipo:** Number
- **Default:** `20`
- **Esempio:** `SUBMIT_MAX_PER_IP=10`
- **Quando necessaria:** Opzionale

#### SUBMIT_LOCK_MS
- **Descrizione:** Durata lockout dopo troppe submission (in millisecondi)
- **Tipo:** Number
- **Default:** `1800000` (30 minuti)
- **Esempio:** `SUBMIT_LOCK_MS=3600000`
- **Quando necessaria:** Opzionale

---

### Rate Limiting - Email

#### EMAIL_DAILY_WINDOW_MS
- **Descrizione:** Finestra temporale giornaliera per limiti email (in millisecondi)
- **Tipo:** Number
- **Default:** `86400000` (24 ore)
- **Esempio:** `EMAIL_DAILY_WINDOW_MS=86400000`
- **Quando necessaria:** Opzionale

#### EMAIL_MAX_PER_DAY
- **Descrizione:** Numero massimo di email inviate per indirizzo email al giorno
- **Tipo:** Number
- **Default:** `3`
- **Esempio:** `EMAIL_MAX_PER_DAY=5`
- **Quando necessaria:** Opzionale

#### EMAIL_LOCK_MS
- **Descrizione:** Durata lockout dopo troppe email (in millisecondi)
- **Tipo:** Number
- **Default:** `86400000` (24 ore)
- **Esempio:** `EMAIL_LOCK_MS=86400000`
- **Quando necessaria:** Opzionale

---

### reCAPTCHA

#### RECAPTCHA_ENABLED
- **Descrizione:** Abilita verifica reCAPTCHA per form submission
- **Tipo:** Boolean (string "true" o "false")
- **Default:** `false`
- **Esempio:** `RECAPTCHA_ENABLED=true`
- **Quando necessaria:** Opzionale (solo se vuoi protezione reCAPTCHA)

#### RECAPTCHA_SITE_KEY
- **Descrizione:** Site key reCAPTCHA (da Google reCAPTCHA admin)
- **Tipo:** String
- **Default:** Nessuno
- **Esempio:** `RECAPTCHA_SITE_KEY=6LeIxAcTAAAAAJcZVRqyHh71UMIEGNQ_MXjiZKhI`
- **Quando necessaria:** Richiesta se `RECAPTCHA_ENABLED=true`

#### RECAPTCHA_SECRET
- **Descrizione:** Secret key reCAPTCHA (da Google reCAPTCHA admin)
- **Tipo:** String
- **Default:** Nessuno
- **Esempio:** `RECAPTCHA_SECRET=6LeIxAcTAAAAAGG-vFI1TnRWxMZNFuojJ4WifJWe`
- **Quando necessaria:** Richiesta se `RECAPTCHA_ENABLED=true`

---

### Email Configuration

#### MAIL_PROVIDER
- **Descrizione:** Provider email da utilizzare: "mailgun" o "smtp"
- **Tipo:** String
- **Default:** Nessuno (fallback a JSON transport per sviluppo)
- **Esempio:** `MAIL_PROVIDER=mailgun` o `MAIL_PROVIDER=smtp`
- **Quando necessaria:** Richiesta per invio email reale

#### Mailgun Configuration

##### MAILGUN_API_KEY
- **Descrizione:** API key Mailgun
- **Tipo:** String
- **Default:** Nessuno
- **Esempio:** `MAILGUN_API_KEY=key-1234567890abcdef`
- **Quando necessaria:** Richiesta se `MAIL_PROVIDER=mailgun`

##### MAILGUN_DOMAIN
- **Descrizione:** Dominio Mailgun (es. "mg.example.com" o "example.com")
- **Tipo:** String
- **Default:** Nessuno
- **Esempio:** `MAILGUN_DOMAIN=mg.example.com`
- **Quando necessaria:** Richiesta se `MAIL_PROVIDER=mailgun`

##### MAILGUN_FROM
- **Descrizione:** Indirizzo mittente Mailgun globale (fallback se tenant non ha configurazione)
- **Tipo:** String (formato "Name <email@domain.com>")
- **Default:** `CouponGen <no-reply@send.coupongen.it>`
- **Esempio:** `MAILGUN_FROM=CouponGen <no-reply@send.coupongen.it>`
- **Quando necessaria:** Opzionale (ha default)

##### MAILGUN_REGION
- **Descrizione:** Regione Mailgun: "us" o "eu"
- **Tipo:** String
- **Default:** `eu`
- **Esempio:** `MAILGUN_REGION=us`
- **Quando necessaria:** Opzionale

##### MAILGUN_TRACKING
- **Descrizione:** Abilita tracking Mailgun (opens, clicks)
- **Tipo:** Boolean (string "true" o "false")
- **Default:** `false`
- **Esempio:** `MAILGUN_TRACKING=true`
- **Quando necessaria:** Opzionale

##### MAILGUN_REPLY_TO
- **Descrizione:** Indirizzo Reply-To globale per email Mailgun
- **Tipo:** String (email)
- **Default:** Nessuno
- **Esempio:** `MAILGUN_REPLY_TO=support@example.com`
- **Quando necessaria:** Opzionale

#### SMTP Configuration

##### SMTP_HOST
- **Descrizione:** Host SMTP server
- **Tipo:** String
- **Default:** Nessuno
- **Esempio:** `SMTP_HOST=smtp.gmail.com` o `SMTP_HOST=smtp.office365.com`
- **Quando necessaria:** Richiesta se `MAIL_PROVIDER=smtp`

##### SMTP_PORT
- **Descrizione:** Porta SMTP server
- **Tipo:** Number
- **Default:** `587`
- **Esempio:** `SMTP_PORT=587` (TLS) o `SMTP_PORT=465` (SSL)
- **Quando necessaria:** Opzionale (ha default)

##### SMTP_SECURE
- **Descrizione:** Usa connessione SSL/TLS sicura
- **Tipo:** Boolean (string "true" o "false")
- **Default:** `false`
- **Esempio:** `SMTP_SECURE=true` (per porta 465)
- **Quando necessaria:** Opzionale

##### SMTP_USER
- **Descrizione:** Username SMTP (email)
- **Tipo:** String
- **Default:** Nessuno
- **Esempio:** `SMTP_USER=your_email@gmail.com`
- **Quando necessaria:** Richiesta se `MAIL_PROVIDER=smtp`

##### SMTP_PASS
- **Descrizione:** Password SMTP (o app password per Gmail)
- **Tipo:** String
- **Default:** Nessuno
- **Esempio:** `SMTP_PASS=your_app_password`
- **Quando necessaria:** Richiesta se `MAIL_PROVIDER=smtp`

#### Email Template Defaults

##### MAIL_SUBJECT
- **Descrizione:** Oggetto email di default
- **Tipo:** String
- **Default:** `Il tuo coupon`
- **Esempio:** `MAIL_SUBJECT=Il tuo coupon speciale`
- **Quando necessaria:** Opzionale

##### MAIL_FROM
- **Descrizione:** Indirizzo mittente di default (fallback globale)
- **Tipo:** String (formato "Name <email@domain.com>")
- **Default:** `CouponGen <no-reply@send.coupongen.it>`
- **Esempio:** `MAIL_FROM=CouponGen <no-reply@send.coupongen.it>`
- **Quando necessaria:** Opzionale

##### MAIL_TEST_TO
- **Descrizione:** Indirizzo email per test invio email
- **Tipo:** String
- **Default:** `test@example.com`
- **Esempio:** `MAIL_TEST_TO=test@example.com`
- **Quando necessaria:** Opzionale

---

### Upload Configuration

#### UPLOAD_MAX_BYTES
- **Descrizione:** Dimensione massima file upload in bytes
- **Tipo:** Number
- **Default:** `2097152` (2 MB)
- **Esempio:** `UPLOAD_MAX_BYTES=5242880` (5 MB)
- **Quando necessaria:** Opzionale

---

### Default Values

#### DEFAULT_DISCOUNT_PERCENT
- **Descrizione:** Percentuale sconto di default se nessuna campagna specificata
- **Tipo:** Number
- **Default:** `10`
- **Esempio:** `DEFAULT_DISCOUNT_PERCENT=15`
- **Quando necessaria:** Opzionale

---

### Timeout Configuration (Opzionali)

#### SERVER_KEEPALIVE_TIMEOUT
- **Descrizione:** Timeout keepalive server HTTP (ms)
- **Tipo:** Number
- **Default:** Node.js default
- **Esempio:** `SERVER_KEEPALIVE_TIMEOUT=65000`
- **Quando necessaria:** Opzionale (solo se necessario tuning)

#### SERVER_HEADERS_TIMEOUT
- **Descrizione:** Timeout headers HTTP (ms)
- **Tipo:** Number
- **Default:** Node.js default
- **Esempio:** `SERVER_HEADERS_TIMEOUT=66000`
- **Quando necessaria:** Opzionale

#### SERVER_REQUEST_TIMEOUT
- **Descrizione:** Timeout richiesta HTTP (ms)
- **Tipo:** Number
- **Default:** Node.js default
- **Esempio:** `SERVER_REQUEST_TIMEOUT=30000`
- **Quando necessaria:** Opzionale

#### SERVER_OVERALL_TIMEOUT
- **Descrizione:** Timeout complessivo richiesta (ms)
- **Tipo:** Number
- **Default:** Node.js default
- **Esempio:** `SERVER_OVERALL_TIMEOUT=30000`
- **Quando necessaria:** Opzionale

#### DB_BUSY_TIMEOUT
- **Descrizione:** Timeout database locked (ms)
- **Tipo:** Number
- **Default:** `30000` (30 secondi)
- **Esempio:** `DB_BUSY_TIMEOUT=60000`
- **Quando necessaria:** Opzionale

#### EMAIL_CONNECTION_TIMEOUT
- **Descrizione:** Timeout connessione email (ms)
- **Tipo:** Number
- **Default:** `30000` (30 secondi)
- **Esempio:** `EMAIL_CONNECTION_TIMEOUT=30000`
- **Quando necessaria:** Opzionale

#### EMAIL_SOCKET_TIMEOUT
- **Descrizione:** Timeout socket email (ms)
- **Tipo:** Number
- **Default:** `30000` (30 secondi)
- **Esempio:** `EMAIL_SOCKET_TIMEOUT=30000`
- **Quando necessaria:** Opzionale

---

## Configurazione per Ambiente

### Sviluppo

```env
PORT=3000
DATA_DIR=./data
UPLOADS_DIR=./static/uploads
SESSION_SECRET=dev_secret_change_in_production
SUPERADMIN_PASSWORD=dev_password
STORE_PASSWORD=dev_password
DEFAULT_TENANT_SLUG=default
ENFORCE_TENANT_PREFIX=false
# Nessuna configurazione email (usa JSON transport, log in console)
```

### Produzione

```env
PORT=3000
DATA_DIR=/app/data
UPLOADS_DIR=/app/data/uploads
SESSION_SECRET=<genera_con_openssl_rand_base64_48>
SUPERADMIN_PASSWORD=<password_sicura>
STORE_PASSWORD=<password_sicura>
DEFAULT_TENANT_SLUG=default
ENFORCE_TENANT_PREFIX=true

# Email (Mailgun raccomandato)
MAIL_PROVIDER=mailgun
MAILGUN_API_KEY=<your_key>
MAILGUN_DOMAIN=<your_domain.mailgun.org>
MAILGUN_REGION=eu

# Rate limiting più restrittivo
LOGIN_MAX_ATTEMPTS=5
SUBMIT_MAX_PER_IP=10
EMAIL_MAX_PER_DAY=3

# reCAPTCHA (raccomandato)
RECAPTCHA_ENABLED=true
RECAPTCHA_SITE_KEY=<your_site_key>
RECAPTCHA_SECRET=<your_secret>
```

---

## Checklist Produzione

- [ ] `SESSION_SECRET` generato con `openssl rand -base64 48`
- [ ] `SUPERADMIN_PASSWORD` cambiato da default
- [ ] `STORE_PASSWORD` cambiato da default
- [ ] `MAIL_PROVIDER` configurato (mailgun o smtp)
- [ ] Credenziali email configurate correttamente
- [ ] `ENFORCE_TENANT_PREFIX=true` se vuoi forzare prefisso tenant
- [ ] Rate limiting configurato secondo necessità
- [ ] `RECAPTCHA_ENABLED=true` se vuoi protezione reCAPTCHA
- [ ] `UPLOAD_MAX_BYTES` configurato secondo necessità

---

## Note Importanti

1. **Tenant Email Configuration:** Ogni tenant può configurare `email_from_name` e `email_from_address` via admin interface. La configurazione globale serve come fallback.

2. **Mailgun Custom Domains:** I tenant possono avere domini Mailgun personalizzati (`mailgun_domain` nella tabella `tenants`).

3. **Password Hashing:** Le password sono hashate con bcrypt (cost factor 10). Supporto legacy per Base64 hash per backward compatibility.

4. **Session Store:** Le sessioni sono memorizzate in-memory (non Redis). Per produzione con più istanze, considera session store esterno.

5. **Database:** SQLite è utilizzato di default. Per produzione con alta concorrenza, considera migrazione a PostgreSQL.

---

## Riferimenti

- Vedi `env.example` per template completo
- Vedi `docs/DEPLOY_RAILWAY.md` per configurazione deploy Railway
- Vedi `LLM_MD/DATABASE_SCHEMA.md` per schema database

