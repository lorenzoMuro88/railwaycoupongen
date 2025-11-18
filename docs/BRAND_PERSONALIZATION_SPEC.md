# 🎨 Sistema di Brand Personalization per Tenant

## 📋 Panoramica

Questo documento descrive tutte le opzioni visive personalizzabili per ogni tenant, permettendo a ogni cliente di riflettere il proprio brand nell'interfaccia admin.

---

## 🎯 Categorie di Personalizzazione

### 1. **🎨 Colori e Palette**

#### Colori Primari
- **Primary Color** (`--primary-green`)
  - Header, titoli principali, bottoni principali
  - Esempio: `#2d5a3d` (verde attuale) → personalizzabile in `#1e3a8a` (blu) per tenant blu
  
- **Accent Color** (`--accent-green`)
  - Bordi, elementi secondari, hover states
  - Esempio: `#4a7c59` → personalizzabile in `#3b82f6` (blu chiaro)

- **Light Color** (`--light-green`)
  - Background sezioni, hover leggeri
  - Esempio: `#e8f5e8` → `#dbeafe` (blu molto chiaro)

- **Dark Color** (`--dark-green`)
  - Stati hover più intensi, gradient dark
  - Esempio: `#1e3a2a` → `#1e40af` (blu scuro)

#### Colori di Supporto
- **Background** (`--cream`)
  - Colore sfondo principale delle pagine
  - Esempio: `#faf8f3` → `#f8fafc` (grigio bianco)

- **Text Colors**
  - `--text-dark`: Testo principale
  - `--text-medium`: Testo secondario
  - `--text-light`: Testo discreto

- **Accent Colors Speciali**
  - `--gold-accent`: Elementi premium/speciali
  - `--accent-red`: Bottoni pericolosi/delete
  - `--earth-brown`: Sottotitoli, elementi neutri

#### Gradienti
- **Primary Gradient** (`--gradient-primary`)
  - Background navigation, bottoni principali
  - Dinamico basato su primary + accent color

---

### 2. **📝 Tipografia**

#### Font Family
- **Font Principale**
  - Default: `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI'`
  - Personalizzabile: Google Fonts o font custom
  - Esempi: `Roboto`, `Montserrat`, `Poppins`, `Lato`

#### Dimensioni Font
- **Heading Sizes**
  - `h1`: 2.5rem → personalizzabile
  - `h2`: 1.875rem → personalizzabile
  - `h3`: 1.5rem → personalizzabile

- **Body Text**
  - Default: 1rem → personalizzabile
  - Small text: 0.875rem → personalizzabile

#### Font Weight
- Titoli: `600` → personalizzabile (300-700)
- Body: `400` → personalizzabile
- Bold: `700` → personalizzabile

#### Letter Spacing
- Default: `-0.011em` → personalizzabile
- Titoli: `-0.025em` → personalizzabile

#### Line Height
- Default: `1.7` → personalizzabile
- Titoli: `1.2` → personalizzabile

---

### 3. **🏷️ Branding e Logo**

#### Logo
- **Logo Upload**
  - Upload logo personalizzato
  - Format supportati: PNG, SVG, JPG
  - Posizionamento: Navigation bar, sidebar header
  - Max dimensioni: 200x60px

#### Brand Name
- **Nome Brand Personalizzato**
  - Default: "CouponGen Admin"
  - Personalizzabile: "Ristorante Mario Admin", "Hotel Luxe Admin", etc.
  - Visualizzato in: Navigation bar, page title, sidebar header

#### Favicon
- **Icona Personalizzata**
  - Upload favicon per browser tab
  - Format: ICO, PNG (16x16, 32x32, 48x48)

---

### 4. **🎭 Elementi UI**

#### Border Radius
- **Componenti**
  - Cards: `16px` → personalizzabile
  - Buttons: `12px` → personalizzabile
  - Inputs: `12px` → personalizzabile
  - Modals: `20px` → personalizzabile

#### Shadows
- **Shadow Levels**
  - `--shadow-light`: Ombre sottili
  - `--shadow-medium`: Ombre medie
  - `--shadow-large`: Ombre pronunciate
  - Personalizzabili: blur, spread, opacity, color

#### Spacing
- **Element Spacing**
  - Gap tra elementi: `1rem` → personalizzabile
  - Padding cards: `2rem` → personalizzabile
  - Margin sections: `2rem` → personalizzabile

#### Borders
- **Border Style**
  - Color: `--border-light` → personalizzabile
  - Width: `2px` → personalizzabile
  - Style: `solid` → personalizzabile (dashed, dotted)

---

### 5. **🎨 Navigation Bar**

#### Background
- **Navigation Background**
  - Gradient personalizzato
  - Colore solido alternativo
  - Immagine background (opzionale)

#### Navigation Items
- **Link Colors**
  - Default: Bianco su gradient
  - Personalizzabile per hover/active states

#### Brand Section
- **Logo Position**
  - Left aligned (default)
  - Center aligned
  - Right aligned

---

### 6. **📱 Sidebar**

#### Sidebar Header
- **Header Background**
  - Stesso gradient della navigation
  - Colore personalizzato

#### Sidebar Links
- **Link Styling**
  - Icon colors
  - Hover background color
  - Active state color

---

### 7. **🔘 Bottoni**

#### Button Styles
- **Primary Buttons**
  - Background: Primary color o gradient
  - Border radius: personalizzabile
  - Hover effect: darken o lighten

- **Secondary Buttons**
  - Border color: personalizzabile
  - Text color: personalizzabile

- **Action Buttons**
  - Success (green): personalizzabile
  - Warning (yellow): personalizzabile
  - Danger (red): personalizzabile
  - Info (blue): personalizzabile

#### Button Sizes
- Small, Medium, Large: dimensioni personalizzabili

---

### 8. **📊 Cards e Contenitori**

#### Card Styling
- **Background Color**
  - Default: Bianco
  - Personalizzabile: Colori custom

- **Card Borders**
  - Border color personalizzabile
  - Border width personalizzabile

#### Section Backgrounds
- **Section Colors**
  - Colori di sfondo per sezioni speciali
  - Esempio: Analytics section, Campaigns section

---

### 9. **🎯 Tabella**

#### Table Headers
- **Header Background**
  - Default: Gradient primary
  - Personalizzabile: Colori custom

- **Header Text**
  - Color: Bianco (default)
  - Personalizzabile

#### Table Rows
- **Row Hover**
  - Background hover personalizzabile
  - Alternating row colors (opzionale)

---

### 10. **📧 Email Branding** (Opzionale)

#### Email Header
- **Email Logo**
  - Logo nel template email
  - Colori brand in email

#### Email Colors
- **Email Primary Color**
  - Colore principale nel template
  - Supporta anche il branding frontend

---

## 🔐 Permessi e Controlli Accesso

### **Solo Super Admin può modificare**
- ✅ **POST/PUT**: Solo super admin può creare/modificare brand settings
- ✅ **GET (read-only)**: Admin del tenant possono solo vedere il loro brand applicato
- ✅ **Setup fase vendita**: Il super admin configura il brand quando crea/setup un tenant per un cliente

### **Flusso di Setup e Modifiche**
1. **Prima Configurazione (Setup Fase Vendita)**
   - Super Admin crea nuovo tenant per cliente
   - Super Admin configura brand settings (colori, logo, tipografia, etc.)
   - Admin del tenant vedono il brand applicato (non possono modificarlo)

2. **Modifiche Successive (Sempre Possibili)**
   - Super Admin può modificare **tutti gli elementi** in qualsiasi momento:
     - Cambiare colori
     - Aggiornare logo
     - Modificare tipografia
     - Aggiornare UI elements (border radius, shadows, etc.)
   - Ogni modifica si applica immediatamente a tutte le view del tenant
   - Nessuna limitazione sul numero di modifiche o frequenza

---

## 🗄️ Schema Database Proposto

```sql
CREATE TABLE tenant_brand_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL UNIQUE,
    
    -- Colori
    primary_color TEXT DEFAULT '#2d5a3d',
    accent_color TEXT DEFAULT '#4a7c59',
    light_color TEXT DEFAULT '#e8f5e8',
    dark_color TEXT DEFAULT '#1e3a2a',
    background_color TEXT DEFAULT '#faf8f3',
    text_dark_color TEXT DEFAULT '#2c3e50',
    text_medium_color TEXT DEFAULT '#5a6c7d',
    text_light_color TEXT DEFAULT '#8a9ba8',
    border_color TEXT DEFAULT '#e1e8ed',
    
    -- Tipografia
    font_family TEXT DEFAULT "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI'",
    font_size_base TEXT DEFAULT '1rem',
    font_weight_normal TEXT DEFAULT '400',
    font_weight_bold TEXT DEFAULT '600',
    letter_spacing TEXT DEFAULT '-0.011em',
    line_height TEXT DEFAULT '1.7',
    
    -- Branding
    brand_name TEXT,
    logo_url TEXT,
    favicon_url TEXT,
    
    -- UI Elements
    border_radius_small TEXT DEFAULT '8px',
    border_radius_medium TEXT DEFAULT '12px',
    border_radius_large TEXT DEFAULT '16px',
    border_radius_xlarge TEXT DEFAULT '20px',
    shadow_enabled BOOLEAN DEFAULT 1,
    shadow_color TEXT DEFAULT 'rgba(45, 90, 61, 0.08)',
    
    -- Navigation
    navbar_style TEXT DEFAULT 'gradient', -- 'gradient', 'solid', 'image'
    navbar_background_image TEXT,
    navbar_logo_position TEXT DEFAULT 'left', -- 'left', 'center', 'right'
    
    -- Metadata
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);
```

---

## 🎯 Esempi Pratici

### Tenant A: "Ristorante Verde" (Brand Naturale)
```json
{
  "primary_color": "#2d5a3d",    // Verde scuro
  "accent_color": "#4a7c59",     // Verde medio
  "light_color": "#e8f5e8",      // Verde chiarissimo
  "background_color": "#faf8f3", // Cream
  "font_family": "'Inter', sans-serif",
  "brand_name": "Ristorante Verde Admin",
  "logo_url": "/uploads/tenant-a-logo.png"
}
```

### Tenant B: "Hotel Blu" (Brand Professionale)
```json
{
  "primary_color": "#1e3a8a",    // Blu scuro
  "accent_color": "#3b82f6",     // Blu brillante
  "light_color": "#dbeafe",      // Blu chiarissimo
  "background_color": "#f8fafc", // Grigio bianco
  "font_family": "'Roboto', sans-serif",
  "brand_name": "Hotel Blu Admin",
  "logo_url": "/uploads/tenant-b-logo.png",
  "border_radius_medium": "8px"   // Più sharp, professionale
}
```

### Tenant C: "Boutique Rosa" (Brand Elegante)
```json
{
  "primary_color": "#9f1239",    // Rosa scuro
  "accent_color": "#ec4899",     // Rosa acceso
  "light_color": "#fce7f3",      // Rosa chiarissimo
  "background_color": "#fef7ff", // Bianco rosato
  "font_family": "'Playfair Display', serif", // Font elegante
  "brand_name": "Boutique Rosa Admin",
  "logo_url": "/uploads/tenant-c-logo.png",
  "border_radius_medium": "16px"  // Più rounded, elegante
}
```

---

## 🚀 Benefici

1. **Brand Consistency**: Ogni tenant vede il proprio brand ovunque
2. **Professional Appearance**: Personalizzazione completa del look & feel
3. **White Label Ready**: Sistema pronto per white-labeling completo
4. **User Recognition**: Admin riconoscono immediatamente il proprio ambiente
5. **Scalabilità**: Facile aggiungere nuove opzioni in futuro

---

## 🔌 API Endpoints

### **Super Admin - Gestione Brand Settings**

#### GET `/api/superadmin/tenants/:id/brand`
Recupera brand settings di un tenant (super admin only)
```javascript
// Response
{
  "primary_color": "#2d5a3d",
  "accent_color": "#4a7c59",
  "brand_name": "Ristorante Verde",
  "logo_url": "/uploads/logo.png",
  // ... tutti gli altri settings
}
```

#### POST `/api/superadmin/tenants/:id/brand`
Crea brand settings (prima configurazione) oppure aggiorna completamente (super admin only)
```javascript
// Request body - Prima configurazione o aggiornamento completo
{
  "primary_color": "#1e3a8a",
  "accent_color": "#3b82f6",
  "brand_name": "Hotel Blu Admin",
  "logo_url": "/uploads/hotel-blu-logo.png",
  "font_family": "'Roboto', sans-serif",
  // ... tutti gli altri settings
}

// Se brand esiste già, questo endpoint aggiorna tutti i campi
```

#### PUT `/api/superadmin/tenants/:id/brand`
Aggiorna parziale brand settings (super admin only)
```javascript
// Request body (solo campi da aggiornare)
// Permette di modificare anche un solo elemento senza riscrivere tutto
{
  "primary_color": "#1e3a8a"  // Aggiorna solo questo colore
}

// Oppure modifiche multiple
{
  "primary_color": "#1e3a8a",
  "logo_url": "/uploads/new-logo.png"  // Aggiorna più elementi insieme
}
```

**Nota**: Entrambi gli endpoint (POST e PUT) permettono modifiche illimitate nel tempo.

### **Tenant Admin - Read Only**

#### GET `/t/:tenantSlug/api/brand-settings`
Recupera brand settings applicati (read-only per admin tenant)
```javascript
// Response
{
  "primary_color": "#1e3a8a",
  "accent_color": "#3b82f6",
  // ... tutti gli altri settings
}
```

**Nota**: Gli admin del tenant possono solo leggere il brand, non modificarlo.

---

## 🖥️ Interfaccia Super Admin

### **Design UI per Configurazione Brand**

L'interfaccia super admin avrà una sezione dedicata per configurare il brand di ogni tenant:

#### **Nella Tabella Tenant**
- Colonna "Brand" con preview colori
- Pulsante "🎨 Configura Brand" per ogni tenant
- Badge se brand configurato vs default

#### **Modal "Configura Brand"**
Quando si clicca "Configura Brand", si apre un modal con:

**Tab 1: Colori**
- Color picker per Primary Color
- Color picker per Accent Color
- Color picker per Light Color
- Color picker per Dark Color
- Color picker per Background Color
- Preview live del gradient
- Reset ai default

**Tab 2: Tipografia**
- Dropdown font family (Google Fonts)
- Slider per font size base
- Slider per font weight
- Preview text live

**Tab 3: Branding**
- Upload logo (drag & drop)
- Input brand name
- Upload favicon
- Preview logo nella navigation

**Tab 4: UI Elements**
- Slider border radius (small, medium, large)
- Toggle shadow enabled
- Color picker shadow color
- Preview card con nuovi stili

**Bottom Actions**
- Pulsante "Salva" (salva e applica)
- Pulsante "Reset ai Default"
- Pulsante "Preview Live" (apre nuova tab con brand applicato)

### **Workflow Super Admin**

1. **Creazione Tenant**
   - Super admin crea nuovo tenant
   - Opzionalmente può configurare brand subito
   - Oppure lo configura dopo

2. **Modifica Brand Esistente (Modifiche Illimitate)**
   - Super admin va su tenant nella tabella
   - Clicca "🎨 Configura Brand" (funziona sia per nuova configurazione che per modifiche)
   - Modal si apre con valori correnti già caricati
   - Super admin può modificare **qualsiasi elemento**:
     - Cambiare solo i colori (senza toccare altro)
     - Aggiornare solo il logo
     - Modificare solo la tipografia
     - Oppure cambiare tutto insieme
   - Preview live durante modifica
   - Salva → brand applicato **immediatamente** a tutte le view del tenant
   - **Nessuna limitazione**: può modificare infinite volte, quando vuole

3. **Setup Fase Vendita**
   - Durante onboarding cliente
   - Super admin configura brand come parte del setup
   - Cliente vede il proprio brand quando accede per la prima volta

---

## 📝 Note di Implementazione

- **Permessi**: Solo super admin può modificare brand settings
- **Default Values**: Se brand non configurato, usa valori default del sistema
- **Retrocompatibilità**: Tenant esistenti continuano a funzionare con default
- **Validazione**: 
  - Colori HEX validati (formato `#rrggbb`)
  - Font family validati (prevent injection)
  - Logo dimensioni validate
- **Performance**: 
  - Brand settings cached (non query DB ad ogni request)
  - Logo/images serviti staticamente
- **Preview**: Preview live durante configurazione nel super admin
- **Reset**: Possibilità di reset completo ai default

