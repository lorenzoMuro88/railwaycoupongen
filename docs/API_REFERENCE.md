# API Reference FLYCouponGen

## Panoramica

FLYCouponGen espone API REST per gestione coupon, campagne, utenti e analytics. Tutti gli endpoint admin supportano due varianti:
- **Legacy**: `/api/admin/*` - Usa tenant da sessione/referer
- **Tenant-scoped**: `/t/:tenantSlug/api/admin/*` - Usa tenant da URL path

## Autenticazione

### POST /api/login
Login admin o store.

**Request Body:**
```json
{
  "username": "admin",
  "password": "password",
  "userType": "admin" // o "store"
}
```

**Response:**
- `200` - Login riuscito, redirect a tenant admin/store
- `401` - Credenziali non valide
- `429` - Troppi tentativi, account bloccato temporaneamente

### POST /api/logout
Logout e invalidazione sessione.

**Response:**
- `200` - Logout riuscito

### POST /api/signup
Crea nuovo tenant e primo admin.

**Request Body:**
```json
{
  "tenantSlug": "mario",
  "tenantName": "Mario's Store",
  "username": "admin",
  "password": "password",
  "email": "admin@example.com"
}
```

**Response:**
- `200` - Tenant creato con successo
- `400` - Dati non validi o tenant già esistente

## Admin API - Campagne

### GET /api/admin/campaigns
Lista tutte le campagne del tenant.

**Query Parameters:**
- Nessuno

**Response:**
```json
[
  {
    "id": 1,
    "campaign_code": "ABC123",
    "name": "Sconto 20%",
    "description": "Promozione estiva",
    "discount_type": "percent",
    "discount_value": "20",
    "is_active": 1,
    "expiry_date": "2024-12-31",
    "created_at": "2024-01-01T00:00:00.000Z"
  }
]
```

### POST /api/admin/campaigns
Crea nuova campagna.

**Request Body:**
```json
{
  "name": "Sconto 20%",
  "description": "Promozione estiva",
  "discount_type": "percent", // "percent", "fixed", o "text"
  "discount_value": "20",
  "expiry_date": "2024-12-31" // opzionale
}
```

**Response:**
```json
{
  "id": 1,
  "campaign_code": "ABC123",
  "name": "Sconto 20%",
  "description": "Promozione estiva",
  "discount_type": "percent",
  "discount_value": "20"
}
```

### PUT /api/admin/campaigns/:id
Aggiorna campagna esistente.

**Request Body:** (stesso formato di POST)

**Response:**
```json
{
  "success": true
}
```

### DELETE /api/admin/campaigns/:id
Elimina campagna.

**Response:**
```json
{
  "success": true
}
```

### PUT /api/admin/campaigns/:id/activate
Attiva campagna.

**Response:**
```json
{
  "success": true
}
```

### PUT /api/admin/campaigns/:id/deactivate
Disattiva campagna.

**Response:**
```json
{
  "success": true
}
```

### GET /api/admin/campaigns/:id/form-config
Ottiene configurazione form della campagna.

**Response:**
```json
{
  "email": { "visible": true, "required": true },
  "firstName": { "visible": true, "required": true },
  "lastName": { "visible": true, "required": true },
  "phone": { "visible": false, "required": false },
  "customFields": []
}
```

### PUT /api/admin/campaigns/:id/form-config
Aggiorna configurazione form della campagna.

**Request Body:** (stesso formato di GET)

**Response:**
```json
{
  "success": true
}
```

### GET /api/admin/campaigns/:id/custom-fields
Ottiene custom fields della campagna.

**Response:**
```json
[
  {
    "name": "allergies",
    "label": "Allergie",
    "type": "text",
    "required": false
  }
]
```

### PUT /api/admin/campaigns/:id/custom-fields
Aggiorna custom fields della campagna.

**Request Body:** (array di custom fields)

**Response:**
```json
{
  "success": true
}
```

### GET /api/admin/campaigns/:id/products
Lista prodotti associati alla campagna.

**Response:**
```json
[
  {
    "id": 1,
    "name": "Prodotto A",
    "value": 100,
    "margin_price": 30
  }
]
```

### POST /api/admin/campaigns/:id/products
Associa prodotto alla campagna.

**Request Body:**
```json
{
  "productId": 1
}
```

**Response:**
```json
{
  "success": true
}
```

## Admin API - Utenti

### GET /api/admin/users
Lista utenti con filtri.

**Query Parameters:**
- `search` - Ricerca per cognome (opzionale)
- `campaigns` - Filtra per nomi campagne, comma-separated (opzionale)

**Response:**
```json
[
  {
    "id": 1,
    "email": "user@example.com",
    "first_name": "Mario",
    "last_name": "Rossi",
    "campaigns": "Campagna A, Campagna B",
    "total_coupons": 5,
    "first_coupon_date": "2024-01-01T00:00:00.000Z",
    "last_coupon_date": "2024-12-01T00:00:00.000Z",
    "customFields": {
      "phone": "123456789",
      "allergies": "Nessuna"
    }
  }
]
```

**Ottimizzazioni:**
- ✅ Custom fields recuperati in query unica (N+1 risolto)

### GET /api/admin/users/export.csv
Export utenti in formato CSV.

**Response:**
- `200` - File CSV con header BOM per Excel
- Content-Type: `text/csv; charset=utf-8`
- Content-Disposition: `attachment; filename="utenti-{timestamp}.csv"`

### GET /api/admin/users/:id
Dettaglio singolo utente.

**Response:**
```json
{
  "id": 1,
  "email": "user@example.com",
  "first_name": "Mario",
  "last_name": "Rossi",
  "created_at": "2024-01-01T00:00:00.000Z",
  "customFields": {
    "phone": "123456789"
  }
}
```

### PUT /api/admin/users/:id
Aggiorna utente.

**Request Body:**
```json
{
  "email": "newemail@example.com",
  "first_name": "Mario",
  "last_name": "Rossi",
  "customFields": {
    "phone": "123456789"
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Utente aggiornato con successo"
}
```

### DELETE /api/admin/users/:id
Elimina utente (solo se non ha coupon attivi).

**Response:**
```json
{
  "success": true,
  "message": "Utente eliminato con successo"
}
```

**Errori:**
- `400` - Utente ha coupon attivi

### GET /api/admin/users/:id/coupons
Lista coupon dell'utente.

**Response:**
```json
[
  {
    "id": 1,
    "code": "COUPON123",
    "status": "active",
    "discount_type": "percent",
    "discount_value": "20",
    "issued_at": "2024-01-01T00:00:00.000Z",
    "campaign_name": "Sconto 20%"
  }
]
```

## Admin API - Coupon

### GET /api/admin/coupons/search
Ricerca coupon per codice o cognome.

**Query Parameters:**
- `q` - Termine di ricerca (minimo 2 caratteri)

**Response:**
```json
[
  {
    "id": 1,
    "code": "COUPON123",
    "discountType": "percent",
    "discountValue": "20",
    "status": "active",
    "issuedAt": "2024-01-01T00:00:00.000Z",
    "firstName": "Mario",
    "lastName": "Rossi",
    "email": "user@example.com",
    "campaignName": "Sconto 20%"
  }
]
```

### GET /api/admin/coupons
Lista coupon con filtri e paginazione.

**Query Parameters:**
- `status` - Filtra per status: "active" o "redeemed" (default: "active")
- `limit` - Numero risultati (default: 50, max: 500)
- `offset` - Offset paginazione (default: 0)
- `order` - Ordinamento: "asc" o "desc" (default: "desc")

**Response:**
```json
[
  {
    "id": 1,
    "code": "COUPON123",
    "status": "active",
    "discount_type": "percent",
    "discount_value": "20",
    "issued_at": "2024-01-01T00:00:00.000Z"
  }
]
```

### DELETE /api/admin/coupons/:id
Elimina coupon.

**Response:**
```json
{
  "success": true
}
```

## Admin API - Analytics

### GET /api/admin/analytics/summary
Statistiche generali.

**Query Parameters:**
- `start` - Data inizio (YYYY-MM-DD, opzionale)
- `end` - Data fine (YYYY-MM-DD, opzionale)
- `campaignId` - Filtra per campagna (opzionale)
- `status` - Filtra per status: "active" o "redeemed" (opzionale)

**Response:**
```json
{
  "totalCampaigns": 10,
  "totalCouponsIssued": 1000,
  "totalCouponsRedeemed": 500,
  "redemptionRate": 0.5,
  "estimatedDiscountIssued": 10000,
  "estimatedDiscountRedeemed": 5000,
  "estimatedGrossMarginOnRedeemed": 15000,
  "estimatedNetMarginAfterDiscount": 10000
}
```

**Ottimizzazioni:**
- ✅ Medie campagne pre-calcolate (correlated subqueries eliminate)

### GET /api/admin/analytics/campaigns
Statistiche per campagna.

**Query Parameters:** (stessi di summary)

**Response:**
```json
[
  {
    "id": 1,
    "name": "Sconto 20%",
    "issued": 100,
    "redeemed": 50,
    "redemptionRate": 0.5,
    "estDiscountIssued": 2000,
    "estDiscountRedeemed": 1000,
    "estGrossMarginRedeemed": 3000,
    "estNetMarginAfterDiscount": 2000
  }
]
```

### GET /api/admin/analytics/temporal
Statistiche temporali aggregate.

**Query Parameters:**
- `start` - Data inizio (YYYY-MM-DD, opzionale)
- `end` - Data fine (YYYY-MM-DD, opzionale)
- `campaignId` - Filtra per campagna (opzionale)
- `status` - Filtra per status: "active" o "redeemed" (opzionale)
- `groupBy` - Aggregazione: "day" o "week" (default: "day")

**Response:**
```json
[
  {
    "period": "2024-01-01",
    "issued": 10,
    "redeemed": 5,
    "discount_applied": 100,
    "gross_margin": 300
  }
]
```

**Ottimizzazioni:**
- ✅ Medie campagne pre-calcolate (correlated subqueries eliminate)

### GET /api/admin/analytics/export
Export analytics in CSV o JSON.

**Query Parameters:**
- `start` - Data inizio (YYYY-MM-DD, opzionale)
- `end` - Data fine (YYYY-MM-DD, opzionale)
- `campaignId` - Filtra per campagna (opzionale)
- `status` - Filtra per status: "active" o "redeemed" (opzionale)
- `format` - Formato: "csv" o "json" (default: "csv")

**Response CSV:**
- Content-Type: `text/csv`
- Content-Disposition: `attachment; filename="analytics-export.csv"`

**Response JSON:**
```json
[
  {
    "code": "COUPON123",
    "status": "active",
    "issued_at": "2024-01-01T00:00:00.000Z",
    "campaign_name": "Sconto 20%",
    "first_name": "Mario",
    "last_name": "Rossi",
    "email": "user@example.com",
    "discount_type": "percent",
    "discount_value": "20",
    "avg_product_value": 100,
    "avg_margin": 30
  }
]
```

**Ottimizzazioni:**
- ✅ Medie campagne pre-calcolate (correlated subqueries eliminate)

## Admin API - Prodotti

### GET /api/admin/products
Lista prodotti del tenant.

**Response:**
```json
[
  {
    "id": 1,
    "name": "Prodotto A",
    "value": 100,
    "margin_price": 30,
    "sku": "PROD-001",
    "created_at": "2024-01-01T00:00:00.000Z"
  }
]
```

### POST /api/admin/products
Crea nuovo prodotto.

**Request Body:**
```json
{
  "name": "Prodotto A",
  "value": 100,
  "margin_price": 30,
  "sku": "PROD-001" // opzionale, deve essere unico per tenant
}
```

**Response:**
```json
{
  "id": 1,
  "success": true
}
```

**Errori:**
- `400` - SKU già esistente per questo tenant

### PUT /api/admin/products/:id
Aggiorna prodotto.

**Request Body:** (stesso formato di POST)

**Response:**
```json
{
  "success": true
}
```

### DELETE /api/admin/products/:id
Elimina prodotto.

**Response:**
```json
{
  "success": true
}
```

## Admin API - Settings

### GET /api/admin/test-email
Test invio email.

**Query Parameters:**
- `to` - Indirizzo email destinatario (default: da env o "test@example.com")

**Response:**
```json
{
  "ok": true,
  "info": { /* Mailgun response */ }
}
```

### GET /api/admin/email-from-name
Ottiene nome mittente email del tenant.

**Response:**
```json
{
  "emailFromName": "Mario's Store"
}
```

### PUT /api/admin/email-from-name
Aggiorna nome mittente email del tenant.

**Request Body:**
```json
{
  "emailFromName": "Mario's Store"
}
```

**Response:**
```json
{
  "ok": true,
  "emailFromName": "Mario's Store"
}
```

### GET /api/admin/email-template
Ottiene template email del tenant.

**Response:**
```json
{
  "subject": "Il tuo coupon",
  "html": "<p>Ecco il tuo coupon...</p>",
  "updated_at": "2024-01-01T00:00:00.000Z"
}
```

### POST /api/admin/email-template
Aggiorna template email del tenant.

**Request Body:**
```json
{
  "subject": "Il tuo coupon",
  "html": "<p>Ecco il tuo coupon...</p>"
}
```

**Response:**
```json
{
  "success": true
}
```

### POST /api/admin/upload-image
Upload immagine (header form).

**Request Body:**
```json
{
  "dataUrl": "data:image/png;base64,iVBORw0KGgo..."
}
```

**Response:**
```json
{
  "url": "/api/uploads/{tenantSlug}/header-1234567890-abc123.png"
}
```

**Validazioni:**
- MIME types consentiti: `image/png`, `image/jpeg`, `image/jpg`, `image/webp`
- Size limit: 2MB (configurabile via `UPLOAD_MAX_BYTES`)

### GET /api/admin/brand-settings
Ottiene brand settings del tenant (colori, logo).

**Response:**
```json
{
  "primary_color": "#007bff",
  "accent_color": "#28a745",
  "light_color": "#f8f9fa",
  "header_image_url": "/api/uploads/{tenantSlug}/header.png"
}
```

## Admin API - Auth Users

### GET /api/admin/auth-users
Lista auth-users (admin/store).

**Comportamento:**
- Superadmin senza tenant context: vede tutti gli auth-users
- Admin o superadmin con tenant context: vede solo auth-users del tenant

**Response:**
```json
[
  {
    "id": 1,
    "username": "admin",
    "userType": "admin",
    "isActive": 1,
    "lastLogin": "2024-01-01T00:00:00.000Z",
    "tenantId": 1 // solo per superadmin senza tenant context
  }
]
```

### POST /api/admin/auth-users
Crea nuovo auth-user.

**Request Body:**
```json
{
  "username": "newadmin",
  "password": "password",
  "user_type": "admin", // o "store"
  "tenant_id": 1 // opzionale, solo per superadmin
}
```

**Sicurezza:**
- Solo superadmin può creare utenti con ruolo "admin"
- Tenant ID obbligatorio per admin regolari

**Response:**
```json
{
  "id": 1,
  "username": "newadmin",
  "userType": "admin",
  "isActive": 1
}
```

### PUT /api/admin/auth-users/:id
Aggiorna auth-user.

**Request Body:**
```json
{
  "username": "newadmin", // opzionale
  "password": "newpassword", // opzionale
  "user_type": "store", // opzionale
  "is_active": 1 // opzionale
}
```

**Sicurezza:**
- Solo superadmin può modificare utenti admin
- Protezione contro auto-disattivazione

**Response:**
```json
{
  "ok": true
}
```

### DELETE /api/admin/auth-users/:id
Elimina auth-user.

**Sicurezza:**
- Solo superadmin può eliminare utenti admin
- Protezione contro auto-eliminazione

**Response:**
```json
{
  "ok": true
}
```

## Errori Standard

Tutti gli endpoint restituiscono errori in formato JSON:

```json
{
  "error": "Messaggio di errore"
}
```

**Codici HTTP:**
- `200` - Successo
- `400` - Bad Request (dati non validi)
- `401` - Unauthorized (non autenticato)
- `403` - Forbidden (non autorizzato)
- `404` - Not Found (risorsa non trovata)
- `409` - Conflict (risorsa già esistente)
- `429` - Too Many Requests (rate limit)
- `500` - Internal Server Error
- `503` - Service Unavailable (database locked)

## Rate Limiting

- **Login**: Lockout progressivo dopo tentativi falliti
- **Form Submission**: Limite per IP e email (configurabile via env)

## CSRF Protection

Tutti gli endpoint mutanti (POST, PUT, DELETE) richiedono token CSRF:
1. Ottieni token: `GET /api/csrf-token`
2. Includi token in header: `X-CSRF-Token: {token}` o campo form: `_csrf: {token}`

Route pubbliche (es. `/submit`) non richiedono CSRF.

