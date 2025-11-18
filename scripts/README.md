# Scripts Module - FLYCouponGen

Panoramica di tutti gli script disponibili nel progetto FLYCouponGen.

## Categorie Script

### 🧪 Testing Scripts

Script per eseguire test automatici del progetto.

#### Test Suite Principali

- **`test-all.js`** - Esegue tutti i test (chiamato via `npm run test:all`)
- **`run-tests-with-coverage.js`** - Esegue test con coverage report
- **`analyze-coverage.js`** - Analizza coverage e genera report

#### Test Moduli Specifici

- **`test-csrf.js`** - Test CSRF protection (`npm run test:csrf`)
- **`test-tenant-isolation.js`** - Test isolamento tenant (`npm run test:tenant-isolation`)
- **`test-authorization.js`** - Test autorizzazione (`npm run test:authorization`)
- **`test-store.js`** - Test funzionalità store (`npm run test:store`)
- **`test-superadmin.js`** - Test operazioni superadmin (`npm run test:superadmin`)
- **`test-admin-extended.js`** - Test endpoint admin estesi (`npm run test:admin-extended`)

#### Test Endpoint Specifici

- **`test-products.js`** - Test suite completa endpoint products (`npm run test:products`)
- **`test-settings.js`** - Test suite endpoint settings (`npm run test:settings`)
- **`test-public-endpoints.js`** - Test endpoint pubblici (`npm run test:public`)
- **`test-store-complete.js`** - Test suite completa store (`npm run test:store-complete`)
- **`test-signup-auth.js`** - Test signup e auth pages (`npm run test:signup-auth`)
- **`test-misc-endpoints.js`** - Test endpoint vari (`npm run test:misc`)
- **`test-remaining-endpoints.js`** - Test endpoint rimanenti (`npm run test:remaining`)
- **`test-campaigns-list-endpoint.js`** - Test endpoint campaigns list (`npm run test:campaigns-list`)
- **`test-form-links.js`** - Test form links parametrici (`npm run test:form-links`)

#### Test Middleware

- **`test-middleware-rateLimit.js`** - Test middleware rate limiting (`npm run test:middleware-rateLimit`)
- **`test-middleware-validation.js`** - Test middleware validazione (`npm run test:middleware-validation`)

#### Test Utilities

- **`test-utils-qrcode.js`** - Test utility QR code (`npm run test:utils-qrcode`)
- **`test-utils-sanitize.js`** - Test utility sanitizzazione (`npm run test:utils-sanitize`)
- **`test-utils-validators.js`** - Test utility validatori (`npm run test:utils-validators`)
- **`test-utils-logger.js`** - Test utility logger (`npm run test:utils-logger`)
- **`test-utils-email.js`** - Test utility email (`npm run test:utils-email`)
- **`test-utils-routeHelper.js`** - Test utility route helper (`npm run test:utils-routeHelper`)

#### Test Sicurezza

- **`test-security-headers.js`** - Test security headers HTTP (`npm run test:security-headers`)
- **`test-https-enforcement.js`** - Test enforcement HTTPS (`npm run test:https-enforcement`)
- **`test-session-security.js`** - Test sicurezza sessioni (`npm run test:session-security`)
- **`test-xss-protection.js`** - Test protezione XSS (`npm run test:xss-protection`)
- **`test-password-policy.js`** - Test policy password (`npm run test:password-policy`)
- **`test-dependency-security.js`** - Test vulnerabilità dipendenze (`npm run test:dependency-security`)
- **`test-cors.js`** - Test configurazione CORS (`npm run test:cors`)

#### Test Funzionalità

- **`test-input-validation.js`** - Test validazione input (`npm run test:input-validation`)
- **`test-error-handling.js`** - Test gestione errori (`npm run test:error-handling`)
- **`test-health-checks.js`** - Test health checks (`npm run test:health-checks`)
- **`test-tenant-auth-users.js`** - Test gestione auth-users tenant (`npm run test:tenant-auth-users`)
- **`test-tenant-email-config.js`** - Test configurazione email tenant (`npm run test:tenant-email`)
- **`test-audit-logging.js`** - Test audit logging (`npm run test:audit-logging`)
- **`test-jsdoc-documentation.js`** - Test documentazione JSDoc (`npm run test:jsdoc-documentation`)

#### Test Database

- **`test-restore.js`** - Test restore database

### 🗄️ Database Scripts

Script per gestione database.

#### `backup-db.js`
Backup e restore database SQLite.

**Utilizzo:**
```bash
# Backup database
npm run backup:db

# Lista backup disponibili
npm run backup:list

# Cleanup backup vecchi
npm run backup:cleanup
```

**Funzionalità:**
- Crea backup timestamped del database
- Lista tutti i backup disponibili
- Cleanup automatico backup vecchi (configurabile)

#### `clean-db.js`
Pulizia database (rimuove dati di test).

**Utilizzo:**
```bash
npm run clean:db
```

**⚠️ Attenzione:** Rimuove tutti i dati dal database. Usare solo in sviluppo.

#### `cleanup-test-tenants.js`
Pulizia tenant di test creati durante testing.

**Utilizzo:**
```bash
node scripts/cleanup-test-tenants.js
```

**Funzionalità:**
- Rimuove tenant con slug che iniziano con "test-"
- Utile per cleanup dopo test automatici

#### `migrate-tenant-email.js`
Migrazione configurazione email tenant.

**Utilizzo:**
```bash
npm run db:migrate-email
```

**Funzionalità:**
- Migra configurazione email da formato vecchio a nuovo
- Aggiorna tenant con nuova struttura email

#### `reset-superadmin.js`
Verifica e resetta le credenziali del superadmin.

**Utilizzo:**
```bash
# Verifica stato superadmin
node scripts/reset-superadmin.js

# Resetta password e attiva superadmin
node scripts/reset-superadmin.js --reset

# Verifica/resetta con username personalizzato
node scripts/reset-superadmin.js --username=myadmin --reset
```

**Funzionalità:**
- Verifica se l'utente superadmin esiste nel database
- Mostra stato dell'utente (attivo/disattivo, ultimo login, ecc.)
- Resetta la password usando `SUPERADMIN_PASSWORD` dalla variabile d'ambiente
- Attiva automaticamente l'utente se è disattivato
- Utile per troubleshooting problemi di login su Railway

**⚠️ Requisiti:**
- `SUPERADMIN_PASSWORD` deve essere configurata nelle variabili d'ambiente per il reset

#### `delete-all-users.js`
Elimina tutti gli utenti dal database per permettere la ricreazione da zero.

**Utilizzo:**
```bash
# Eliminazione con conferma interattiva
npm run delete:all-users

# Eliminazione senza conferma (utile per script automatizzati)
npm run delete:all-users-confirm
```

**Funzionalità:**
- Elimina tutti gli utenti dalla tabella `auth_users`
- Mostra l'elenco degli utenti che verranno eliminati prima della conferma
- Al prossimo avvio del server, gli utenti di default verranno ricreati automaticamente
- Utile per ripulire il database dopo una build completa da zero

**⚠️ ATTENZIONE:**
- Elimina TUTTI gli utenti (superadmin, admin, store, ecc.)
- Gli utenti verranno ricreati automaticamente al prossimo avvio solo se:
  - La tabella `auth_users` è vuota
  - `SUPERADMIN_PASSWORD` e `STORE_PASSWORD` sono configurate nelle variabili d'ambiente

**Requisiti:**
- `SUPERADMIN_PASSWORD` e `STORE_PASSWORD` devono essere configurate prima di riavviare il server

### 📚 Documentazione Scripts

#### `generate-api-docs.js`
Genera documentazione API da JSDoc comments.

**Utilizzo:**
```bash
npm run docs:generate
# oppure
node scripts/generate-api-docs.js [output-file]
```

**Output:** `docs/API_REFERENCE_GENERATED.md` (default)

**Funzionalità:**
- Estrae JSDoc da file route
- Genera documentazione markdown API
- Può essere integrato in CI/CD

### 🖥️ Server Control Scripts

#### `server-control.js`
Controllo server (start, stop, restart, status).

**Utilizzo:**
```bash
npm run server:start    # Avvia server
npm run server:stop     # Ferma server
npm run server:restart  # Riavvia server
npm run server:status   # Status server
```

**Funzionalità:**
- Gestione processo server
- Status check
- Restart controllato

### 🔍 Analysis Scripts

#### `analyze-coverage.js`
Analizza coverage test e genera report.

**Utilizzo:**
```bash
npm run coverage
```

**Output:** Report HTML e JSON coverage

**Funzionalità:**
- Analizza coverage codice
- Genera report HTML visualizzabile
- Identifica aree non coperte da test

---

## Utilizzo Scripts

### Eseguire Test

```bash
# Tutti i test
npm run test:all

# Test specifico
npm run test:csrf
npm run test:tenant-isolation

# Test con coverage
npm run test:coverage
```

### Backup Database

```bash
# Crea backup
npm run backup:db

# Lista backup
npm run backup:list

# Cleanup backup vecchi
npm run backup:cleanup
```

### Generare Documentazione

```bash
# Genera documentazione API
npm run docs:generate
```

### Controllo Server

```bash
# Avvia server
npm run server:start

# Status server
npm run server:status
```

---

## Struttura Script Test

Tutti gli script di test seguono una struttura comune:

```javascript
// Setup
const BASE_URL = 'http://localhost:3000';
// ... configurazione

// Test cases
async function testCase1() {
    // Test logic
}

// Run tests
async function runTests() {
    try {
        await testCase1();
        // ... altri test
        console.log('✅ All tests passed');
    } catch (error) {
        console.error('❌ Test failed:', error);
        process.exit(1);
    }
}

runTests();
```

---

## Best Practices

1. **Sempre verificare output** - Gli script possono fallire silenziosamente
2. **Usare npm scripts** - Preferire `npm run` invece di chiamare direttamente node
3. **Backup prima di operazioni distruttive** - Usare `backup:db` prima di `clean:db`
4. **Test in ambiente isolato** - Non eseguire test su database produzione

---

## Aggiungere Nuovo Script

### Template Script Test

```javascript
#!/usr/bin/env node
/**
 * Test: [Descrizione test]
 * 
 * [Descrizione dettagliata cosa testa]
 */

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';

async function testFeature() {
    // Test logic
    const response = await fetch(`${BASE_URL}/api/endpoint`);
    if (response.status !== 200) {
        throw new Error('Test failed');
    }
}

async function runTests() {
    try {
        await testFeature();
        console.log('✅ All tests passed');
    } catch (error) {
        console.error('❌ Test failed:', error);
        process.exit(1);
    }
}

runTests();
```

### Template Script Utility

```javascript
#!/usr/bin/env node
/**
 * [Nome Script] - [Descrizione]
 * 
 * [Descrizione dettagliata]
 * 
 * Usage:
 *   node scripts/script-name.js [options]
 */

const fs = require('fs');
const path = require('path');

async function main() {
    // Script logic
}

main().catch(console.error);
```

---

## Riferimenti

- Vedi `package.json` per tutti gli script disponibili
- Vedi `docs/ARCHITECTURE.md` per architettura progetto
- Vedi `LLM_MD/README.md` per documentazione LLM

---

*Documentazione aggiornata: 2024*

