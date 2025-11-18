# Views Module - FLYCouponGen

Panoramica dei template HTML utilizzati nel progetto FLYCouponGen.

## Struttura

I template HTML sono serviti come file statici e utilizzano variabili template per rendering dinamico.

## Template Disponibili

### 🔐 Autenticazione

#### `login.html`
Pagina di login per admin/store.

**Variabili disponibili:**
- `error` - Messaggio errore (opzionale)
- `redirect` - URL redirect dopo login (opzionale)

**Route:** `GET /login`

#### `signup.html`
Pagina di registrazione nuovo tenant.

**Variabili disponibili:**
- `error` - Messaggio errore (opzionale)

**Route:** `GET /signup`

#### `store-login.html`
Pagina di login specifica per store (interfaccia cassa).

**Variabili disponibili:**
- `error` - Messaggio errore (opzionale)

**Route:** `GET /store-login`

#### `superadmin-login.html`
Pagina di login per superadmin.

**Variabili disponibili:**
- `error` - Messaggio errore (opzionale)

**Route:** `GET /superadmin-login`

#### `access.html`
Pagina di accesso (redirect dopo login).

**Variabili disponibili:**
- Nessuna variabile specifica

**Route:** `GET /access`

---

### 🏠 Pubbliche

#### `index.html`
Homepage pubblica (landing page).

**Variabili disponibili:**
- Nessuna variabile specifica

**Route:** `GET /`

#### `home.html`
Homepage tenant-specifica.

**Variabili disponibili:**
- `tenant` - Oggetto tenant (slug, name, etc.)

**Route:** `GET /t/:tenantSlug`

#### `formsetup.html`
Pagina setup form per campagna.

**Variabili disponibili:**
- `campaign` - Oggetto campagna
- `tenant` - Oggetto tenant

**Route:** `GET /t/:tenantSlug/form/:campaignCode`

#### `thanks.html`
Pagina di ringraziamento dopo submit form.

**Variabili disponibili:**
- `message` - Messaggio di ringraziamento

**Route:** `GET /t/:tenantSlug/thanks`

---

### 👤 Admin Panel

#### `admin.html`
Dashboard principale admin.

**Variabili disponibili:**
- `user` - Utente autenticato (session)
- `tenant` - Oggetto tenant corrente

**Route:** `GET /t/:tenantSlug/admin`

#### `analytics.html`
Pagina analytics e statistiche.

**Variabili disponibili:**
- `user` - Utente autenticato
- `tenant` - Oggetto tenant

**Route:** `GET /t/:tenantSlug/analytics`

#### `utenti.html` / `db-utenti.html`
Pagina gestione utenti.

**Variabili disponibili:**
- `user` - Utente autenticato
- `tenant` - Oggetto tenant

**Route:** `GET /t/:tenantSlug/admin/users`

#### `prodotti.html`
Pagina gestione prodotti.

**Variabili disponibili:**
- `user` - Utente autenticato
- `tenant` - Oggetto tenant

**Route:** `GET /t/:tenantSlug/admin/products`

#### `custom-fields.html`
Pagina gestione custom fields.

**Variabili disponibili:**
- `user` - Utente autenticato
- `tenant` - Oggetto tenant

**Route:** `GET /t/:tenantSlug/admin/custom-fields`

#### `form-design.html`
Pagina design form campagne.

**Variabili disponibili:**
- `user` - Utente autenticato
- `tenant` - Oggetto tenant
- `campaign` - Campagna corrente (se editing)

**Route:** `GET /t/:tenantSlug/admin/form-design`

#### `email-template.html`
Pagina gestione template email.

**Variabili disponibili:**
- `user` - Utente autenticato
- `tenant` - Oggetto tenant
- `template` - Template email corrente (opzionale)

**Route:** `GET /t/:tenantSlug/admin/email-template`

#### `logs.html`
Pagina visualizzazione log sistema.

**Variabili disponibili:**
- `user` - Utente autenticato
- `tenant` - Oggetto tenant

**Route:** `GET /t/:tenantSlug/admin/logs`

#### `account.html`
Pagina gestione account utente.

**Variabili disponibili:**
- `user` - Utente autenticato
- `tenant` - Oggetto tenant

**Route:** `GET /t/:tenantSlug/admin/account`

---

### 🏪 Store Interface

#### `store.html`
Interfaccia cassa per riscatto coupon.

**Variabili disponibili:**
- `user` - Utente store autenticato
- `tenant` - Oggetto tenant

**Route:** `GET /t/:tenantSlug/store`

#### `redeem.html`
Pagina riscatto coupon.

**Variabili disponibili:**
- `user` - Utente store autenticato
- `tenant` - Oggetto tenant
- `coupon` - Coupon da riscattare (opzionale)

**Route:** `GET /t/:tenantSlug/redeem`

---

### 👑 Superadmin

#### `superadmin.html`
Dashboard superadmin.

**Variabili disponibili:**
- `user` - Utente superadmin autenticato

**Route:** `GET /superadmin`

#### `superadmin-tenant-brand.html`
Pagina gestione brand tenant (superadmin).

**Variabili disponibili:**
- `user` - Utente superadmin
- `tenant` - Tenant selezionato

**Route:** `GET /superadmin/tenant/:tenantSlug/brand`

---

### ❌ Error Pages

#### `404.html`
Pagina errore 404 Not Found.

**Variabili disponibili:**
- Nessuna variabile specifica

**Route:** Tutte le route non trovate

---

## Pattern Rendering

### Template Variables

Le variabili sono iniettate nel template tramite Express `res.render()` o sostituzione stringa.

**Esempio:**
```javascript
// In route handler
res.render('admin', {
    user: req.session.user,
    tenant: req.tenant
});
```

### Template Syntax

I template utilizzano sintassi semplice con placeholder:

```html
<!-- Esempio -->
<h1>Benvenuto, {{user.username}}</h1>
<p>Tenant: {{tenant.name}}</p>
```

Oppure con EJS/Handlebars se configurato:

```html
<h1>Benvenuto, <%= user.username %></h1>
```

---

## Struttura Template

### Layout Comune

Tutti i template condividono:
- Header con navigazione
- Footer comune
- CSS/JS comuni da `/static/`

### Inclusione File Statici

```html
<!-- CSS -->
<link rel="stylesheet" href="/static/styles.css">
<link rel="stylesheet" href="/static/navigation.css">

<!-- JavaScript -->
<script src="/static/navigation.js"></script>
<script src="/static/notifications.js"></script>
```

---

## Best Practices

1. **Sempre sanitizzare output** - Usare escape HTML per variabili utente
2. **Validare variabili** - Verificare presenza variabili prima di usarle
3. **Consistenza layout** - Mantenere struttura comune tra template
4. **Accessibilità** - Usare semantic HTML e ARIA labels

---

## Modificare Template

### Aggiungere Nuovo Template

1. Creare file `.html` in `views/`
2. Aggiungere route in `server.js` o modulo route appropriato
3. Documentare variabili disponibili in questo README

### Modificare Template Esistente

1. Verificare variabili utilizzate
2. Testare rendering con dati reali
3. Verificare compatibilità con layout comune

---

## Variabili Comuni

### `user` (SessionUser)
Oggetto utente autenticato:
```javascript
{
    id: 1,
    username: "admin",
    userType: "admin",
    tenantId: 1,
    tenantSlug: "mario-store"
}
```

### `tenant` (Tenant)
Oggetto tenant corrente:
```javascript
{
    id: 1,
    slug: "mario-store",
    name: "Mario's Store",
    email_from_name: "Mario's Store"
}
```

### `error`
Messaggio errore (stringa):
```javascript
"Email già registrata"
```

---

## Riferimenti

- Vedi `LLM_MD/TYPES.md` per definizioni tipo (SessionUser, Tenant)
- Vedi `static/README.md` per file statici CSS/JS
- Vedi `docs/ARCHITECTURE.md` per architettura rendering

---

*Documentazione aggiornata: 2024*

