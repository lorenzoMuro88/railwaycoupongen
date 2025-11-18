# Static Files Module - FLYCouponGen

Panoramica dei file statici (CSS, JavaScript) utilizzati nel progetto FLYCouponGen.

## Struttura

```
static/
├── styles.css          # CSS principale applicazione
├── navigation.css      # CSS navigazione e header
├── navigation.js       # JavaScript navigazione
├── notifications.js    # Sistema notifiche
└── uploads/            # Directory upload immagini (per-tenant)
```

---

## File CSS

### `styles.css`
CSS principale per tutta l'applicazione.

**Contenuto:**
- Stili globali (reset, typography, colors)
- Layout principali
- Componenti UI comuni
- Responsive design

**Utilizzo:**
```html
<link rel="stylesheet" href="/static/styles.css">
```

**Caratteristiche:**
- Design system con variabili CSS
- Supporto dark mode (se implementato)
- Responsive mobile-first

### `navigation.css`
CSS specifico per navigazione e header.

**Contenuto:**
- Stili header/navbar
- Menu dropdown
- Breadcrumbs
- User menu

**Utilizzo:**
```html
<link rel="stylesheet" href="/static/navigation.css">
```

**Caratteristiche:**
- Sticky header
- Menu responsive
- Animazioni transizioni

---

## File JavaScript

### `navigation.js`
Gestione navigazione e menu.

**Funzionalità:**
- Toggle menu mobile
- Gestione dropdown
- Highlight route corrente
- Logout handler

**Utilizzo:**
```html
<script src="/static/navigation.js"></script>
```

**API:**
```javascript
// Toggle mobile menu
toggleMobileMenu();

// Highlight route corrente
highlightCurrentRoute('/admin/campaigns');

// Logout
handleLogout();
```

### `notifications.js`
Sistema notifiche toast/flash messages.

**Funzionalità:**
- Mostra notifiche successo/errore
- Auto-dismiss dopo timeout
- Animazioni fade in/out
- Supporto multiple notifiche

**Utilizzo:**
```html
<script src="/static/notifications.js"></script>
```

**API:**
```javascript
// Mostra notifica successo
showNotification('Operazione completata', 'success');

// Mostra notifica errore
showNotification('Errore durante operazione', 'error');

// Mostra notifica info
showNotification('Informazione', 'info');

// Mostra notifica warning
showNotification('Attenzione', 'warning');
```

**Esempio:**
```javascript
// Dopo operazione API
fetch('/api/admin/campaigns', { method: 'POST', ... })
    .then(() => showNotification('Campagna creata', 'success'))
    .catch(() => showNotification('Errore creazione campagna', 'error'));
```

---

## Directory Uploads

### `uploads/`
Directory per file caricati dagli utenti.

**Struttura:**
```
uploads/
├── {tenant-slug}/
│   ├── header.png
│   ├── logo.png
│   └── ...
```

**Caratteristiche:**
- Organizzazione per-tenant
- Validazione MIME type
- Limitazione dimensione file
- Sanitizzazione filename

**Sicurezza:**
- Whitelist estensioni permesse
- Validazione tipo file
- Sanitizzazione path (previene directory traversal)
- Limitazione dimensione (configurabile via `UPLOAD_MAX_BYTES`)

**Utilizzo:**
```javascript
// Upload immagine header
POST /api/admin/settings/upload-image
Content-Type: multipart/form-data

// File accessibile via:
GET /api/uploads/{tenant-slug}/header.png
```

---

## Convenzioni Naming

### CSS Classes

- **BEM-like naming**: `.component__element--modifier`
- **Utility classes**: `.text-center`, `.mt-1`, `.btn-primary`
- **State classes**: `.is-active`, `.is-disabled`, `.has-error`

**Esempio:**
```css
.campaign-card { }
.campaign-card__title { }
.campaign-card__title--highlighted { }
.campaign-card.is-active { }
```

### JavaScript Functions

- **camelCase** per funzioni: `showNotification()`, `toggleMenu()`
- **PascalCase** per classi: `NotificationManager`, `MenuController`
- **UPPER_CASE** per costanti: `API_BASE_URL`, `MAX_RETRIES`

---

## Best Practices

### CSS

1. **Usare variabili CSS** per colori, spacing, etc.
2. **Mobile-first** - Iniziare da mobile, poi desktop
3. **Evitare !important** - Usare specificità corretta
4. **Organizzare per componente** - Raggruppare stili correlati

**Esempio:**
```css
:root {
    --primary-color: #007bff;
    --spacing-unit: 8px;
}

.button {
    padding: calc(var(--spacing-unit) * 2);
    background-color: var(--primary-color);
}
```

### JavaScript

1. **Modularità** - Separare logica in funzioni riutilizzabili
2. **Error handling** - Gestire errori gracefully
3. **Event delegation** - Usare delegation per eventi dinamici
4. **Performance** - Evitare DOM queries ripetute

**Esempio:**
```javascript
// ✅ Buono: Cache DOM query
const menu = document.querySelector('.menu');
menu.addEventListener('click', handleMenuClick);

// ❌ Evitare: Query ripetute
document.querySelector('.menu').addEventListener('click', () => {
    document.querySelector('.menu').classList.toggle('open');
});
```

---

## Integrazione con Template

### Inclusione File Statici

Tutti i template includono file statici così:

```html
<!DOCTYPE html>
<html>
<head>
    <link rel="stylesheet" href="/static/styles.css">
    <link rel="stylesheet" href="/static/navigation.css">
</head>
<body>
    <!-- Content -->
    
    <script src="/static/navigation.js"></script>
    <script src="/static/notifications.js"></script>
</body>
</html>
```

### Variabili Template

I file statici possono accedere a variabili globali iniettate:

```html
<script>
    // Variabili globali disponibili
    window.API_BASE_URL = '/api';
    window.TENANT_SLUG = '{{tenant.slug}}';
    window.USER = {{user|json}};
</script>
```

---

## Performance

### Ottimizzazioni

1. **Minificazione** - Minificare CSS/JS in produzione
2. **Caching** - Headers Cache-Control appropriati
3. **CDN** - Considerare CDN per file statici in produzione
4. **Lazy loading** - Caricare JS solo quando necessario

### Bundle Size

- `styles.css`: ~50KB (non minificato)
- `navigation.css`: ~10KB (non minificato)
- `navigation.js`: ~5KB (non minificato)
- `notifications.js`: ~3KB (non minificato)

---

## Testing

### Test CSS

- Verificare responsive design su vari dispositivi
- Testare accessibilità (contrasto colori, focus states)
- Verificare compatibilità browser

### Test JavaScript

- Test funzionalità navigazione
- Test sistema notifiche
- Test gestione errori

---

## Aggiungere Nuovo File Statico

### CSS

1. Creare file `.css` in `static/`
2. Includere in template:
   ```html
   <link rel="stylesheet" href="/static/new-file.css">
   ```
3. Documentare in questo README

### JavaScript

1. Creare file `.js` in `static/`
2. Includere in template:
   ```html
   <script src="/static/new-file.js"></script>
   ```
3. Documentare API e funzionalità in questo README

---

## Riferimenti

- Vedi `views/README.md` per utilizzo nei template
- Vedi `docs/ARCHITECTURE.md` per architettura generale
- Vedi `LLM_MD/CONFIGURATION.md` per configurazione upload

---

*Documentazione aggiornata: 2024*

