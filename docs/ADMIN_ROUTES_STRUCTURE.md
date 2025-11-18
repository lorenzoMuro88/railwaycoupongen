# Proposta Struttura Routes Admin

## Analisi Endpoint (43 totali)

### Raggruppamento per Funzionalità:

1. **Campaigns** (~12 endpoint)
   - GET `/api/admin/campaigns` - lista campagne
   - POST `/api/admin/campaigns` - crea campagna
   - PUT `/api/admin/campaigns/:id` - aggiorna campagna
   - PUT `/api/admin/campaigns/:id/activate` - attiva campagna
   - PUT `/api/admin/campaigns/:id/deactivate` - disattiva campagna
   - DELETE `/api/admin/campaigns/:id` - elimina campagna
   - GET `/api/admin/campaigns/:id/form-config` - configurazione form
   - PUT `/api/admin/campaigns/:id/form-config` - aggiorna form config
   - GET `/api/admin/campaigns/:id/custom-fields` - campi personalizzati
   - PUT `/api/admin/campaigns/:id/custom-fields` - aggiorna custom fields
   - GET `/api/admin/campaigns/:id/products` - prodotti associati
   - POST `/api/admin/campaigns/:id/products` - associa prodotti
   - GET `/api/admin/campaigns-list` - lista semplice campagne
   - POST `/api/admin/campaigns/:id/form-links` - genera link form
   - GET `/api/admin/campaigns/:id/form-links` - lista link form

2. **Users** (~6 endpoint)
   - GET `/api/admin/users` - lista utenti
   - GET `/api/admin/users/:id` - dettaglio utente
   - PUT `/api/admin/users/:id` - aggiorna utente
   - DELETE `/api/admin/users/:id` - elimina utente
   - GET `/api/admin/users/:id/coupons` - coupon utente
   - GET `/api/admin/users/export.csv` - export CSV

3. **Coupons** (~3 endpoint)
   - GET `/api/admin/coupons` - lista coupon
   - GET `/api/admin/coupons/search` - ricerca coupon
   - DELETE `/api/admin/coupons/:id` - elimina coupon

4. **Analytics** (~4 endpoint)
   - GET `/api/admin/analytics/summary` - riepilogo analytics
   - GET `/api/admin/analytics/campaigns` - analytics per campagna
   - GET `/api/admin/analytics/temporal` - analytics temporali
   - GET `/api/admin/analytics/export` - export analytics

5. **Settings** (~8 endpoint)
   - GET `/api/admin/email-template` - template email
   - POST `/api/admin/email-template` - aggiorna template
   - GET `/api/admin/form-customization` - personalizzazione form
   - POST `/api/admin/form-customization` - aggiorna form customization
   - GET `/api/admin/email-from-name` - nome mittente email
   - PUT `/api/admin/email-from-name` - aggiorna nome mittente
   - GET `/api/admin/brand-settings` - impostazioni brand
   - POST `/api/admin/upload-image` - upload immagine
   - GET `/api/admin/test-email` - test email

6. **Products** (~4 endpoint)
   - GET `/api/admin/products` - lista prodotti
   - POST `/api/admin/products` - crea prodotto
   - PUT `/api/admin/products/:id` - aggiorna prodotto
   - DELETE `/api/admin/products/:id` - elimina prodotto

7. **Auth Users** (~4 endpoint)
   - GET `/api/admin/auth-users` - lista utenti autenticati
   - POST `/api/admin/auth-users` - crea utente autenticato
   - PUT `/api/admin/auth-users/:id` - aggiorna utente autenticato
   - DELETE `/api/admin/auth-users/:id` - elimina utente autenticato

## Struttura Proposta

```
routes/
  admin/
    index.js          # File principale che esporta tutte le route
    campaigns.js      # Gestione campagne (12 endpoint)
    users.js          # Gestione utenti finali (6 endpoint)
    coupons.js        # Gestione coupon (3 endpoint)
    analytics.js      # Analytics e report (4 endpoint)
    settings.js       # Configurazioni (8 endpoint)
    products.js       # Gestione prodotti (4 endpoint)
    auth-users.js     # Gestione utenti autenticati (4 endpoint)
```

## Vantaggi di questa struttura:

1. **Modularità**: Ogni file ha una responsabilità chiara
2. **Manutenibilità**: Facile trovare e modificare endpoint specifici
3. **Testabilità**: Ogni modulo può essere testato indipendentemente
4. **Scalabilità**: Facile aggiungere nuovi endpoint in futuro
5. **Leggibilità**: File più piccoli e facili da capire

## Pattern di Implementazione

Ogni file esporterà una funzione `setupAdminRoutes(app)` che:
- Registra sia le route legacy (`/api/admin/*`) che quelle tenant-scoped (`/t/:tenantSlug/api/admin/*`)
- Usa i middleware appropriati (`requireAdmin`, `tenantLoader`, `requireSameTenantAsSession`, `requireRole`)
- Condivide la logica tra route legacy e tenant-scoped quando possibile

## Esempio struttura file:

```javascript
// routes/admin/campaigns.js
function setupCampaignsRoutes(app) {
    // Helper per ottenere tenantId (gestisce sia legacy che tenant-scoped)
    async function getTenantId(req) {
        return req.tenant?.id || await getTenantIdForApi(req);
    }
    
    // Route legacy
    app.get('/api/admin/campaigns', requireAdmin, async (req, res) => {
        // ... logica
    });
    
    // Route tenant-scoped
    app.get('/t/:tenantSlug/api/admin/campaigns', tenantLoader, requireSameTenantAsSession, requireRole('admin'), async (req, res) => {
        // ... logica simile
    });
    
    // ... altri endpoint
}

module.exports = { setupCampaignsRoutes };
```

## File principale (index.js):

```javascript
// routes/admin/index.js
const { setupCampaignsRoutes } = require('./campaigns');
const { setupUsersRoutes } = require('./users');
// ... altri import

function setupAdminRoutes(app) {
    setupCampaignsRoutes(app);
    setupUsersRoutes(app);
    setupCouponsRoutes(app);
    setupAnalyticsRoutes(app);
    setupSettingsRoutes(app);
    setupProductsRoutes(app);
    setupAuthUsersRoutes(app);
}

module.exports = { setupAdminRoutes };
```

## Ordine di Implementazione Consigliato:

1. **campaigns.js** (più complesso, ma core functionality)
2. **users.js** (relativamente semplice)
3. **coupons.js** (semplice, dipende da campaigns)
4. **analytics.js** (complesso, dipende da campaigns/coupons)
5. **settings.js** (medio, configurazioni)
6. **products.js** (semplice)
7. **auth-users.js** (medio, gestione utenti autenticati)

Ogni step sarà testato prima di procedere al successivo.


