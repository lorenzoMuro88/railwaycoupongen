# 🔗 Relazioni tra View CouponGen

## 📊 Diagramma Relazioni Dettagliate

```mermaid
flowchart TD
    %% Entry Points
    START([👤 Utente]) --> HOME{Homepage}
    
    %% Public Flow
    HOME --> |"Richiesta Coupon"| FORM[index.html<br/>Form Coupon]
    HOME --> |"Registrazione"| SIGNUP[signup.html<br/>Nuovo Tenant]
    HOME --> |"Login"| LOGIN[login.html<br/>Login Generale]
    HOME --> |"SuperAdmin"| SUPERLOGIN[superadmin-login.html<br/>Login SuperAdmin]
    
    %% Form Flow
    FORM --> |"Submit"| THANKS[thanks.html<br/>Conferma]
    
    %% Signup Flow  
    SIGNUP --> |"Registrato"| LOGIN
    
    %% Authentication Flow
    LOGIN --> |"Admin"| ADMIN[admin.html<br/>Dashboard Admin]
    LOGIN --> |"Store"| STORE[store.html<br/>Pagina Store]
    SUPERLOGIN --> |"SuperAdmin"| SUPERADMIN[superadmin.html<br/>Dashboard Sistema]
    
    %% Admin Dashboard Flow
    ADMIN --> |"Setup Form"| FORMSETUP[formsetup.html<br/>Configurazione]
    ADMIN --> |"Design Form"| FORMDESIGN[form-setup.html<br/>Personalizzazione]
    ADMIN --> |"Campi Custom"| CUSTOM[custom-fields.html<br/>Campi Personalizzati]
    ADMIN --> |"Template Email"| EMAIL[email-template.html<br/>Template Email]
    ADMIN --> |"Database Utenti"| DB[db-utenti.html<br/>Gestione Utenti]
    ADMIN --> |"Prodotti"| PRODOTTI[prodotti.html<br/>Gestione Prodotti]
    ADMIN --> |"Analytics"| ANALYTICS[analytics.html<br/>Statistiche]
    ADMIN --> |"Store"| STORE
    
    %% SuperAdmin Flow
    SUPERADMIN --> |"Gestione Tenant"| ADMIN
    SUPERADMIN --> |"Vedi Admin"| ADMIN
    
    %% Store Flow
    STORE --> |"Riscatto"| REDEEM[redeem.html<br/>Riscatto Coupon]
    
    %% Styling
    classDef public fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef auth fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    classDef superadmin fill:#f3e5f5,stroke:#7b1fa2,stroke-width:3px
    classDef admin fill:#e8f5e8,stroke:#388e3c,stroke-width:2px
    classDef store fill:#fff8e1,stroke:#f9a825,stroke-width:2px
    classDef action fill:#ffebee,stroke:#d32f2f,stroke-width:2px
    
    class HOME,FORM,SIGNUP,THANKS,REDEEM public
    class LOGIN,SUPERLOGIN auth
    class SUPERADMIN superadmin
    class ADMIN,FORMSETUP,FORMDESIGN,CUSTOM,EMAIL,DB,PRODOTTI,ANALYTICS admin
    class STORE store
```

## 🎯 **Punti di Accesso Principali**

### 1. **Homepage** (`index.html`)
- **Entry point** principale del sistema
- Form per richiesta coupon
- Link a registrazione e login
- Accesso discreto a superadmin

### 2. **Login** (`login.html`)
- **Hub di autenticazione** per admin e store
- Redirect automatico in base al ruolo
- Supporto multi-tenant

### 3. **SuperAdmin Login** (`superadmin-login.html`)
- **Accesso dedicato** per superadmin
- Separato dal login normale
- Controlli di sicurezza specifici

## 🔄 **Flussi di Business**

### **Flusso Coupon Completo**
```
Homepage → Form Coupon → Thanks → Email → Riscatto
```

### **Flusso Registrazione Tenant**
```
Homepage → Signup → Login → Admin Dashboard
```

### **Flusso Gestione Admin**
```
Login → Admin Dashboard → [Setup | Analytics | Prodotti | etc.]
```

### **Flusso SuperAdmin**
```
SuperAdmin Login → Dashboard Sistema → Gestione Tenant/Admin
```

## 🏗️ **Architettura Multi-Tenant**

### **Route Pattern**
```
Legacy:     /admin, /store, /analytics
Multi-tenant: /t/:tenantSlug/admin, /t/:tenantSlug/store
```

### **Isolamento Tenant**
- Ogni tenant ha le proprie view isolate
- Middleware `tenantLoader` per caricamento tenant
- Controlli `requireSameTenantAsSession` per sicurezza

## 🔒 **Controlli di Accesso**

### **Livelli di Protezione**
1. **Pubblico** - Nessun controllo
2. **Autenticato** - Richiede login
3. **Ruolo Specifico** - Richiede ruolo admin/store
4. **SuperAdmin** - Richiede ruolo superadmin
5. **Tenant-Specifico** - Richiede appartenenza al tenant

### **Middleware Utilizzati**
- `requireAuth` - Autenticazione base
- `requireRole('admin')` - Ruolo admin
- `requireRole('store')` - Ruolo store  
- `requireSuperAdmin` - Ruolo superadmin
- `requireSameTenantAsSession` - Stesso tenant

## 📱 **Responsive Design**

### **Breakpoints**
- **Mobile**: < 768px
- **Tablet**: 768px - 1199px
- **Desktop**: 1200px+

### **View Ottimizzate**
- Tutte le view sono responsive
- Navigation mobile-friendly
- Form ottimizzati per touch

## 🎨 **Design System**

### **Colori Principali**
- **Primary**: Verde (#2d5a3d)
- **Secondary**: Accent verde (#4caf50)
- **Background**: Cream (#faf8f5)
- **Text**: Dark (#2c3e50)

### **Componenti Condivisi**
- Navigation bar
- Form styles
- Button styles
- Card layouts
- Modal dialogs
