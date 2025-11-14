# Utils Module - FLYCouponGen

Panoramica del modulo utils che fornisce funzioni helper e utilities riutilizzabili.

## Struttura

```
utils/
├── db.js            # Database connection e migrations
├── email.js         # Email transport e configurazione
├── qrcode.js        # Generazione QR code
├── logger.js        # Logger strutturato (pino)
└── routeHelper.js   # Helper per route registration
```

## Utils Disponibili

### db.js

#### getDb()
Ottiene connessione database singleton.

```javascript
const { getDb } = require('./utils/db');
const db = await getDb();
const campaigns = await db.all('SELECT * FROM campaigns WHERE tenant_id = ?', tenantId);
```

**Caratteristiche:**
- Singleton pattern (una sola connessione)
- Crea database e tabelle se non esistono
- Esegue migrations automaticamente
- Configura performance settings (WAL, cache)

**Vedi:** `LLM_MD/DATABASE_SCHEMA.md` per schema completo

### email.js

#### buildTransport()
Crea email transport (Mailgun, SMTP, o JSON fallback).

```javascript
const { transporter } = require('./utils/email');
await transporter.sendMail({
    from: 'noreply@example.com',
    to: 'user@example.com',
    subject: 'Test',
    html: '<p>Test email</p>'
});
```

#### buildTenantEmailFrom(tenant)
Costruisce indirizzo email "from" per tenant.

```javascript
const { buildTenantEmailFrom } = require('./utils/email');
const from = buildTenantEmailFrom(req.tenant);
// Returns: "Mario's Store <noreply@mariostore.com>"
```

#### getTenantMailgunDomain(tenant)
Ottiene dominio Mailgun per tenant.

```javascript
const { getTenantMailgunDomain } = require('./utils/email');
const domain = getTenantMailgunDomain(req.tenant);
```

**Vedi:** `LLM_MD/CONFIGURATION.md` per configurazione email

### qrcode.js

#### generateQRDataURL(data)
Genera QR code come data URL (per embedding in HTML).

```javascript
const { generateQRDataURL } = require('./utils/qrcode');
const qrDataUrl = await generateQRDataURL('COUPON123');
// Returns: "data:image/png;base64,..."
```

#### generateQRBuffer(data)
Genera QR code come Buffer (per attachment email).

```javascript
const { generateQRBuffer } = require('./utils/qrcode');
const qrBuffer = await generateQRBuffer('COUPON123');
// Returns: Buffer
```

### logger.js

#### logger
Istanza logger pino strutturato.

```javascript
const logger = require('./utils/logger');

// Basic logging
logger.info('Server started');
logger.error({ err }, 'Error occurred');

// With context
logger.info({ userId: 1, action: 'login' }, 'User logged in');
```

#### logger.withRequest(req)
Crea logger con contesto request.

```javascript
const log = logger.withRequest(req);
log.info('Processing request');
log.error({ err }, 'Request failed');
// Logs include: requestId, tenant, method, path, ip
```

**Livelli:** debug, info, warn, error

### routeHelper.js

#### registerAdminRoute(app, path, method, handler)
Registra route admin (legacy + tenant-scoped).

```javascript
const { registerAdminRoute, getTenantId } = require('./utils/routeHelper');

registerAdminRoute(app, '/campaigns', 'get', async (req, res) => {
    const tenantId = await getTenantId(req);
    // ... handler logic
});
```

**Registra automaticamente:**
- `/api/admin/campaigns` (legacy)
- `/t/:tenantSlug/api/admin/campaigns` (tenant-scoped)

#### getTenantId(req)
Ottiene tenant ID (funziona per entrambi i tipi di route).

```javascript
const tenantId = await getTenantId(req);
if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
```

## Quando Usare Quale Utility

### Database Operations

**Usa `db.js`:**
- Query database
- Migrations
- Schema creation

**Esempio:**
```javascript
const { getDb } = require('./utils/db');
const db = await getDb();
const result = await db.all('SELECT * FROM campaigns WHERE tenant_id = ?', tenantId);
```

### Email Operations

**Usa `email.js`:**
- Invio email
- Configurazione email tenant-specific
- Parsing email addresses

**Esempio:**
```javascript
const { transporter, buildTenantEmailFrom } = require('./utils/email');
await transporter.sendMail({
    from: buildTenantEmailFrom(req.tenant),
    to: user.email,
    subject: 'Il tuo coupon',
    html: emailHtml
});
```

### QR Code Generation

**Usa `qrcode.js`:**
- Generazione QR code per coupon
- Embedding in HTML (data URL)
- Attachment email (Buffer)

**Esempio:**
```javascript
const { generateQRDataURL } = require('./utils/qrcode');
const qrUrl = await generateQRDataURL(coupon.code);
// Usa qrUrl in HTML: <img src="${qrUrl}" />
```

### Logging

**Usa `logger.js`:**
- Logging strutturato
- Error logging
- Request context logging

**Esempio:**
```javascript
const logger = require('./utils/logger');
logger.withRequest(req).info('Processing request');
logger.withRequest(req).error({ err }, 'Request failed');
```

### Route Registration

**Usa `routeHelper.js`:**
- Registrazione route admin
- Tenant ID resolution

**Esempio:**
```javascript
const { registerAdminRoute, getTenantId } = require('./utils/routeHelper');
registerAdminRoute(app, '/resource', 'get', async (req, res) => {
    const tenantId = await getTenantId(req);
    // ...
});
```

## Best Practices

1. **Sempre usare `getTenantId(req)`** invece di accedere direttamente a `req.tenant.id` o `req.session.user.tenantId`

2. **Usare logger strutturato** per tutti i log:

```javascript
// ✅ Corretto
logger.withRequest(req).error({ err }, 'Error description');

// ❌ Evitare
console.log('Error:', err);
```

3. **Gestire errori database** con codici HTTP appropriati:

```javascript
try {
    // ... database operation
} catch (e) {
    if (e.code === 'SQLITE_BUSY' || e.code === 'SQLITE_LOCKED') {
        return res.status(503).json({ error: 'Database temporaneamente occupato' });
    }
    logger.withRequest(req).error({ err: e }, 'Database error');
    res.status(500).json({ error: 'Errore server' });
}
```

4. **Tenant isolation** - sempre includere `tenant_id` nelle query:

```javascript
// ✅ Corretto
const campaigns = await db.all('SELECT * FROM campaigns WHERE tenant_id = ?', tenantId);

// ❌ ERRATO
const campaigns = await db.all('SELECT * FROM campaigns');
```

5. **Usare prepared statements** - già garantito da `db.run()`, `db.all()`, `db.get()`

## Riferimenti

- Vedi `LLM_MD/TYPES.md` per definizioni tipo
- Vedi `LLM_MD/DATABASE_SCHEMA.md` per schema database
- Vedi `LLM_MD/CONFIGURATION.md` per configurazione
- Vedi `docs/ARCHITECTURE.md` per architettura generale

