# Middleware Module - FLYCouponGen

Panoramica del modulo middleware che fornisce funzionalità riutilizzabili per le route Express.

## Struttura

```
middleware/
├── auth.js          # Autenticazione e autorizzazione
├── tenant.js        # Tenant loading e validazione
├── rateLimit.js     # Rate limiting
└── csrf.js          # CSRF protection
```

## Ordine di Applicazione

L'ordine dei middleware è **critico**. Ordine corretto per route protette:

```javascript
// 1. Tenant loading (se route tenant-scoped)
tenantLoader

// 2. Tenant validation (se route tenant-scoped)
requireSameTenantAsSession

// 3. Authentication
requireAuth (o requireAdmin, requireStore, requireRole)

// 4. Route handler
async (req, res) => { ... }
```

**Esempio:**

```javascript
app.get('/t/:tenantSlug/api/admin/campaigns',
    tenantLoader,                    // 1. Carica tenant
    requireSameTenantAsSession,      // 2. Verifica tenant match
    requireRole('admin'),            // 3. Verifica ruolo
    handler                          // 4. Handler
);
```

## Middleware Disponibili

### auth.js

#### requireAuth
Richiede autenticazione (qualsiasi utente loggato).

```javascript
app.get('/protected', requireAuth, handler);
```

#### requireAdmin
Richiede ruolo admin o superadmin.

```javascript
app.get('/api/admin/resource', requireAdmin, handler);
```

#### requireSuperAdmin
Richiede ruolo superadmin.

```javascript
app.get('/superadmin/resource', requireSuperAdmin, handler);
```

#### requireStore
Richiede ruolo store, admin, o superadmin.

```javascript
app.get('/store/resource', requireStore, handler);
```

#### requireRole(role)
Factory per middleware role-specific.

```javascript
const requireAdminRole = requireRole('admin');
app.get('/api/admin/resource', requireAdminRole, handler);
```

**Comportamento:**
- Superadmin può accedere a tutto
- Admin può accedere a route admin
- Store può accedere solo a route store (admin può anche accedere)

### tenant.js

#### tenantLoader
Carica tenant da URL slug (`/t/:tenantSlug/...`).

```javascript
app.get('/t/:tenantSlug/api/resource', tenantLoader, handler);
```

**Effetti:**
- Imposta `req.tenant` (oggetto tenant completo)
- Imposta `req.tenantSlug` (slug tenant)
- Restituisce 404 se tenant non trovato

#### requireSameTenantAsSession
Verifica che tenant in URL corrisponda a tenant della sessione.

```javascript
app.get('/t/:tenantSlug/api/admin/resource',
    tenantLoader,
    requireSameTenantAsSession,  // Verifica match
    handler
);
```

**Comportamento:**
- Superadmin: Sempre permesso
- Altri: Verifica `req.tenant.id === req.session.user.tenantId`
- Restituisce 403 se non match

#### getTenantIdForApi(req)
Helper per risolvere tenant ID in route legacy.

```javascript
// In route handler
const tenantId = await getTenantIdForApi(req);
```

**Risoluzione:**
1. `req.tenant.id` (se disponibile)
2. Referer header (`/t/:tenantSlug/...`)
3. `req.session.user.tenantId`

### rateLimit.js

#### checkLoginRateLimit(ip)
Verifica rate limit per login.

```javascript
const rate = checkLoginRateLimit(req.ip);
if (!rate.ok) {
    return res.status(429).json({ error: 'Troppi tentativi' });
}
```

#### recordLoginFailure(ip)
Registra tentativo login fallito.

```javascript
recordLoginFailure(req.ip);
```

#### recordLoginSuccess(ip)
Registra login riuscito (resetta contatore).

```javascript
recordLoginSuccess(req.ip);
```

#### checkSubmitRateLimit(req, res, next)
Middleware per rate limiting form submission.

```javascript
app.post('/submit', checkSubmitRateLimit, handler);
```

**Configurazione:**
- `SUBMIT_WINDOW_MS` - Finestra temporale (default: 10 min)
- `SUBMIT_MAX_PER_IP` - Max tentativi per IP (default: 20)
- `SUBMIT_LOCK_MS` - Durata lockout (default: 30 min)

### csrf.js

#### csrfProtection
Middleware CSRF protection per tutte le route mutanti.

```javascript
app.use(csrfProtection);
```

#### csrfIfProtectedRoute
CSRF solo per route mutanti autenticate.

```javascript
app.use(csrfIfProtectedRoute);
```

**Comportamento:**
- Genera token CSRF per sessioni autenticate
- Verifica token su POST/PUT/DELETE
- Esclude route pubbliche (es. `/submit`)

## Come Creare Nuovo Middleware

### Template Base

```javascript
'use strict';

/**
 * Middleware: [Nome] - [Descrizione]
 * 
 * @param {ExpressRequest} req - Express request object
 * @param {Express.Response} res - Express response object
 * @param {Function} next - Express next middleware function
 * @returns {void}
 * 
 * @example
 * app.get('/route', myMiddleware, handler);
 */
function myMiddleware(req, res, next) {
    // Pre-processing
    if (/* condition */) {
        return res.status(400).json({ error: 'Error message' });
    }
    
    // Set request properties
    req.customProperty = value;
    
    // Continue to next middleware
    next();
}

module.exports = { myMiddleware };
```

### Middleware Factory

Per middleware configurabili:

```javascript
/**
 * Middleware factory: Create configurable middleware
 * 
 * @param {Object} options - Configuration options
 * @returns {Function} Express middleware function
 */
function createMiddleware(options) {
    return function(req, res, next) {
        // Use options
        // ... logic
        next();
    };
}

module.exports = { createMiddleware };
```

## Best Practices

1. **Sempre chiamare `next()`** se middleware passa, altrimenti rispondere con `res.status().json()` o `res.redirect()`

2. **Usare logger strutturato** per errori:

```javascript
const logger = require('../utils/logger');

try {
    // ... logic
    next();
} catch (e) {
    logger.withRequest(req).error({ err: e }, 'Middleware error');
    res.status(500).json({ error: 'Errore server' });
}
```

3. **Documentare comportamento** con JSDoc completo

4. **Testare middleware** isolatamente quando possibile

5. **Non modificare `req` in modo imprevisto** - documenta tutte le proprietà aggiunte

## Riferimenti

- Vedi `LLM_MD/TYPES.md` per definizioni tipo (ExpressRequest, etc.)
- Vedi `routes/README.md` per utilizzo middleware nelle route
- Vedi `docs/ARCHITECTURE.md` per architettura generale



