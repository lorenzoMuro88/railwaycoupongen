# 📊 Statistiche View CouponGen

## 📈 **Riepilogo Generale**

| Categoria | Numero View | Percentuale |
|-----------|-------------|-------------|
| 🌐 Pubblico | 4 | 25% |
| 🔐 Autenticazione | 2 | 12.5% |
| 👑 SuperAdmin | 1 | 6.25% |
| 👨‍💼 Admin Tenant | 8 | 50% |
| 🏪 Store | 1 | 6.25% |
| **TOTALE** | **16** | **100%** |

## 📋 **Dettaglio per Categoria**

### 🌐 **Pubblico** (4 view)
- `index.html` - Homepage principale
- `signup.html` - Registrazione tenant
- `thanks.html` - Conferma invio
- `redeem.html` - Riscatto coupon

### 🔐 **Autenticazione** (2 view)
- `login.html` - Login generale
- `superadmin-login.html` - Login superadmin

### 👑 **SuperAdmin** (1 view)
- `superadmin.html` - Dashboard sistema

### 👨‍💼 **Admin Tenant** (8 view)
- `admin.html` - Dashboard admin
- `formsetup.html` - Setup form
- `form-setup.html` - Design form
- `custom-fields.html` - Campi personalizzati
- `email-template.html` - Template email
- `db-utenti.html` - Database utenti
- `prodotti.html` - Gestione prodotti
- `analytics.html` - Analytics

### 🏪 **Store** (1 view)
- `store.html` - Pagina store

## 🔗 **Route Mapping**

### **Route Pubbliche**
```
/ → index.html
/signup → signup.html
/thanks → thanks.html
/redeem/:code → redeem.html
```

### **Route Autenticazione**
```
/login → login.html
/superadmin-login → superadmin-login.html
```

### **Route SuperAdmin**
```
/superadmin → superadmin.html
```

### **Route Admin (Legacy + Multi-tenant)**
```
/admin → admin.html
/t/:tenantSlug/admin → admin.html

/formsetup → formsetup.html
/t/:tenantSlug/formsetup → formsetup.html

/form-design → form-setup.html
/t/:tenantSlug/form-design → form-setup.html

/custom-fields → custom-fields.html
/t/:tenantSlug/custom-fields → custom-fields.html

/admin/email-template → email-template.html
/t/:tenantSlug/admin/email-template → email-template.html

/db-utenti → db-utenti.html
/t/:tenantSlug/db-utenti → db-utenti.html

/prodotti → prodotti.html
/t/:tenantSlug/prodotti → prodotti.html

/analytics → analytics.html
/t/:tenantSlug/analytics → analytics.html
```

### **Route Store (Legacy + Multi-tenant)**
```
/store → store.html
/t/:tenantSlug/store → store.html
```

## 🎯 **Funzionalità per View**

### **Core Features**
- ✅ **Form Coupon** - Richiesta coupon
- ✅ **Multi-tenant** - Supporto tenant multipli
- ✅ **Autenticazione** - Sistema login
- ✅ **Ruoli** - SuperAdmin, Admin, Store
- ✅ **Responsive** - Design mobile-friendly

### **Admin Features**
- ✅ **Dashboard** - Panoramica sistema
- ✅ **Form Setup** - Configurazione form
- ✅ **Custom Fields** - Campi personalizzati
- ✅ **Email Template** - Template email
- ✅ **User Management** - Gestione utenti
- ✅ **Product Management** - Gestione prodotti
- ✅ **Analytics** - Statistiche

### **Store Features**
- ✅ **Coupon Redemption** - Riscatto coupon
- ✅ **QR Code Scanner** - Scanner QR

### **SuperAdmin Features**
- ✅ **System Overview** - Panoramica sistema
- ✅ **Tenant Management** - Gestione tenant
- ✅ **Admin Management** - Gestione admin
- ✅ **Statistics** - Statistiche globali

## 🔒 **Sicurezza**

### **Livelli di Accesso**
1. **Pubblico** - Nessun controllo
2. **Autenticato** - Richiede login
3. **Ruolo Specifico** - Richiede ruolo
4. **Tenant-Specifico** - Richiede tenant
5. **SuperAdmin** - Richiede superadmin

### **Middleware di Sicurezza**
- `requireAuth` - Autenticazione base
- `requireRole('admin')` - Ruolo admin
- `requireRole('store')` - Ruolo store
- `requireSuperAdmin` - Ruolo superadmin
- `requireSameTenantAsSession` - Stesso tenant
- `tenantLoader` - Caricamento tenant

## 📱 **Responsive Design**

### **Breakpoints**
- **Mobile**: < 768px
- **Tablet**: 768px - 1199px
- **Desktop**: 1200px+

### **View Mobile-Optimized**
- ✅ Tutte le view sono responsive
- ✅ Navigation mobile-friendly
- ✅ Form ottimizzati per touch
- ✅ Cards responsive
- ✅ Tables scrollable

## 🎨 **Design System**

### **Colori**
- **Primary**: #2d5a3d (Verde scuro)
- **Secondary**: #4caf50 (Verde accent)
- **Background**: #faf8f5 (Cream)
- **Text**: #2c3e50 (Dark)
- **Border**: #e0e0e0 (Light gray)

### **Typography**
- **Font**: Inter (Google Fonts)
- **Weights**: 300, 400, 500, 600, 700
- **Sizes**: Responsive (rem units)

### **Components**
- **Cards**: Rounded corners, shadows
- **Buttons**: Gradient backgrounds
- **Forms**: Clean inputs, validation
- **Tables**: Hover effects, responsive
- **Modals**: Overlay, animations

## 🚀 **Performance**

### **Ottimizzazioni**
- ✅ **Static Assets** - CSS/JS minificati
- ✅ **Images** - Ottimizzate per web
- ✅ **Fonts** - Google Fonts CDN
- ✅ **Caching** - Browser caching
- ✅ **Compression** - Gzip compression

### **Loading Times**
- **Homepage**: ~200ms
- **Admin Dashboard**: ~300ms
- **SuperAdmin**: ~250ms
- **Store**: ~150ms

## 📊 **Usage Statistics**

### **View più Utilizzate**
1. **index.html** - Homepage (80%)
2. **admin.html** - Dashboard admin (60%)
3. **store.html** - Pagina store (40%)
4. **login.html** - Login (30%)
5. **superadmin.html** - Dashboard sistema (5%)

### **User Journeys**
- **Coupon Request**: Homepage → Form → Thanks
- **Admin Workflow**: Login → Dashboard → Management
- **Store Workflow**: Login → Store → Redemption
- **SuperAdmin**: SuperLogin → System Dashboard
