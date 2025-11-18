# Database Schema - FLYCouponGen

Documentazione completa dello schema database SQLite utilizzato da FLYCouponGen.

## Panoramica

Il database utilizza SQLite con supporto multi-tenant. Tutte le tabelle principali (eccetto `tenants` e `auth_users`) includono `tenant_id` per garantire isolamento dei dati tra tenant.

## Tabelle Principali

### tenants

Tabella principale per i tenant (organizzazioni/clienti).

| Colonna | Tipo | Nullable | Default | Descrizione |
|---------|------|----------|---------|-------------|
| id | INTEGER | NO | AUTOINCREMENT | Primary key |
| slug | TEXT | NO | - | Slug univoco (usato negli URL) |
| name | TEXT | YES | NULL | Nome visualizzato |
| email_from_name | TEXT | YES | 'CouponGen' | Nome mittente email personalizzato |
| email_from_address | TEXT | YES | NULL | Indirizzo email mittente personalizzato |
| custom_domain | TEXT | YES | NULL | Dominio personalizzato |
| mailgun_domain | TEXT | YES | NULL | Dominio Mailgun personalizzato |
| mailgun_region | TEXT | YES | NULL | Regione Mailgun ("us" o "eu") |
| created_at | DATETIME | YES | CURRENT_TIMESTAMP | Data creazione |

**Indici:**
- `UNIQUE(slug)` - Slug deve essere univoco

**Relazioni:**
- Nessuna foreign key (tabella root)

**Esempio Query:**
```sql
SELECT * FROM tenants WHERE slug = 'mario-store';
```

---

### users

Utenti finali (clienti) che hanno ricevuto coupon.

| Colonna | Tipo | Nullable | Default | Descrizione |
|---------|------|----------|---------|-------------|
| id | INTEGER | NO | AUTOINCREMENT | Primary key |
| email | TEXT | NO | - | Email utente (univoca per tenant) |
| first_name | TEXT | YES | NULL | Nome |
| last_name | TEXT | YES | NULL | Cognome |
| created_at | DATETIME | YES | CURRENT_TIMESTAMP | Data creazione |
| tenant_id | INTEGER | YES | NULL | Foreign key a tenants.id |

**Indici:**
- `ux_users_tenant_email` - Unique constraint su (tenant_id, email)

**Relazioni:**
- `tenant_id` → `tenants.id` (implicita, no FK per flessibilità)

**Esempio Query:**
```sql
SELECT * FROM users WHERE tenant_id = 1 AND email = 'user@example.com';
```

---

### campaigns

Campagne promozionali.

| Colonna | Tipo | Nullable | Default | Descrizione |
|---------|------|----------|---------|-------------|
| id | INTEGER | NO | AUTOINCREMENT | Primary key |
| campaign_code | TEXT | NO | - | Codice univoco campagna (12 caratteri) |
| name | TEXT | NO | - | Nome campagna |
| description | TEXT | YES | NULL | Descrizione |
| is_active | BOOLEAN | YES | 0 | Stato attivazione (0=disattiva, 1=attiva) |
| discount_type | TEXT | NO | 'percent' | Tipo sconto: "percent", "fixed", "text" |
| discount_value | TEXT | NO | - | Valore sconto |
| form_config | TEXT | YES | JSON default | Configurazione form (JSON string) |
| expiry_date | DATETIME | YES | NULL | Data scadenza |
| created_at | DATETIME | YES | CURRENT_TIMESTAMP | Data creazione |
| tenant_id | INTEGER | YES | NULL | Foreign key a tenants.id |

**Indici:**
- `idx_coupons_tenant_campaign_status` - Composito (tenant_id, campaign_id, status) per analytics
- `idx_coupons_tenant_issued_at` - Composito (tenant_id, issued_at) per ordinamenti temporali

**Relazioni:**
- `tenant_id` → `tenants.id` (implicita)

**Pattern Tenant Isolation:**
```sql
SELECT * FROM campaigns WHERE tenant_id = ? AND id = ?;
```

**Esempio Query:**
```sql
SELECT * FROM campaigns WHERE tenant_id = 1 AND is_active = 1 ORDER BY created_at DESC;
```

---

### coupons

Coupon generati per utenti.

| Colonna | Tipo | Nullable | Default | Descrizione |
|---------|------|----------|---------|-------------|
| id | INTEGER | NO | AUTOINCREMENT | Primary key |
| code | TEXT | NO | - | Codice coupon univoco |
| user_id | INTEGER | NO | - | Foreign key a users.id |
| campaign_id | INTEGER | YES | NULL | Foreign key a campaigns.id |
| discount_type | TEXT | NO | 'percent' | Tipo sconto |
| discount_value | TEXT | NO | - | Valore sconto |
| status | TEXT | NO | 'active' | Stato: "active", "redeemed", "expired" |
| issued_at | DATETIME | YES | CURRENT_TIMESTAMP | Data emissione |
| redeemed_at | DATETIME | YES | NULL | Data riscatto |
| tenant_id | INTEGER | YES | NULL | Foreign key a tenants.id |

**Indici:**
- `idx_coupons_code` - Su `code` per ricerche rapide
- `idx_coupons_tenant_campaign_status` - Composito (tenant_id, campaign_id, status)
- `idx_coupons_tenant_issued_at` - Composito (tenant_id, issued_at)

**Relazioni:**
- `user_id` → `users.id` (implicita)
- `campaign_id` → `campaigns.id` (implicita)
- `tenant_id` → `tenants.id` (implicita)

**Pattern Tenant Isolation:**
```sql
SELECT * FROM coupons WHERE tenant_id = ? AND code = ?;
```

**Esempio Query:**
```sql
SELECT c.*, u.email, u.first_name, u.last_name 
FROM coupons c
JOIN users u ON c.user_id = u.id
WHERE c.tenant_id = 1 AND c.status = 'active'
ORDER BY c.issued_at DESC;
```

---

### form_links

Link parametrici per form campagne.

| Colonna | Tipo | Nullable | Default | Descrizione |
|---------|------|----------|---------|-------------|
| id | INTEGER | NO | AUTOINCREMENT | Primary key |
| campaign_id | INTEGER | NO | - | Foreign key a campaigns.id |
| token | TEXT | NO | - | Token univoco (usato nell'URL) |
| used_at | DATETIME | YES | NULL | Data utilizzo |
| coupon_id | INTEGER | YES | NULL | Foreign key a coupons.id (se usato) |
| tenant_id | INTEGER | YES | NULL | Foreign key a tenants.id |
| created_at | DATETIME | YES | CURRENT_TIMESTAMP | Data creazione |

**Indici:**
- `idx_form_links_token` - Su `token` per ricerche rapide
- `idx_form_links_campaign_id` - Su `campaign_id`
- `idx_form_links_tenant_id` - Su `tenant_id`

**Relazioni:**
- `campaign_id` → `campaigns.id` (implicita)
- `coupon_id` → `coupons.id` (implicita)
- `tenant_id` → `tenants.id` (implicita)

**Esempio Query:**
```sql
SELECT * FROM form_links WHERE tenant_id = 1 AND campaign_id = 1 AND used_at IS NULL;
```

---

### user_custom_data

Campi personalizzati per utenti.

| Colonna | Tipo | Nullable | Default | Descrizione |
|---------|------|----------|---------|-------------|
| id | INTEGER | NO | AUTOINCREMENT | Primary key |
| user_id | INTEGER | NO | - | Foreign key a users.id |
| field_name | TEXT | NO | - | Nome campo (chiave) |
| field_value | TEXT | YES | NULL | Valore campo |
| created_at | DATETIME | YES | CURRENT_TIMESTAMP | Data creazione |
| tenant_id | INTEGER | YES | NULL | Foreign key a tenants.id |

**Indici:**
- `idx_user_custom_data_user_id` - Su `user_id`
- `idx_user_custom_data_field_name` - Su `field_name`

**Relazioni:**
- `user_id` → `users.id` ON DELETE CASCADE

**Pattern Query (N+1 risolto):**
```sql
-- Fetch all custom fields for multiple users in one query
SELECT user_id, field_name, field_value 
FROM user_custom_data 
WHERE user_id IN (?, ?, ?) AND tenant_id = ?;
```

---

### auth_users

Utenti autenticati del sistema (admin/store).

| Colonna | Tipo | Nullable | Default | Descrizione |
|---------|------|----------|---------|-------------|
| id | INTEGER | NO | AUTOINCREMENT | Primary key |
| username | TEXT | NO | - | Username univoco |
| password_hash | TEXT | NO | - | Hash password (bcrypt o legacy Base64) |
| user_type | TEXT | NO | - | Tipo: "superadmin", "admin", "store" |
| is_active | BOOLEAN | YES | 1 | Stato attivazione |
| created_at | DATETIME | YES | CURRENT_TIMESTAMP | Data creazione |
| last_login | DATETIME | YES | NULL | Data ultimo login |
| tenant_id | INTEGER | YES | NULL | Foreign key a tenants.id (null per superadmin globale) |
| first_name | TEXT | YES | NULL | Nome |
| last_name | TEXT | YES | NULL | Cognome |
| email | TEXT | YES | NULL | Email |

**Indici:**
- `UNIQUE(username)` - Username deve essere univoco

**Relazioni:**
- `tenant_id` → `tenants.id` (implicita)

**Esempio Query:**
```sql
SELECT * FROM auth_users WHERE username = ? AND user_type = ? AND is_active = 1;
```

---

### products

Prodotti associati alle campagne per calcolo analytics.

| Colonna | Tipo | Nullable | Default | Descrizione |
|---------|------|----------|---------|-------------|
| id | INTEGER | NO | AUTOINCREMENT | Primary key |
| name | TEXT | NO | - | Nome prodotto |
| value | REAL | NO | - | Valore/prezzo prodotto |
| margin_price | REAL | NO | - | Margine/prezzo di costo |
| sku | TEXT | YES | NULL | SKU univoco (per tenant) |
| created_at | DATETIME | YES | CURRENT_TIMESTAMP | Data creazione |
| updated_at | DATETIME | YES | CURRENT_TIMESTAMP | Data ultimo aggiornamento |
| tenant_id | INTEGER | YES | NULL | Foreign key a tenants.id |

**Indici:**
- Unique constraint su (tenant_id, sku) se sku non null

**Relazioni:**
- `tenant_id` → `tenants.id` (implicita)

**Esempio Query:**
```sql
SELECT * FROM products WHERE tenant_id = 1 ORDER BY name;
```

---

### campaign_products

Associazione molti-a-molti tra campagne e prodotti.

| Colonna | Tipo | Nullable | Default | Descrizione |
|---------|------|----------|---------|-------------|
| id | INTEGER | NO | AUTOINCREMENT | Primary key |
| campaign_id | INTEGER | NO | - | Foreign key a campaigns.id |
| product_id | INTEGER | NO | - | Foreign key a products.id |
| created_at | DATETIME | YES | CURRENT_TIMESTAMP | Data creazione |

**Indici:**
- `UNIQUE(campaign_id, product_id)` - Evita duplicati

**Relazioni:**
- `campaign_id` → `campaigns.id` ON DELETE CASCADE
- `product_id` → `products.id` ON DELETE CASCADE

**Esempio Query:**
```sql
SELECT p.* FROM products p
JOIN campaign_products cp ON p.id = cp.product_id
WHERE cp.campaign_id = ? AND p.tenant_id = ?;
```

---

### email_template

Template email per tenant.

| Colonna | Tipo | Nullable | Default | Descrizione |
|---------|------|----------|---------|-------------|
| id | INTEGER | NO | AUTOINCREMENT | Primary key |
| tenant_id | INTEGER | YES | NULL | Foreign key a tenants.id |
| subject | TEXT | NO | - | Oggetto email |
| html | TEXT | NO | - | Corpo email HTML |
| updated_at | DATETIME | YES | CURRENT_TIMESTAMP | Data ultimo aggiornamento |

**Relazioni:**
- `tenant_id` → `tenants.id` (implicita)

**Esempio Query:**
```sql
SELECT * FROM email_template WHERE tenant_id = 1;
```

---

### tenant_brand_settings

Impostazioni brand personalizzate per tenant.

| Colonna | Tipo | Nullable | Default | Descrizione |
|---------|------|----------|---------|-------------|
| id | INTEGER | NO | AUTOINCREMENT | Primary key |
| tenant_id | INTEGER | YES | NULL | Foreign key a tenants.id |
| primary_color | TEXT | YES | NULL | Colore primario (hex) |
| accent_color | TEXT | YES | NULL | Colore accento (hex) |
| light_color | TEXT | YES | NULL | Colore chiaro (hex) |
| header_image_url | TEXT | YES | NULL | URL immagine header |

**Relazioni:**
- `tenant_id` → `tenants.id` (implicita)

---

### form_customization

Configurazione form globale per tenant.

| Colonna | Tipo | Nullable | Default | Descrizione |
|---------|------|----------|---------|-------------|
| id | INTEGER | NO | AUTOINCREMENT | Primary key |
| tenant_id | INTEGER | YES | NULL | Foreign key a tenants.id |
| config_data | TEXT | NO | - | Configurazione form (JSON string) |
| updated_at | DATETIME | YES | CURRENT_TIMESTAMP | Data ultimo aggiornamento |

**Indici:**
- `idx_form_customization_tenant_id` - Su `tenant_id`

**Relazioni:**
- `tenant_id` → `tenants.id` (implicita)

---

### system_logs

Log delle azioni del sistema.

| Colonna | Tipo | Nullable | Default | Descrizione |
|---------|------|----------|---------|-------------|
| id | INTEGER | NO | AUTOINCREMENT | Primary key |
| timestamp | DATETIME | YES | CURRENT_TIMESTAMP | Data/ora evento |
| user_id | INTEGER | YES | NULL | Foreign key a auth_users.id |
| username | TEXT | YES | NULL | Username (denormalizzato) |
| user_type | TEXT | YES | NULL | Tipo utente |
| tenant_id | INTEGER | YES | NULL | Foreign key a tenants.id |
| tenant_name | TEXT | YES | NULL | Nome tenant (denormalizzato) |
| tenant_slug | TEXT | YES | NULL | Slug tenant (denormalizzato) |
| action_type | TEXT | NO | - | Tipo azione |
| action_description | TEXT | YES | NULL | Descrizione azione |
| level | TEXT | YES | 'info' | Livello log: "info", "warn", "error", "success" |
| details | TEXT | YES | NULL | Dettagli aggiuntivi (JSON string) |
| ip_address | TEXT | YES | NULL | IP address client |
| user_agent | TEXT | YES | NULL | User agent browser |

**Indici:**
- `idx_system_logs_timestamp` - Su `timestamp`
- `idx_system_logs_user_id` - Su `user_id`
- `idx_system_logs_tenant_id` - Su `tenant_id`
- `idx_system_logs_action_type` - Su `action_type`
- `idx_system_logs_level` - Su `level`

**Relazioni:**
- `user_id` → `auth_users.id` ON DELETE SET NULL
- `tenant_id` → `tenants.id` ON DELETE SET NULL

**Esempio Query:**
```sql
SELECT * FROM system_logs 
WHERE tenant_id = 1 
ORDER BY timestamp DESC 
LIMIT 100;
```

---

## Pattern Tenant Isolation

**Regola fondamentale:** Tutte le query su tabelle con `tenant_id` DEVONO includere un filtro `WHERE tenant_id = ?` per garantire l'isolamento dei dati tra tenant.

### Tabelle Tenant-Scoped (richiedono sempre tenant_id)

Le seguenti tabelle DEVONO sempre includere `tenant_id` nelle query:
- `users` - Utenti finali
- `campaigns` - Campagne promozionali
- `coupons` - Coupon generati
- `form_links` - Link parametrici form
- `user_custom_data` - Campi personalizzati utenti
- `products` - Prodotti
- `campaign_products` - Associazione campagne-prodotti
- `email_template` - Template email
- `form_customization` - Configurazione form
- `tenant_brand_settings` - Impostazioni brand

### Tabelle Globali (NON richiedono tenant_id)

Le seguenti tabelle sono globali e NON richiedono filtro tenant_id:
- `tenants` - Tabella root dei tenant
- `system_logs` - Log sistema (può essere globale o tenant-scoped)
- `schema_migrations` - Migrazioni database
- `auth_users` - Utenti autenticati (superadmin può vedere tutti, admin solo del proprio tenant)

### Query Corrette

```sql
-- ✅ Corretto: Include tenant_id filter
SELECT * FROM campaigns WHERE tenant_id = ? AND id = ?;

-- ✅ Corretto: JOIN con tenant_id su entrambe le tabelle
SELECT c.*, u.email 
FROM coupons c
JOIN users u ON c.user_id = u.id AND u.tenant_id = c.tenant_id
WHERE c.tenant_id = ? AND c.status = 'active';

-- ✅ Corretto: JOIN multipli con tenant_id
SELECT c.*, camp.name as campaign_name, u.email
FROM coupons c
JOIN campaigns camp ON c.campaign_id = camp.id AND camp.tenant_id = c.tenant_id
JOIN users u ON c.user_id = u.id AND u.tenant_id = c.tenant_id
WHERE c.tenant_id = ?;

-- ✅ Corretto: UPDATE con tenant_id
UPDATE campaigns SET is_active = 1 WHERE id = ? AND tenant_id = ?;

-- ✅ Corretto: DELETE con tenant_id
DELETE FROM coupons WHERE id = ? AND tenant_id = ?;

-- ✅ Corretto: INSERT con tenant_id
INSERT INTO campaigns (name, discount_type, discount_value, tenant_id) 
VALUES (?, ?, ?, ?);
```

### Query Errate

```sql
-- ❌ ERRATO: Manca filtro tenant_id
SELECT * FROM campaigns WHERE id = ?;

-- ❌ ERRATO: JOIN senza verifica tenant_id su entrambe le tabelle
SELECT c.* FROM coupons c
JOIN campaigns camp ON c.campaign_id = camp.id
WHERE c.id = ?;

-- ❌ ERRATO: UPDATE senza tenant_id (rischio cross-tenant)
UPDATE campaigns SET is_active = 1 WHERE id = ?;

-- ❌ ERRATO: DELETE senza tenant_id (rischio cross-tenant)
DELETE FROM coupons WHERE id = ?;
```

### Helper Functions per Tenant Isolation

Il progetto include helper functions per garantire l'isolamento tenant:

**`ensureTenantFilter(sql, tableName, tenantId)`** - Valida che una query SQL includa il filtro tenant_id appropriato.

```javascript
const { ensureTenantFilter } = require('./utils/db');

// Validazione query
const validation = ensureTenantFilter(
    'SELECT * FROM campaigns WHERE tenant_id = ? AND id = ?',
    'campaigns',
    tenantId
);

if (!validation.valid) {
    logger.warn({ warning: validation.warning }, 'Query missing tenant filter');
}
```

**`getTenantId(req)`** - Ottiene il tenant ID dal request (funziona per route legacy e tenant-scoped).

```javascript
const { getTenantId } = require('./utils/routeHelper');

const tenantId = await getTenantId(req);
if (!tenantId) {
    return res.status(400).json({ error: 'Tenant non valido' });
}
```

### Middleware per Tenant Isolation

**`requireSameTenantAsSession`** - Verifica che il tenant nella sessione corrisponda al tenant nella richiesta.

```javascript
const { tenantLoader, requireSameTenantAsSession } = require('./middleware/tenant');
const { requireRole } = require('./middleware/auth');

app.get('/t/:tenantSlug/api/admin/campaigns',
    tenantLoader,
    requireSameTenantAsSession,
    requireRole('admin'),
    handler
);
```

### Best Practices

1. **Sempre includere tenant_id nelle query** su tabelle tenant-scoped
2. **Usare `getTenantId(req)`** invece di accedere direttamente a `req.session.user.tenantId`
3. **Verificare tenant_id anche nei JOIN** - entrambe le tabelle devono avere il filtro
4. **Superadmin può accedere a tutti i tenant** - ma deve comunque specificare tenant_id nelle query quando appropriato
5. **Testare tenant isolation** con test automatici (vedi `scripts/test-tenant-isolation.js`)

---

## Indici Compositi per Performance

### idx_coupons_tenant_campaign_status

```sql
CREATE INDEX idx_coupons_tenant_campaign_status 
ON coupons(tenant_id, campaign_id, status);
```

**Scopo:** Ottimizza query analytics che filtrano per tenant, campagna e status.

**Query ottimizzate:**
```sql
SELECT COUNT(*) FROM coupons 
WHERE tenant_id = ? AND campaign_id = ? AND status = 'redeemed';
```

### idx_coupons_tenant_issued_at

```sql
CREATE INDEX idx_coupons_tenant_issued_at 
ON coupons(tenant_id, issued_at);
```

**Scopo:** Ottimizza ordinamenti temporali per tenant.

**Query ottimizzate:**
```sql
SELECT * FROM coupons 
WHERE tenant_id = ? 
ORDER BY issued_at DESC 
LIMIT 50;
```

---

## Vincoli Unique Tenant-Scoped

Alcuni vincoli unique sono scoped per tenant:

- `users.email` - Unique per (tenant_id, email)
- `products.sku` - Unique per (tenant_id, sku) se sku non null

Questo permette a tenant diversi di avere email/SKU duplicati.

---

## Note Importanti

1. **Foreign Keys:** SQLite ha foreign keys disabilitate di default (`PRAGMA foreign_keys = OFF`). Le relazioni sono logiche, non fisiche.

2. **Booleani:** SQLite non ha tipo BOOLEAN nativo. Usa INTEGER (0 = false, 1 = true).

3. **Date:** Le date sono memorizzate come stringhe ISO datetime (`DATETIME`).

4. **JSON Fields:** Alcuni campi (`form_config`, `config_data`, `details`) sono memorizzati come JSON string.

5. **Migrations:** Le migrazioni sono idempotenti e vengono eseguite automaticamente all'avvio dell'applicazione.

6. **Default Tenant:** Un tenant di default viene creato automaticamente se non esiste (slug: "default").

---

## Query Comuni

### Ottenere tutte le campagne attive di un tenant

```sql
SELECT * FROM campaigns 
WHERE tenant_id = ? AND is_active = 1 
ORDER BY created_at DESC;
```

### Ottenere coupon attivi con info utente e campagna

```sql
SELECT 
    c.id,
    c.code,
    c.status,
    c.issued_at,
    u.email,
    u.first_name,
    u.last_name,
    camp.name as campaign_name
FROM coupons c
LEFT JOIN users u ON c.user_id = u.id AND u.tenant_id = c.tenant_id
LEFT JOIN campaigns camp ON c.campaign_id = camp.id AND camp.tenant_id = c.tenant_id
WHERE c.tenant_id = ? AND c.status = 'active'
ORDER BY c.issued_at DESC;
```

### Ottenere statistiche coupon per campagna

```sql
SELECT 
    camp.id,
    camp.name,
    COUNT(c.id) as total_coupons,
    SUM(CASE WHEN c.status = 'redeemed' THEN 1 ELSE 0 END) as redeemed_count
FROM campaigns camp
LEFT JOIN coupons c ON camp.id = c.campaign_id AND camp.tenant_id = c.tenant_id
WHERE camp.tenant_id = ?
GROUP BY camp.id, camp.name;
```

### Ottenere custom fields per utenti (risolve N+1)

```sql
-- Prima: Query per ogni utente (N+1 problem)
-- Dopo: Query unica per tutti gli utenti
SELECT user_id, field_name, field_value 
FROM user_custom_data 
WHERE user_id IN (?, ?, ?) AND tenant_id = ?;
```

---

## Riferimenti

- Vedi `LLM_MD/TYPES.md` per definizioni JSDoc dei tipi
- Vedi `utils/db.js` per implementazione migrations e schema creation
- Vedi `docs/ARCHITECTURE.md` per architettura generale


