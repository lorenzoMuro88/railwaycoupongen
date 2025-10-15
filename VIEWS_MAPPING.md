# 🗺️ Mappatura View CouponGen

## 📊 Diagramma Architettura View

```mermaid
graph TB
    %% Pubblico
    subgraph "🌐 Pubblico"
        A[index.html<br/>Homepage<br/>Form Coupon]
        A0[access.html<br/>Pagina Accesso<br/>Hub Navigazione]
        B[signup.html<br/>Registrazione Tenant]
        C[thanks.html<br/>Conferma Invio]
        D[redeem.html<br/>Riscatto Coupon]
    end

    %% Autenticazione
    subgraph "🔐 Autenticazione"
        E[login.html<br/>Login Generale]
        F[superadmin-login.html<br/>Login SuperAdmin]
    end

    %% SuperAdmin
    subgraph "👑 SuperAdmin"
        G[superadmin.html<br/>Dashboard Sistema<br/>Gestione Tenant & Admin]
    end

    %% Admin Tenant
    subgraph "👨‍💼 Admin Tenant"
        H[admin.html<br/>Dashboard Admin]
        I[formsetup.html<br/>Setup Form]
        J[form-setup.html<br/>Design Form]
        K[custom-fields.html<br/>Campi Personalizzati]
        L[email-template.html<br/>Template Email]
        M[db-utenti.html<br/>Database Utenti]
        N[prodotti.html<br/>Gestione Prodotti]
        O[analytics.html<br/>Analytics]
    end

    %% Store
    subgraph "🏪 Store"
        P[store.html<br/>Pagina Store<br/>Riscatto Coupon]
    end

    %% Flussi di navigazione
    A --> A0
    A0 --> B
    A0 --> E
    A --> E
    B --> E
    E --> H
    E --> P
    F --> G
    G --> H
    H --> I
    H --> J
    H --> K
    H --> L
    H --> M
    H --> N
    H --> O
    H --> P
    A --> C
    P --> D

    %% Stili
    classDef public fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef auth fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef superadmin fill:#f3e5f5,stroke:#4a148c,stroke-width:3px
    classDef admin fill:#e8f5e8,stroke:#1b5e20,stroke-width:2px
    classDef store fill:#fff8e1,stroke:#f57f17,stroke-width:2px

    class A,A0,B,C,D public
    class E,F auth
    class G superadmin
    class H,I,J,K,L,M,N,O admin
    class P store
```

## 📋 Dettaglio View

### 🌐 **Pubblico** (Accesso libero)
| View | Route | Descrizione | Ruolo |
|------|-------|-------------|-------|
| `index.html` | `/` | Homepage con form coupon | Pubblico |
| `access.html` | `/access` | Hub navigazione per accessi | Pubblico |
| `signup.html` | `/signup` | Registrazione nuovo tenant | Pubblico |
| `thanks.html` | `/thanks` | Conferma invio coupon | Pubblico |
| `redeem.html` | `/redeem/:code` | Riscatto coupon con QR | Pubblico |

### 🔐 **Autenticazione**
| View | Route | Descrizione | Ruolo |
|------|-------|-------------|-------|
| `login.html` | `/login` | Login generale (admin/store) | Autenticazione |
| `superadmin-login.html` | `/superadmin-login` | Login dedicato superadmin | Autenticazione |

### 👑 **SuperAdmin** (1 solo utente)
| View | Route | Descrizione | Ruolo |
|------|-------|-------------|-------|
| `superadmin.html` | `/superadmin` | Dashboard sistema completo | SuperAdmin |

### 👨‍💼 **Admin Tenant** (Per ogni tenant)
| View | Route | Descrizione | Ruolo |
|------|-------|-------------|-------|
| `admin.html` | `/admin` | Dashboard principale admin | Admin |
| `formsetup.html` | `/formsetup` | Setup configurazione form | Admin |
| `form-setup.html` | `/form-design` | Personalizzazione estetica form | Admin |
| `custom-fields.html` | `/custom-fields` | Gestione campi personalizzati | Admin |
| `email-template.html` | `/admin/email-template` | Template email coupon | Admin |
| `db-utenti.html` | `/db-utenti` | Database utenti registrati | Admin |
| `prodotti.html` | `/prodotti` | Gestione prodotti/servizi | Admin |
| `analytics.html` | `/analytics` | Statistiche e analytics | Admin |
| `account.html` | `/account` | Gestione profilo utente admin | Admin |

### 🏪 **Store** (Per ogni tenant)
| View | Route | Descrizione | Ruolo |
|------|-------|-------------|-------|
| `store.html` | `/store` | Pagina store per riscatto | Store |

## 🔄 **Flussi di Navigazione**

### 1. **Flusso Pubblico**
```
Homepage → Form Coupon → Thanks
Homepage → Access → [Signup | Login] → Admin/Store
```

### 2. **Flusso SuperAdmin**
```
SuperAdmin Login → Dashboard Sistema → Gestione Tenant/Admin
```

### 3. **Flusso Admin Tenant**
```
Login → Dashboard Admin → [Form Setup | Analytics | Prodotti | etc.]
```

### 4. **Flusso Store**
```
Login → Pagina Store → Riscatto Coupon
```

## 🏗️ **Architettura Multi-Tenant**

### Route Pattern
- **Legacy**: `/admin`, `/store`, `/analytics`
- **Multi-tenant**: `/t/:tenantSlug/admin`, `/t/:tenantSlug/store`

### Gerarchia Ruoli
1. **SuperAdmin** → Gestisce tutto il sistema
2. **Admin** → Gestisce il proprio tenant
3. **Store** → Gestisce solo la pagina store del proprio tenant

## 🔒 **Controlli Accesso**

| View | Controllo | Middleware |
|------|-----------|------------|
| Pubblico | Nessuno | - |
| Login | Redirect se autenticato | - |
| SuperAdmin | `userType === 'superadmin'` | `requireSuperAdmin` |
| Admin | `userType === 'admin'` | `requireRole('admin')` |
| Store | `userType === 'store'` | `requireRole('store')` |

## 📱 **Responsive Design**
Tutte le view sono responsive e ottimizzate per:
- Desktop (1200px+)
- Tablet (768px - 1199px)  
- Mobile (< 768px)
