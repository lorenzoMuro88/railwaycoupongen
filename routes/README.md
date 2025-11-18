# Routes Module - FLYCouponGen

Panoramica del modulo routes che gestisce tutti gli endpoint HTTP dell'applicazione.

## Struttura

```
routes/
├── auth.js              # Route autenticazione (login, logout, signup)
└── admin/               # Route admin modulari
    ├── index.js         # Entry point (setupAdminRoutes)
    ├── campaigns.js     # Gestione campagne (12+ endpoint)
    ├── users.js         # Gestione utenti (6 endpoint)
    ├── coupons.js       # Gestione coupon (3 endpoint)
    ├── analytics.js     # Analytics e report (4 endpoint)
    ├── settings.js      # Impostazioni (13 endpoint)
    ├── products.js      # Gestione prodotti (4 endpoint)
    └── auth-users.js    # Gestione auth-users (4 endpoint)
```

## Pattern Comuni

### Route Registration

Le route admin supportano due varianti:
1. **Legacy**: `/api/admin/*` - Usa session/referer per tenant resolution
2. **Tenant-scoped**: `/t/:tenantSlug/api/admin/*` - Usa URL path per tenant resolution

Usa `registerAdminRoute()` helper per registrare entrambe le varianti automaticamente:

```javascript
const { registerAdminRoute, getTenantId } = require('../../utils/routeHelper');

registerAdminRoute(app, '/campaigns', 'get', async (req, res) => {
    const tenantId = await getTenantId(req);
    // ... handler logic
});
```

### Tenant Isolation

**IMPORTANTE:** Tutte le query database DEVONO includere filtro `tenant_id`:

```javascript
// ✅ Corretto
const campaigns = await dbConn.all(
    'SELECT * FROM campaigns WHERE tenant_id = ?',
    tenantId
);

// ❌ ERRATO - Manca tenant_id filter
const campaigns = await dbConn.all('SELECT * FROM campaigns');
```

### Error Handling

Usa sempre try-catch e logger strutturato:

```javascript
try {
    // ... logic
    res.json(result);
} catch (e) {
    logger.withRequest(req).error({ err: e }, 'Error description');
    res.status(500).json({ error: 'Errore server' });
}
```

### Response Format

- **Successo**: `res.json({ success: true, ... })` o `res.json(data)`
- **Errore**: `res.status(code).json({ error: 'Messaggio' })`

Codici HTTP comuni:
- `200` - Successo
- `400` - Bad Request (validazione fallita)
- `403` - Forbidden (non autorizzato)
- `404` - Not Found (risorsa non trovata)
- `409` - Conflict (risorsa già esistente)
- `500` - Internal Server Error
- `503` - Service Unavailable (database locked)

## Come Aggiungere Nuove Route

### 1. Route Admin Standard

```javascript
// In routes/admin/[module].js
const { registerAdminRoute, getTenantId } = require('../../utils/routeHelper');

function setupModuleRoutes(app) {
    registerAdminRoute(app, '/resource', 'get', async (req, res) => {
        try {
            const dbConn = await getDb();
            const tenantId = await getTenantId(req);
            if (!tenantId) return res.status(400).json({ error: 'Tenant non valido' });
            
            // ... handler logic
            
            res.json(result);
        } catch (e) {
            logger.withRequest(req).error({ err: e }, 'Error description');
            res.status(500).json({ error: 'Errore server' });
        }
    });
}

module.exports = { setupModuleRoutes };
```

### 2. Route Tenant-Scoped Only

Per route che devono essere solo tenant-scoped (non legacy):

```javascript
const { tenantLoader, requireSameTenantAsSession } = require('../../middleware/tenant');
const { requireRole } = require('../../middleware/auth');

app.post('/t/:tenantSlug/api/admin/resource', 
    tenantLoader, 
    requireSameTenantAsSession, 
    requireRole('admin'),
    async (req, res) => {
        // req.tenant è già caricato da tenantLoader
        const tenantId = req.tenant.id;
        // ... handler logic
    }
);
```

### 3. Route Pubbliche

```javascript
app.post('/t/:tenantSlug/submit', tenantLoader, async (req, res) => {
    // Route pubblica, no autenticazione richiesta
    // req.tenant disponibile se tenant-scoped
});
```

## Documentazione JSDoc

Tutte le route dovrebbero avere JSDoc completo:

```javascript
/**
 * GET /api/admin/resource - List resources
 * 
 * @route GET /api/admin/resource
 * @middleware requireAdmin
 * @param {ExpressRequest} req
 * @param {Express.Response} res
 * @returns {Array<Resource>} Array of resources
 * @throws {400} Bad Request
 * @throws {500} Internal Server Error
 */
```

Vedi `LLM_MD/TYPES.md` per definizioni tipo.

## Moduli Routes

### auth.js

Gestisce autenticazione:
- `POST /api/login` - Login admin/store
- `POST /api/logout` - Logout
- `POST /api/signup` - Registrazione tenant + primo admin
- Pagine HTML: `/login`, `/signup`, `/access`

### admin/campaigns.js

Gestione campagne promozionali:
- CRUD completo campagne
- Attivazione/disattivazione
- Configurazione form
- Custom fields
- Associazione prodotti
- Form links (tenant-scoped only)

### admin/users.js

Gestione utenti finali:
- Lista utenti con filtri (search, campaigns)
- Export CSV
- CRUD utenti
- Custom fields
- Lista coupon utente

### admin/coupons.js

Gestione coupon:
- Ricerca coupon (codice o cognome)
- Lista coupon con filtri (status, paginazione)
- Eliminazione coupon

### admin/analytics.js

Analytics e report:
- Statistiche generali
- Statistiche per campagna
- Statistiche temporali (day/week)
- Export CSV/JSON

### admin/settings.js

Impostazioni applicazione:
- Test invio email
- Configurazione email (from name, template)
- Upload immagini
- Brand settings (colori, logo)
- Form customization globale

### admin/products.js

Gestione prodotti:
- CRUD prodotti
- Validazione SKU unico per tenant
- Calcolo margin_price per analytics

### admin/auth-users.js

Gestione utenti autenticati:
- Lista auth-users (tenant-scoped o globale per superadmin)
- CRUD auth-users
- Protezioni sicurezza (solo superadmin può creare admin)

## Riferimenti

- Vedi `utils/routeHelper.js` per helper route registration
- Vedi `middleware/auth.js` per middleware autenticazione
- Vedi `middleware/tenant.js` per middleware tenant
- Vedi `LLM_MD/TYPES.md` per definizioni tipo
- Vedi `docs/API_REFERENCE.md` per documentazione API completa


