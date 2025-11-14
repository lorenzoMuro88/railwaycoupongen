<!-- 41fc81a4-e5cd-4623-bd42-374a42658c65 2eeb761c-3bf5-4079-8ab9-b3cfb59cad9c -->
# Miglioramenti Struttura Progetto per AI/LLM

## Obiettivo

Ottimizzare la struttura del progetto FLYCouponGen per facilitare la comprensione e la modifica da parte di LLM dedicati al coding, aggiungendo documentazione formale, type definitions e pattern chiari.

## Analisi Situazione Attuale

**Punti di Forza:**

- ✅ Architettura modulare ben organizzata (routes/, middleware/, utils/)
- ✅ Documentazione esistente in `docs/` (ARCHITECTURE.md, API_REFERENCE.md)
- ✅ Alcuni file hanno già JSDoc (es. `utils/routeHelper.js`, `middleware/auth.js`)
- ✅ Naming conventions generalmente chiare

**Aree di Miglioramento:**

- ⚠️ JSDoc inconsistente: molti file mancano di documentazione formale
- ⚠️ Mancano type definitions per oggetti complessi (req.tenant, req.session.user, etc.)
- ⚠️ Funzioni senza documentazione di parametri e valori di ritorno
- ⚠️ Logica complessa senza commenti esplicativi
- ⚠️ Nessun file centralizzato per schema database
- ⚠️ Variabili d'ambiente documentate solo in README/env.example

## Piano di Implementazione

### Fase 1: Type Definitions e JSDoc Base (Priorità Alta) ✅ COMPLETATA

**File da creare/modificare:**

1. **`LLM_MD/TYPES.md`** (NUOVO) ✅ CREATO
   - ✅ Definizioni JSDoc per oggetti comuni:
     - ✅ `@typedef {Object} Tenant`
     - ✅ `@typedef {Object} SessionUser`
     - ✅ `@typedef {Object} Campaign`
     - ✅ `@typedef {Object} Coupon`
     - ✅ `@typedef {Object} User`
     - ✅ `@typedef {Object} Product`
     - ✅ `@typedef {Object} FormLink`
     - ✅ `@typedef {Object} AuthUser`
     - ✅ `@typedef {Object} ExpressRequest` (esteso con tenant, session)
     - ✅ `@typedef {Object} FormConfig`
     - ✅ `@typedef {Object} EmailTemplate`
     - ✅ `@typedef {Object} BrandSettings`
   - ✅ Riferimento centralizzato per tutti i tipi del progetto
   - ✅ Esempi di utilizzo per ogni tipo

2. **`utils/routeHelper.js`** (MIGLIORARE) ✅ COMPLETATO
   - ✅ JSDoc completo aggiunto:
     - ✅ Esempi dettagliati per registerAdminRoute e getTenantId
     - ✅ Documentazione errori possibili
     - ✅ Link a LLM_MD/TYPES.md
     - ✅ Descrizione comportamento per entrambi i tipi di route

3. **`middleware/auth.js`** (MIGLIORARE) ✅ COMPLETATO
   - ✅ JSDoc completo aggiunto:
     - ✅ Documentazione completa parametri per tutte le funzioni
     - ✅ Esempi di utilizzo per ogni middleware
     - ✅ Comportamento per diversi scenari documentato
     - ✅ Documentazione errori HTTP (403, etc.)

4. **`middleware/tenant.js`** (MIGLIORARE) ✅ COMPLETATO
   - ✅ JSDoc completo aggiunto:
     - ✅ `@param {ExpressRequest} req` con riferimento a ExpressRequest esteso
     - ✅ `@throws` per errori possibili (404, 500, 403)
     - ✅ Esempi di flusso completi
     - ✅ Documentazione ordine middleware

### Fase 2: Documentazione Moduli Routes (Priorità Alta) ⚠️ PARZIALMENTE COMPLETATA

**File da modificare:**

1. **`routes/admin/campaigns.js`** ✅ COMPLETATO
   - ✅ JSDoc aggiunto:
     - ✅ `setupCampaignsRoutes()` - documentazione generale completa
     - ✅ `autoDeactivateExpiredCampaigns()` - parametri, side effects
     - ✅ `generateId()` - helper function documentato
     - ✅ Route handlers principali documentati con:
       - ✅ `@route` con path completo
       - ✅ `@method` HTTP
       - ✅ `@param {Object} req.body` con struttura dati
       - ✅ `@returns {Object}` con struttura response
       - ✅ `@throws` con codici errore
   - ✅ Pattern completo stabilito per altri file routes

2. **`routes/admin/users.js`** ⚠️ DA FARE
   - Stessa struttura di campaigns.js
   - Documentare query parameters
   - Documentare filtri disponibili
   - Pattern stabilito in campaigns.js può essere seguito

3. **`routes/admin/coupons.js`** ⚠️ DA FARE
   - Documentazione completa endpoint ricerca
   - Documentazione paginazione
   - Pattern stabilito in campaigns.js può essere seguito

4. **`routes/admin/analytics.js`** ⚠️ DA FARE
   - Documentare query parameters complessi
   - Documentare struttura response per ogni aggregazione
   - Pattern stabilito in campaigns.js può essere seguito

5. **`routes/admin/settings.js`** ⚠️ DA FARE
   - Documentare upload constraints
   - Documentare configurazione email tenant-specific
   - Pattern stabilito in campaigns.js può essere seguito

6. **`routes/admin/products.js`** ⚠️ DA FARE
   - Documentare validazione SKU
   - Documentare calcolo margin_price
   - Pattern stabilito in campaigns.js può essere seguito

7. **`routes/admin/auth-users.js`** ⚠️ DA FARE
   - Documentare regole autorizzazione
   - Documentare protezioni sicurezza
   - Pattern stabilito in campaigns.js può essere seguito

8. **`routes/auth.js`** ⚠️ DA FARE
   - Documentare flusso autenticazione
   - Documentare gestione password
   - Pattern stabilito in campaigns.js può essere seguito

### Fase 3: Documentazione Utils (Priorità Media) ✅ COMPLETATA

**File da modificare:**

1. **`utils/db.js`** ✅ COMPLETATO
   - ✅ JSDoc aggiunto:
     - ✅ `getDb()` - singleton pattern, migrations, configurazione completa
     - ✅ `createBaseTables()` - schema creato, tabelle documentate
     - ✅ `runMigrations()` - processo migrazione documentato
   - ✅ Riferimento a LLM_MD/DATABASE_SCHEMA.md

2. **`utils/email.js`** ✅ COMPLETATO
   - ✅ JSDoc completo aggiunto:
     - ✅ Tutti i parametri documentati
     - ✅ Fallback chain documentata (Mailgun → SMTP → JSON)
     - ✅ Esempi configurazione per ogni funzione
     - ✅ Riferimento a LLM_MD/CONFIGURATION.md

3. **`utils/qrcode.js`** ⚠️ DA FARE (Priorità Bassa)
   - ✅ Ha JSDoc base esistente
   - Migliorare con esempi più dettagliati (opzionale)

4. **`utils/logger.js`** ✅ COMPLETATO
   - ✅ Livelli log documentati (debug, info, warn, error)
   - ✅ Contesto request documentato (withRequest)
   - ✅ Esempi utilizzo completi
   - ✅ Configurazione development/production documentata

### Fase 4: Documentazione Database Schema (Priorità Media) ✅ COMPLETATA

**File da creare:**

1. **`LLM_MD/DATABASE_SCHEMA.md`** (NUOVO) ✅ CREATO
   - ✅ Schema completo tutte le tabelle documentato
   - ✅ Relazioni foreign keys documentate
   - ✅ Indici e loro scopo documentati (inclusi indici compositi)
   - ✅ Vincoli unique documentati (inclusi tenant-scoped)
   - ✅ Esempi query comuni inclusi
   - ✅ Pattern tenant isolation documentati con esempi corretti/errati
   - ✅ Query comuni per operazioni frequenti
   - ✅ Note importanti su SQLite, booleani, date, JSON fields

### Fase 5: Documentazione Configurazione (Priorità Bassa) ✅ COMPLETATA

**File da creare/modificare:**

1. **`LLM_MD/CONFIGURATION.md`** (NUOVO) ✅ CREATO
   - ✅ Tutte le variabili d'ambiente documentate:
     - ✅ Descrizione completa per ogni variabile
     - ✅ Valore default specificato
     - ✅ Esempi pratici inclusi
     - ✅ Quando necessarie documentato
   - ✅ Configurazione email providers (Mailgun, SMTP, JSON)
   - ✅ Configurazione sicurezza (rate limiting, reCAPTCHA)
   - ✅ Configurazione tenant
   - ✅ Configurazione per ambiente (sviluppo/produzione)
   - ✅ Checklist produzione

2. **`env.example`** ⚠️ DA FARE (Priorità Bassa)
   - Aggiungere commenti inline più dettagliati
   - Raggruppare per categoria
   - Link a LLM_MD/CONFIGURATION.md

### Fase 6: Commenti Strategici e Pattern (Priorità Bassa) ⚠️ DA FARE

**File da modificare:**

1. **`server.js`**
   - Aggiungere commenti sezioni principali
   - Documentare middleware order (importante!)
   - Documentare route registration order

2. **Tutti i file route**
   - Aggiungere commenti per logica complessa
   - Documentare "why" per decisioni non ovvie
   - Esempi: gestione tenant isolation, rate limiting logic

### Fase 7: File Index/README Moduli (Priorità Bassa) ✅ COMPLETATA

**File da creare:**

1. **`routes/README.md`** ✅ CREATO
   - ✅ Panoramica struttura routes completa
   - ✅ Pattern comuni documentati (route registration, tenant isolation, error handling)
   - ✅ Come aggiungere nuove route con esempi
   - ✅ Documentazione JSDoc standard
   - ✅ Panoramica moduli routes

2. **`middleware/README.md`** ✅ CREATO
   - ✅ Panoramica middleware completa
   - ✅ Ordine di applicazione documentato (critico!)
   - ✅ Come creare nuovo middleware con template
   - ✅ Documentazione tutti i middleware disponibili
   - ✅ Best practices

3. **`utils/README.md`** ✅ CREATO
   - ✅ Panoramica utilities completa
   - ✅ Quando usare quale utility con esempi
   - ✅ Documentazione tutte le funzioni principali
   - ✅ Best practices per utilizzo

4. **`LLM_MD/README.md`** ✅ CREATO (Bonus)
   - ✅ Spiegazione scopo cartella LLM_MD
   - ✅ Come utilizzare i documenti
   - ✅ Convenzioni documentazione

## Standard JSDoc da Seguire

### Template Funzione Base

```javascript
/**
 * [Breve descrizione funzione]
 * 
 * [Descrizione dettagliata se necessaria]
 * 
 * @param {Type} paramName - Descrizione parametro
 * @param {Type} [optionalParam] - Parametro opzionale
 * @returns {Type} Descrizione valore ritorno
 * @throws {Error} Quando viene lanciato errore
 * 
 * @example
 * // Esempio utilizzo
 * const result = functionName(param1, param2);
 */
```

### Template Route Handler

```javascript
/**
 * [HTTP Method] [Path] - [Descrizione endpoint]
 * 
 * [Descrizione dettagliata comportamento]
 * 
 * @route {GET|POST|PUT|DELETE} /api/admin/resource
 * @middleware requireAdmin, tenantLoader
 * @param {Object} req.body - Request body structure
 * @param {Object} req.query - Query parameters
 * @param {Object} req.params - URL parameters
 * @returns {Object} Response structure
 * @throws {400} Bad Request - [descrizione]
 * @throws {403} Forbidden - [descrizione]
 * @throws {500} Internal Server Error
 */
```

### Template Type Definition

```javascript
/**
 * @typedef {Object} TypeName
 * @property {string} fieldName - Descrizione campo
 * @property {number} [optionalField] - Campo opzionale
 */
```

## Benefici Attesi

1. **Comprensione Migliorata**: LLM possono capire struttura dati senza inferenza
2. **Modifiche Più Accurate**: Type information riduce errori
3. **Manutenzione Facilitata**: Documentazione inline sempre disponibile
4. **Onboarding Veloce**: Nuovi sviluppatori/AI capiscono rapidamente
5. **Refactoring Sicuro**: Type definitions aiutano identificare dipendenze

## Priorità Implementazione

1. **Alta**: ✅ Fase 1 (Type Definitions) + ⚠️ Fase 2 (Routes Documentation - parzialmente completata)
2. **Media**: ✅ Fase 3 (Utils) + ✅ Fase 4 (Database Schema)
3. **Bassa**: ✅ Fase 5 (Config) + ⚠️ Fase 6 (Comments - da fare) + ✅ Fase 7 (README)

## Stato Completamento

### ✅ Completate (100%)
- **Fase 1**: Type Definitions e JSDoc Base
- **Fase 3**: Documentazione Utils
- **Fase 4**: Documentazione Database Schema
- **Fase 5**: Documentazione Configurazione
- **Fase 7**: File Index/README Moduli

### ⚠️ Parzialmente Completate
- **Fase 2**: Documentazione Moduli Routes
  - ✅ `routes/admin/campaigns.js` - Completamente documentato con pattern stabilito
  - ⚠️ Altri file routes - Pattern stabilito, da applicare agli altri file:
    - `routes/admin/users.js`
    - `routes/admin/coupons.js`
    - `routes/admin/analytics.js`
    - `routes/admin/settings.js`
    - `routes/admin/products.js`
    - `routes/admin/auth-users.js`
    - `routes/auth.js`

### ⚠️ Da Completare (Priorità Bassa)
- **Fase 6**: Commenti Strategici e Pattern
  - `server.js` - Commenti sezioni principali, middleware order
  - File routes - Commenti logica complessa

### 📝 Note Implementazione

- ✅ Tutti i file sono stati creati in `LLM_MD/` invece di `docs/` come specificato inizialmente (come richiesto dall'utente)
- ✅ Pattern JSDoc completo stabilito in `campaigns.js` può essere applicato agli altri file routes
- ⚠️ `utils/qrcode.js` ha già JSDoc base, miglioramenti sono opzionali (priorità bassa)
- ✅ `LLM_MD/README.md` creato per spiegare scopo e utilizzo della cartella
- ✅ Nessun errore di linting rilevato nei file modificati

## Prossimi Passi

1. Applicare pattern JSDoc di `campaigns.js` agli altri file routes (Fase 2)
2. Aggiungere commenti strategici a `server.js` (Fase 6)
3. Migliorare `env.example` con commenti più dettagliati (Fase 5)
4. Opzionale: Migliorare JSDoc di `utils/qrcode.js` (Fase 3)

