# Architettura FLYCouponGen

## Panoramica

FLYCouponGen è un'applicazione Node.js/Express multi-tenant per la gestione di coupon. Il progetto è stato refactorizzato in un'architettura modulare per migliorare manutenibilità, testabilità e performance.

## Struttura Modulare

### 📁 Routes (`routes/`)

#### `routes/auth.js`
Gestisce tutte le route di autenticazione e utilità password.

**Funzioni esportate:**
- `setupAuthRoutes(app)` - Configura tutte le route di autenticazione

**Route gestite:**
- `POST /api/login` - Login admin/store
- `POST /api/logout` - Logout
- `POST /api/signup` - Registrazione tenant + primo admin
- `GET /login`, `/access`, `/signup` - Pagine HTML
- `GET /store-login`, `/superadmin-login` - Pagine login specializzate
- `GET /logout`, `/t/:tenantSlug/logout` - Logout con redirect

**Funzioni helper:**
- `hashPassword(password)` - Hash password con bcrypt
- `verifyPassword(password, hash)` - Verifica password
- `logAction(req, actionType, description, level)` - Log azioni utente

#### `routes/admin/index.js`
Entry point per tutte le route admin. Importa e configura tutti i moduli admin.

**Funzioni esportate:**
- `setupAdminRoutes(app)` - Configura tutte le route admin

**Moduli inclusi:**
- `campaigns.js` - Gestione campagne
- `users.js` - Gestione utenti
- `coupons.js` - Gestione coupon
- `analytics.js` - Analytics e report
- `settings.js` - Impostazioni
- `products.js` - Gestione prodotti
- `auth-users.js` - Gestione auth-users

#### `routes/admin/campaigns.js`
Gestione completa delle campagne promozionali.

**Endpoint:**
- `GET /api/admin/campaigns` - Lista campagne
- `POST /api/admin/campaigns` - Crea campagna
- `PUT /api/admin/campaigns/:id` - Aggiorna campagna
- `DELETE /api/admin/campaigns/:id` - Elimina campagna
- `PUT /api/admin/campaigns/:id/activate` - Attiva campagna
- `PUT /api/admin/campaigns/:id/deactivate` - Disattiva campagna
- `GET /api/admin/campaigns/:id/form-config` - Get configurazione form
- `PUT /api/admin/campaigns/:id/form-config` - Aggiorna configurazione form
- `GET /api/admin/campaigns-list` - Lista campagne per select
- `GET /api/admin/campaigns/:id/custom-fields` - Get custom fields
- `PUT /api/admin/campaigns/:id/custom-fields` - Aggiorna custom fields
- `GET /api/admin/campaigns/:id/products` - Lista prodotti campagna
- `POST /api/admin/campaigns/:id/products` - Aggiungi prodotto a campagna
- `POST /t/:tenantSlug/api/admin/campaigns/:id/form-links` - Genera form links (solo tenant-scoped)
- `GET /t/:tenantSlug/api/admin/campaigns/:id/form-links` - Lista form links (solo tenant-scoped)

**Caratteristiche:**
- Auto-deattivazione campagne scadute
- Generazione automatica campaign_code unico
- Configurazione form personalizzabile
- Associazione prodotti per calcolo analytics

#### `routes/admin/users.js`
Gestione utenti e custom fields.

**Endpoint:**
- `GET /api/admin/users` - Lista utenti con filtri (search, campaigns)
- `GET /api/admin/users/export.csv` - Export utenti CSV
- `GET /api/admin/users/:id` - Dettaglio utente
- `PUT /api/admin/users/:id` - Aggiorna utente
- `DELETE /api/admin/users/:id` - Elimina utente (con controllo coupon attivi)
- `GET /api/admin/users/:id/coupons` - Coupon dell'utente

**Ottimizzazioni:**
- ✅ Risolto N+1 query problem: custom fields recuperati in query unica
- Query ottimizzata con JOIN per campagne e coupon

#### `routes/admin/coupons.js`
Gestione coupon.

**Endpoint:**
- `GET /api/admin/coupons/search` - Ricerca coupon (codice o cognome)
- `GET /api/admin/coupons` - Lista coupon con filtri (status, limit, offset, order)
- `DELETE /api/admin/coupons/:id` - Elimina coupon

**Caratteristiche:**
- Ricerca case-insensitive
- Paginazione e ordinamento
- Filtri per status

#### `routes/admin/analytics.js`
Analytics e report.

**Endpoint:**
- `GET /api/admin/analytics/summary` - Statistiche generali
- `GET /api/admin/analytics/campaigns` - Statistiche per campagna
- `GET /api/admin/analytics/temporal` - Statistiche temporali (day/week)
- `GET /api/admin/analytics/export` - Export analytics (CSV/JSON)

**Ottimizzazioni:**
- ✅ Eliminate correlated subqueries: pre-calcolo medie campagne
- Query ottimizzate con aggregazioni pre-calcolate
- Supporto filtri per date, campagna, status

#### `routes/admin/settings.js`
Impostazioni applicazione e tenant.

**Endpoint:**
- `GET /api/admin/test-email` - Test invio email
- `GET /api/admin/email-from-name` - Get nome mittente email
- `PUT /api/admin/email-from-name` - Aggiorna nome mittente email
- `GET /api/admin/form-customization` - Get configurazione form globale
- `POST /api/admin/form-customization` - Aggiorna configurazione form globale
- `GET /api/admin/email-template` - Get template email
- `POST /api/admin/email-template` - Aggiorna template email
- `POST /api/admin/upload-image` - Upload immagine (header form)
- `GET /api/admin/brand-settings` - Get brand settings (colori, logo)

**Caratteristiche:**
- Configurazione tenant-specific per email
- Upload immagini con validazione MIME e size limit
- Template email personalizzabili

#### `routes/admin/products.js`
Gestione prodotti.

**Endpoint:**
- `GET /api/admin/products` - Lista prodotti
- `POST /api/admin/products` - Crea prodotto
- `PUT /api/admin/products/:id` - Aggiorna prodotto
- `DELETE /api/admin/products/:id` - Elimina prodotto

**Caratteristiche:**
- Validazione SKU unico per tenant
- Calcolo margin_price per analytics

#### `routes/admin/auth-users.js`
Gestione utenti autenticati (admin/store).

**Endpoint:**
- `GET /api/admin/auth-users` - Lista auth-users (tenant-scoped o globale per superadmin)
- `POST /api/admin/auth-users` - Crea auth-user
- `PUT /api/admin/auth-users/:id` - Aggiorna auth-user
- `DELETE /api/admin/auth-users/:id` - Elimina auth-user

**Sicurezza:**
- Solo superadmin può creare/modificare utenti admin
- Protezione contro auto-disattivazione
- Tenant isolation garantita

### 🔐 Middleware (`middleware/`)

#### `middleware/auth.js`
Autenticazione e autorizzazione.

**Funzioni esportate:**
- `requireAuth(req, res, next)` - Richiede autenticazione
- `requireAdmin(req, res, next)` - Richiede ruolo admin
- `requireSuperAdmin(req, res, next)` - Richiede ruolo superadmin
- `requireStore(req, res, next)` - Richiede ruolo store
- `requireRole(role)` - Middleware factory per ruolo specifico

**Comportamento:**
- Verifica sessione valida
- Controlla ruolo utente
- Redirect a login se non autenticato

#### `middleware/tenant.js`
Tenant loading e validazione.

**Funzioni esportate:**
- `tenantLoader(req, res, next)` - Carica tenant da slug e imposta `req.tenant`
- `requireSameTenantAsSession(req, res, next)` - Verifica che tenant corrisponda alla sessione
- `getTenantIdForApi(req)` - Risolve tenant ID per route legacy (da session/referer)

**Comportamento:**
- Carica tenant dal database basandosi su slug
- Verifica esistenza e validità tenant
- Garantisce tenant isolation

#### `middleware/rateLimit.js`
Rate limiting per login e form submission.

**Funzioni esportate:**
- `checkLoginRateLimit(req, res, next)` - Verifica rate limit login
- `recordLoginFailure(req)` - Registra tentativo login fallito
- `recordLoginSuccess(req)` - Registra login riuscito
- `checkSubmitRateLimit(req, res, next)` - Verifica rate limit form submission
- `startCleanupInterval()` - Avvia cleanup periodico rate limiters

**Caratteristiche:**
- Lockout progressivo per login falliti
- Rate limiting per IP e email
- Cleanup automatico record scaduti

#### `middleware/csrf.js`
CSRF protection.

**Funzioni esportate:**
- `csrfProtection(req, res, next)` - Middleware CSRF protection
- `csrfIfProtectedRoute(req, res, next)` - CSRF solo per route mutanti

**Comportamento:**
- Genera token CSRF per sessioni autenticate
- Verifica token su POST/PUT/DELETE
- Esclude route pubbliche (es. `/submit`)

### 🛠️ Utils (`utils/`)

#### `utils/db.js`
Database connection e migrations.

**Funzioni esportate:**
- `getDb()` - Singleton database connection
- `ensureTenantEmailColumns(dbConn)` - Migration colonne email tenant
- `ensureFormCustomizationTenantId(dbConn)` - Migration tenant_id form_customization
- `ensureTenantScopedUniqueConstraints(dbConn)` - Migration unique constraints tenant-scoped

**Caratteristiche:**
- Singleton pattern per connessione
- Migrations idempotenti
- Configurazione performance (WAL, cache_size, temp_store)
- Indici compositi per performance

**Indici creati:**
- `idx_coupons_tenant_campaign_status` - Per analytics queries
- `idx_coupons_tenant_issued_at` - Per ordinamenti temporali
- `ux_users_tenant_email` - Per ricerche email (già esistente)

#### `utils/email.js`
Email transport e configurazione tenant-specific.

**Funzioni esportate:**
- `buildTransport()` - Crea email transport (Mailgun/SMTP)
- `buildTenantEmailFrom(tenant)` - Costruisce indirizzo mittente tenant-specific
- `getTenantMailgunDomain(tenant)` - Ottiene dominio Mailgun tenant-specific
- `parseMailFrom(fromString)` - Parsa stringa "Name <email>"
- `transporter` - Istanza transporter condivisa

**Caratteristiche:**
- Supporto Mailgun e SMTP
- Configurazione per-tenant (from name, domain, region)
- Fallback a configurazione globale

#### `utils/qrcode.js`
Generazione QR code.

**Funzioni esportate:**
- `generateQRDataURL(data)` - Genera QR code come data URL
- `generateQRBuffer(data)` - Genera QR code come Buffer

**Caratteristiche:**
- Wrapper su libreria qrcode
- Supporto data URL e Buffer
- Configurazione error correction level

#### `utils/logger.js`
Logger strutturato con pino e audit logging.

**Funzioni esportate:**
- `logger` - Istanza logger pino
- `logger.withRequest(req)` - Crea logger con contesto request
- `auditLog(req, actionType, resourceType, resourceId, description, details, level)` - Helper per audit logging

**Caratteristiche:**
- Pretty print in development
- JSON output in production
- Arricchimento log con requestId, tenant, method, path, ip
- Livelli: debug, info, warn, error
- Audit logging per operazioni CRUD e accessi sensibili

**Esempio audit logging:**
```javascript
const { auditLog } = require('./utils/logger');

// Log creazione
await auditLog(req, 'create', 'campaign', campaignId, 'Campaign created', { name: 'Summer Sale' }, 'success');

// Log aggiornamento
await auditLog(req, 'update', 'user', userId, 'User updated', { fields: ['email'] }, 'info');

// Log eliminazione
await auditLog(req, 'delete', 'coupon', couponId, 'Coupon deleted', {}, 'warning');
```

#### `utils/routeHelper.js`
Helper per unificare endpoint duplicati.

**Funzioni esportate:**
- `registerAdminRoute(app, path, method, handler)` - Registra route legacy e tenant-scoped
- `getTenantId(req)` - Risolve tenant ID per entrambi i tipi di route

**Caratteristiche:**
- Elimina duplicazione codice endpoint
- Applica middleware appropriati automaticamente
- Mantiene sicurezza tenant isolation
- Supporta parametri dinamici (`:id`)

**Esempio uso:**
```javascript
registerAdminRoute(app, '/campaigns', 'get', async (req, res) => {
    const tenantId = await getTenantId(req);
    // ... handler logic
});
```

## Pattern Architetturali

### Tenant Isolation

Tutti gli endpoint admin supportano due varianti:
- **Legacy**: `/api/admin/*` - Usa `getTenantIdForApi(req)` per risolvere tenant da session/referer
- **Tenant-scoped**: `/t/:tenantSlug/api/admin/*` - Usa `req.tenant.id` già caricato da `tenantLoader`

Il helper `registerAdminRoute()` registra automaticamente entrambe le varianti applicando i middleware appropriati.

### Error Handling

- Tutti gli errori vengono loggati con `logger.withRequest(req).error()`
- Errori database vengono gestiti con codici HTTP appropriati (400, 404, 409, 500, 503)
- Validazione input su tutti gli endpoint mutanti

### Performance

- ✅ N+1 query risolto: query batch per custom fields
- ✅ Correlated subqueries eliminate: pre-calcolo aggregazioni
- ✅ Indici compositi per query frequenti
- ✅ Query ottimizzate con JOIN invece di subquery

### Sicurezza

- Tenant isolation garantita a livello middleware
- CSRF protection per route mutanti
- Rate limiting per login e form submission
- Validazione input rigorosa
- Prepared statements per tutte le query
- Audit logging completo per operazioni CRUD e accessi sensibili
- Retention policy configurabile per audit logs (default: 90 giorni)

## Flusso Richiesta

1. **Request arriva** → Express routing
2. **Middleware CSRF** (se route mutante) → Verifica token
3. **Middleware Auth** (se route protetta) → Verifica sessione
4. **Middleware Tenant** (se tenant-scoped) → Carica tenant
5. **Middleware Role** (se admin route) → Verifica ruolo
6. **Route Handler** → Business logic
7. **Response** → JSON o HTML

## Best Practices

1. **Usa `registerAdminRoute()`** per nuovi endpoint admin
2. **Usa `getTenantId(req)`** invece di accedere direttamente a `req.tenant.id` o `req.session.user.tenantId`
3. **Logga errori** con `logger.withRequest(req).error()`
4. **Valida input** prima di processare
5. **Usa prepared statements** sempre (già garantito da `db.run()`, `db.all()`, `db.get()`)
6. **Mantieni tenant isolation** verificando sempre `tenant_id` nelle query

## Migrazioni Database

Le migrazioni sono idempotenti e vengono eseguite automaticamente all'avvio dell'applicazione. Vedi `utils/db.js` per dettagli.

## Audit Logging

Il sistema include audit logging completo per tutte le operazioni CRUD e accessi a dati sensibili.

**Funzionalità:**
- Logging automatico per create, update, delete operations
- Logging per accessi a dati sensibili (users, coupons, campaigns)
- Retention policy configurabile (default: 90 giorni)
- Endpoint `/api/admin/logs` per query log con filtri
- Log include: user, tenant, action type, description, level, IP, user agent

**Utilizzo:**
```javascript
const { auditLog } = require('./utils/logger');

// In route handler
await auditLog(req, 'create', 'campaign', campaignId, 'Campaign created', { name }, 'success');
```

**Retention Policy:**
- Configurabile via `LOG_RETENTION_DAYS` (default: 90)
- Cleanup automatico periodico
- Funzione `cleanupOldLogs()` disponibile per cleanup manuale

## Monitoring & Observability

Il sistema include health checks e monitoring per produzione.

**Health Check Endpoints:**
- `GET /health` - Basic health check (no database, fast response)
- `GET /healthz` - Health check con database connectivity
- `GET /healthz/detailed` - Health check dettagliato con metriche sistema

**Health Check Details:**
- Database connectivity e file size
- Memory usage (RSS, heap)
- Disk space (se disponibile)
- Server uptime
- Version info

**Esempio Response `/healthz/detailed`:**
```json
{
  "ok": true,
  "status": "healthy",
  "checks": {
    "database": {
      "ok": true,
      "details": {
        "size": 1048576,
        "sizeMB": "1.00",
        "modified": "2024-01-15T10:00:00.000Z"
      }
    },
    "memory": {
      "ok": true,
      "details": {
        "rss": "45.23",
        "heapTotal": "20.15",
        "heapUsed": "15.30"
      }
    }
  },
  "uptime": 3600,
  "timestamp": "2024-01-15T10:00:00.000Z",
  "version": "1.0.0",
  "nodeVersion": "v18.17.0"
}
```

**Metriche Prometheus (Opzionale):**
- Configurabile via `METRICS_ENABLED=true`
- Endpoint `/metrics` per scraping Prometheus
- Metriche base: response time, error rate, request count

## Testing

Vedi `scripts/test-*.js` per esempi di test. Il progetto include test per:
- CSRF protection
- Tenant isolation
- Autorizzazione
- Store functionality
- Superadmin operations
- Admin endpoints estesi
- Audit logging


