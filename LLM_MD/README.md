# LLM_MD - Documentazione per AI/LLM

Questa cartella contiene documentazione strutturata specificamente progettata per facilitare la comprensione del codice da parte di LLM (Large Language Models) dedicati al coding.

## Scopo

I documenti in questa cartella forniscono:
- **Type Definitions**: Definizioni JSDoc centralizzate per tutti i tipi del progetto
- **Database Schema**: Documentazione completa dello schema database
- **Configuration Reference**: Riferimento completo alle variabili d'ambiente

## Documenti Disponibili

### TYPES.md
Definizioni JSDoc per tutti i tipi utilizzati nel progetto:
- `Tenant` - Oggetto tenant
- `SessionUser` - Utente autenticato nella sessione
- `Campaign` - Campagna promozionale
- `Coupon` - Coupon generato
- `User` - Utente finale
- `Product` - Prodotto
- `FormLink` - Link parametrico form
- `AuthUser` - Utente autenticato sistema
- `ExpressRequest` - Estensione Express Request
- E altri...

**Utilizzo:** Referenziare nei commenti JSDoc usando `@param {Tenant} tenant` o `@type {Campaign}`

### DATABASE_SCHEMA.md
Documentazione completa dello schema database SQLite:
- Struttura di tutte le tabelle
- Relazioni e foreign keys
- Indici e loro scopo
- Vincoli unique
- Pattern tenant isolation
- Query comuni ed esempi

**Utilizzo:** Consultare per capire struttura database, relazioni, e pattern di query

### CONFIGURATION.md
Riferimento completo alle variabili d'ambiente:
- Tutte le variabili configurabili
- Descrizione, tipo, default, esempi
- Quando sono necessarie
- Configurazione per ambiente (sviluppo/produzione)
- Checklist produzione

**Utilizzo:** Consultare per capire configurazione sistema e variabili d'ambiente

### API_ENDPOINTS.md
Riferimento completo di tutti gli endpoint API:
- Endpoint pubblici (form submission, campagne)
- Endpoint autenticazione (login, logout, signup)
- Endpoint admin (campagne, utenti, coupon, analytics, prodotti, settings)
- Endpoint store (riscatto coupon)
- Esempi request/response per ogni endpoint
- Codici di errore standard

**Utilizzo:** Consultare per capire struttura API, parametri richiesti, e formati response

**Nota:** Questo file può essere generato automaticamente da JSDoc usando `npm run docs:generate`

### COMMON_PATTERNS.md
Pattern comuni e best practices riutilizzabili:
- Pattern tenant isolation
- Pattern error handling
- Pattern route registration
- Pattern logging
- Pattern response format
- Pattern database operations
- Pattern middleware chain
- Pattern email sending
- Pattern sanitization
- Pattern validation

**Utilizzo:** Consultare per capire pattern comuni e best practices del progetto

### EXAMPLES.md
Esempi pratici completi di utilizzo:
- Esempi route handler completi
- Esempi middleware
- Esempi database operations
- Esempi email sending
- Esempi form submission
- Esempi rate limiting
- Esempi QR code generation
- Esempi sanitization
- Esempi validation

**Utilizzo:** Consultare per vedere esempi pratici di implementazione

### FLOW_DIAGRAMS.md
Diagrammi di flusso per operazioni complesse:
- Login flow
- Coupon generation flow
- Tenant isolation flow
- Campaign creation flow
- Email sending flow
- Coupon redemption flow

**Utilizzo:** Consultare per capire flusso di esecuzione di operazioni complesse

### JSDOC_TEMPLATES.md
Template standardizzati per documentazione JSDoc:
- Template per route handler
- Template per utility function
- Template per middleware
- Template per database function
- Template per type definition
- Template per class/module header
- Tag JSDoc standard
- Convenzioni naming
- Best practices

**Utilizzo:** Consultare per standardizzare documentazione JSDoc nel progetto

### REPORT_LEGGIBILITA.md
Report completo sulla leggibilità del progetto per LLM:
- Analisi stato attuale
- Punti di forza e aree di miglioramento
- Priorità miglioramenti
- Checklist implementazione
- Metriche proposte
- Processo di mantenimento

**Utilizzo:** Consultare per valutare e migliorare leggibilità progetto per LLM

## Come Utilizzare

### Per LLM/AI Coding Assistants

Quando un LLM analizza il codice:

1. **Per capire struttura dati**: Consulta `TYPES.md` per definizioni tipo
2. **Per query database**: Consulta `DATABASE_SCHEMA.md` per schema e pattern
3. **Per configurazione**: Consulta `CONFIGURATION.md` per variabili d'ambiente
4. **Per endpoint API**: Consulta `API_ENDPOINTS.md` per riferimento completo endpoint
5. **Per pattern comuni**: Consulta `COMMON_PATTERNS.md` per best practices
6. **Per esempi pratici**: Consulta `EXAMPLES.md` per esempi codice completo
7. **Per flussi complessi**: Consulta `FLOW_DIAGRAMS.md` per diagrammi di flusso
8. **Per documentare codice**: Consulta `JSDOC_TEMPLATES.md` per template standard
9. **Per architettura**: Consulta `docs/ARCHITECTURE.md` (nella cartella docs/)

### Per Sviluppatori

I documenti in questa cartella sono complementari alla documentazione in `docs/`:
- `docs/` - Documentazione generale progetto (ARCHITECTURE.md, API_REFERENCE.md, etc.)
- `LLM_MD/` - Documentazione strutturata per AI/LLM (types, schema, config)

## Convenzioni

- Tutti i tipi sono definiti in formato JSDoc standard
- Gli esempi sono sempre inclusi quando utile
- I pattern comuni sono documentati con esempi pratici
- I riferimenti incrociati sono usati per collegare documenti correlati

## Aggiornamenti

Quando si aggiungono/modificano:
- **Tipi**: Aggiornare `TYPES.md`
- **Schema database**: Aggiornare `DATABASE_SCHEMA.md`
- **Configurazione**: Aggiornare `CONFIGURATION.md`
- **Endpoint API**: Aggiornare `API_ENDPOINTS.md` (o rigenerare con `npm run docs:generate`)
- **Pattern comuni**: Aggiornare `COMMON_PATTERNS.md` se si aggiungono nuovi pattern
- **Esempi**: Aggiornare `EXAMPLES.md` se si aggiungono nuovi esempi significativi
- **Flussi**: Aggiornare `FLOW_DIAGRAMS.md` se si modificano flussi complessi

Mantenere la documentazione sincronizzata con il codice è importante per garantire accuratezza.

## Riferimenti

- Vedi `docs/ARCHITECTURE.md` per architettura generale
- Vedi `docs/API_REFERENCE.md` per documentazione API
- Vedi `README.md` (root) per panoramica progetto


