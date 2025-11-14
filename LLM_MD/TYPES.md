# Type Definitions - FLYCouponGen

Questo documento contiene tutte le definizioni JSDoc dei tipi utilizzati nel progetto FLYCouponGen. Questi tipi possono essere referenziati nei commenti JSDoc usando `@typedef` o `@type`.

## Indice

- [Tenant](#tenant)
- [SessionUser](#sessionuser)
- [Campaign](#campaign)
- [Coupon](#coupon)
- [User](#user)
- [Product](#product)
- [FormLink](#formlink)
- [AuthUser](#authuser)
- [ExpressRequest](#expressrequest)
- [FormConfig](#formconfig)
- [EmailTemplate](#emailtemplate)
- [BrandSettings](#brandsettings)

---

## Tenant

Rappresenta un tenant (organizzazione/cliente) nel sistema multi-tenant.

```javascript
/**
 * @typedef {Object} Tenant
 * @property {number} id - ID univoco del tenant (PRIMARY KEY)
 * @property {string} slug - Slug univoco del tenant (usato negli URL, es. "mario-store")
 * @property {string} [name] - Nome visualizzato del tenant
 * @property {string} [custom_domain] - Dominio personalizzato del tenant (opzionale)
 * @property {string} [email_from_name] - Nome mittente email personalizzato (default: "CouponGen")
 * @property {string} [email_from_address] - Indirizzo email mittente personalizzato (opzionale)
 * @property {string} [mailgun_domain] - Dominio Mailgun personalizzato per il tenant (opzionale)
 * @property {string} [mailgun_region] - Regione Mailgun ("us" o "eu", default: "eu")
 * @property {string} created_at - Data di creazione (ISO datetime string)
 */
```

**Esempio:**
```javascript
const tenant = {
    id: 1,
    slug: "mario-store",
    name: "Mario's Store",
    email_from_name: "Mario's Store",
    email_from_address: "noreply@mariostore.com",
    mailgun_domain: "mg.mariostore.com",
    mailgun_region: "eu",
    created_at: "2024-01-01T00:00:00.000Z"
};
```

---

## SessionUser

Rappresenta l'utente autenticato nella sessione Express.

```javascript
/**
 * @typedef {Object} SessionUser
 * @property {number} id - ID dell'utente autenticato (da auth_users.id)
 * @property {string} username - Username dell'utente
 * @property {string} userType - Tipo utente: "admin", "store", o "superadmin"
 * @property {number} [tenantId] - ID del tenant associato (null per superadmin senza tenant context)
 * @property {string} [tenantSlug] - Slug del tenant associato
 * @property {boolean} [isSuperAdmin] - true se è superadmin (basato su SUPERADMIN_USERNAME env)
 */
```

**Esempio:**
```javascript
req.session.user = {
    id: 1,
    username: "admin",
    userType: "admin",
    tenantId: 1,
    tenantSlug: "mario-store",
    isSuperAdmin: false
};
```

---

## Campaign

Rappresenta una campagna promozionale.

```javascript
/**
 * @typedef {Object} Campaign
 * @property {number} id - ID univoco della campagna (PRIMARY KEY)
 * @property {string} campaign_code - Codice univoco della campagna (generato automaticamente, 12 caratteri)
 * @property {string} name - Nome della campagna
 * @property {string} [description] - Descrizione della campagna (opzionale)
 * @property {boolean} is_active - Stato attivazione (0 = disattiva, 1 = attiva)
 * @property {string} discount_type - Tipo sconto: "percent", "fixed", o "text"
 * @property {string} discount_value - Valore sconto (numero per percent/fixed, testo per text)
 * @property {string} form_config - Configurazione form in formato JSON string
 * @property {string} [expiry_date] - Data di scadenza (ISO datetime string, opzionale)
 * @property {string} created_at - Data di creazione (ISO datetime string)
 * @property {number} tenant_id - ID del tenant proprietario
 */
```

**Esempio:**
```javascript
const campaign = {
    id: 1,
    campaign_code: "ABC123XYZ456",
    name: "Sconto 20%",
    description: "Promozione estiva",
    is_active: 1,
    discount_type: "percent",
    discount_value: "20",
    form_config: '{"email": {"visible": true, "required": true}, ...}',
    expiry_date: "2024-12-31T23:59:59.000Z",
    created_at: "2024-01-01T00:00:00.000Z",
    tenant_id: 1
};
```

---

## Coupon

Rappresenta un coupon generato per un utente.

```javascript
/**
 * @typedef {Object} Coupon
 * @property {number} id - ID univoco del coupon (PRIMARY KEY)
 * @property {string} code - Codice univoco del coupon (usato per riscatto)
 * @property {number} user_id - ID dell'utente proprietario (FK a users.id)
 * @property {number} [campaign_id] - ID della campagna associata (FK a campaigns.id, opzionale)
 * @property {string} discount_type - Tipo sconto: "percent", "fixed", o "text"
 * @property {string} discount_value - Valore sconto
 * @property {string} status - Stato: "active", "redeemed", o "expired"
 * @property {string} issued_at - Data di emissione (ISO datetime string)
 * @property {string} [redeemed_at] - Data di riscatto (ISO datetime string, null se non riscattato)
 * @property {number} tenant_id - ID del tenant proprietario
 */
```

**Esempio:**
```javascript
const coupon = {
    id: 1,
    code: "COUPON123456",
    user_id: 1,
    campaign_id: 1,
    discount_type: "percent",
    discount_value: "20",
    status: "active",
    issued_at: "2024-01-01T00:00:00.000Z",
    redeemed_at: null,
    tenant_id: 1
};
```

---

## User

Rappresenta un utente finale (cliente) che ha ricevuto coupon.

```javascript
/**
 * @typedef {Object} User
 * @property {number} id - ID univoco dell'utente (PRIMARY KEY)
 * @property {string} email - Email dell'utente (univoca per tenant)
 * @property {string} [first_name] - Nome dell'utente
 * @property {string} [last_name] - Cognome dell'utente
 * @property {string} created_at - Data di creazione (ISO datetime string)
 * @property {number} tenant_id - ID del tenant proprietario
 * @property {Object.<string, string>} [customFields] - Campi personalizzati (chiave-valore)
 */
```

**Esempio:**
```javascript
const user = {
    id: 1,
    email: "mario.rossi@example.com",
    first_name: "Mario",
    last_name: "Rossi",
    created_at: "2024-01-01T00:00:00.000Z",
    tenant_id: 1,
    customFields: {
        phone: "123456789",
        allergies: "Nessuna"
    }
};
```

---

## Product

Rappresenta un prodotto associato alle campagne per calcolo analytics.

```javascript
/**
 * @typedef {Object} Product
 * @property {number} id - ID univoco del prodotto (PRIMARY KEY)
 * @property {string} name - Nome del prodotto
 * @property {number} value - Valore/prezzo del prodotto
 * @property {number} margin_price - Margine/prezzo di costo del prodotto
 * @property {string} [sku] - SKU univoco del prodotto (per tenant)
 * @property {string} created_at - Data di creazione (ISO datetime string)
 * @property {string} [updated_at] - Data di ultimo aggiornamento (ISO datetime string)
 * @property {number} tenant_id - ID del tenant proprietario
 */
```

**Esempio:**
```javascript
const product = {
    id: 1,
    name: "Prodotto A",
    value: 100,
    margin_price: 30,
    sku: "PROD-001",
    created_at: "2024-01-01T00:00:00.000Z",
    updated_at: "2024-01-02T00:00:00.000Z",
    tenant_id: 1
};
```

---

## FormLink

Rappresenta un link parametrico per form campagne.

```javascript
/**
 * @typedef {Object} FormLink
 * @property {number} id - ID univoco del link (PRIMARY KEY)
 * @property {number} campaign_id - ID della campagna associata (FK a campaigns.id)
 * @property {string} token - Token univoco del link (usato nell'URL)
 * @property {string} [used_at] - Data di utilizzo (ISO datetime string, null se non usato)
 * @property {number} [coupon_id] - ID del coupon generato (FK a coupons.id, null se non usato)
 * @property {string} created_at - Data di creazione (ISO datetime string)
 * @property {number} tenant_id - ID del tenant proprietario
 */
```

**Esempio:**
```javascript
const formLink = {
    id: 1,
    campaign_id: 1,
    token: "ABC123XYZ456DEF789",
    used_at: null,
    coupon_id: null,
    created_at: "2024-01-01T00:00:00.000Z",
    tenant_id: 1
};
```

---

## AuthUser

Rappresenta un utente autenticato (admin/store) del sistema.

```javascript
/**
 * @typedef {Object} AuthUser
 * @property {number} id - ID univoco dell'utente autenticato (PRIMARY KEY)
 * @property {string} username - Username univoco
 * @property {string} password_hash - Hash della password (bcrypt o legacy Base64)
 * @property {string} user_type - Tipo utente: "superadmin", "admin", o "store"
 * @property {boolean} is_active - Stato attivazione (0 = disattivo, 1 = attivo)
 * @property {string} created_at - Data di creazione (ISO datetime string)
 * @property {string} [last_login] - Data ultimo login (ISO datetime string, opzionale)
 * @property {number} [tenant_id] - ID del tenant associato (null per superadmin globale)
 * @property {string} [first_name] - Nome (opzionale)
 * @property {string} [last_name] - Cognome (opzionale)
 * @property {string} [email] - Email (opzionale)
 */
```

**Esempio:**
```javascript
const authUser = {
    id: 1,
    username: "admin",
    password_hash: "$2b$10$...",
    user_type: "admin",
    is_active: 1,
    created_at: "2024-01-01T00:00:00.000Z",
    last_login: "2024-01-15T10:30:00.000Z",
    tenant_id: 1,
    first_name: "Mario",
    last_name: "Rossi",
    email: "admin@example.com"
};
```

---

## ExpressRequest

Estensione dell'oggetto Express Request con proprietà custom del progetto.

```javascript
/**
 * @typedef {Object} ExpressRequest
 * @property {string} requestId - ID univoco della richiesta (generato automaticamente)
 * @property {Tenant} [tenant] - Oggetto tenant caricato da tenantLoader middleware (solo per route tenant-scoped)
 * @property {string} [tenantSlug] - Slug del tenant (impostato da tenantLoader)
 * @property {Object} session - Sessione Express
 * @property {SessionUser} [session.user] - Utente autenticato nella sessione
 * @property {Object} body - Request body (parsed JSON/form)
 * @property {Object} query - Query parameters
 * @property {Object} params - URL parameters
 * @property {string} ip - IP address del client
 * @property {string} method - HTTP method
 * @property {string} path - Request path
 * @property {string} originalUrl - Original request URL
 */
```

**Note:**
- `req.tenant` è disponibile solo dopo che `tenantLoader` middleware è stato eseguito (route tenant-scoped)
- `req.session.user` è disponibile solo dopo autenticazione
- `req.requestId` è generato automaticamente per ogni richiesta

---

## FormConfig

Configurazione del form per una campagna.

```javascript
/**
 * @typedef {Object} FormConfig
 * @property {Object} email - Configurazione campo email
 * @property {boolean} email.visible - Campo visibile
 * @property {boolean} email.required - Campo obbligatorio
 * @property {Object} firstName - Configurazione campo nome
 * @property {boolean} firstName.visible - Campo visibile
 * @property {boolean} firstName.required - Campo obbligatorio
 * @property {Object} lastName - Configurazione campo cognome
 * @property {boolean} lastName.visible - Campo visibile
 * @property {boolean} lastName.required - Campo obbligatorio
 * @property {Object} phone - Configurazione campo telefono
 * @property {boolean} phone.visible - Campo visibile
 * @property {boolean} phone.required - Campo obbligatorio
 * @property {Object} address - Configurazione campo indirizzo
 * @property {boolean} address.visible - Campo visibile
 * @property {boolean} address.required - Campo obbligatorio
 * @property {Object} allergies - Configurazione campo allergie
 * @property {boolean} allergies.visible - Campo visibile
 * @property {boolean} allergies.required - Campo obbligatorio
 * @property {Array.<CustomField>} customFields - Array di campi personalizzati (max 5)
 */
```

**CustomField:**
```javascript
/**
 * @typedef {Object} CustomField
 * @property {string} name - Nome tecnico del campo (chiave)
 * @property {string} label - Etichetta visualizzata
 * @property {string} type - Tipo campo: "text", "email", "tel", "number", "textarea"
 * @property {boolean} required - Campo obbligatorio
 */
```

**Esempio:**
```javascript
const formConfig = {
    email: { visible: true, required: true },
    firstName: { visible: true, required: true },
    lastName: { visible: true, required: true },
    phone: { visible: false, required: false },
    address: { visible: false, required: false },
    allergies: { visible: false, required: false },
    customFields: [
        {
            name: "preferences",
            label: "Preferenze",
            type: "textarea",
            required: false
        }
    ]
};
```

---

## EmailTemplate

Template email per invio coupon.

```javascript
/**
 * @typedef {Object} EmailTemplate
 * @property {string} subject - Oggetto email
 * @property {string} html - Corpo email in HTML
 * @property {string} [updated_at] - Data ultimo aggiornamento (ISO datetime string)
 * @property {number} tenant_id - ID del tenant proprietario
 */
```

**Esempio:**
```javascript
const emailTemplate = {
    subject: "Il tuo coupon",
    html: "<h1>Ecco il tuo coupon!</h1><p>Codice: {{code}}</p>",
    updated_at: "2024-01-01T00:00:00.000Z",
    tenant_id: 1
};
```

---

## BrandSettings

Impostazioni brand personalizzate per tenant.

```javascript
/**
 * @typedef {Object} BrandSettings
 * @property {string} [primary_color] - Colore primario (hex, es. "#007bff")
 * @property {string} [accent_color] - Colore accento (hex, es. "#28a745")
 * @property {string} [light_color] - Colore chiaro (hex, es. "#f8f9fa")
 * @property {string} [header_image_url] - URL immagine header form
 * @property {number} tenant_id - ID del tenant proprietario
 */
```

**Esempio:**
```javascript
const brandSettings = {
    primary_color: "#007bff",
    accent_color: "#28a745",
    light_color: "#f8f9fa",
    header_image_url: "/api/uploads/mario-store/header.png",
    tenant_id: 1
};
```

---

## Utilizzo nei Commenti JSDoc

Per utilizzare questi tipi nei commenti JSDoc, referenziali così:

```javascript
/**
 * @param {Tenant} tenant - Oggetto tenant
 * @param {SessionUser} user - Utente autenticato
 * @returns {Campaign} Campagna creata
 */
function createCampaign(tenant, user) {
    // ...
}
```

Oppure per proprietà di oggetti:

```javascript
/**
 * @param {ExpressRequest} req - Request Express con tenant e session
 */
function handler(req) {
    const tenantId = req.tenant.id; // TypeScript/IDE riconosce req.tenant come Tenant
    const userId = req.session.user.id; // TypeScript/IDE riconosce req.session.user come SessionUser
}
```

---

## Note Importanti

1. **Tenant Isolation**: Tutti gli oggetti principali (Campaign, Coupon, User, Product) hanno `tenant_id` per garantire isolamento multi-tenant
2. **Date**: Le date sono memorizzate come stringhe ISO datetime nel database SQLite
3. **Booleani**: SQLite non ha tipo BOOLEAN nativo, quindi vengono usati INTEGER (0 = false, 1 = true)
4. **JSON Fields**: Alcuni campi (come `form_config`) sono memorizzati come JSON string nel database
5. **Nullable Fields**: I campi opzionali sono marcati con `[property]` nella JSDoc e possono essere `null` o `undefined`

