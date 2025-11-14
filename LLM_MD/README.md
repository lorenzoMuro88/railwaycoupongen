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

## Come Utilizzare

### Per LLM/AI Coding Assistants

Quando un LLM analizza il codice:

1. **Per capire struttura dati**: Consulta `TYPES.md` per definizioni tipo
2. **Per query database**: Consulta `DATABASE_SCHEMA.md` per schema e pattern
3. **Per configurazione**: Consulta `CONFIGURATION.md` per variabili d'ambiente
4. **Per architettura**: Consulta `docs/ARCHITECTURE.md` (nella cartella docs/)

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

Mantenere la documentazione sincronizzata con il codice è importante per garantire accuratezza.

## Riferimenti

- Vedi `docs/ARCHITECTURE.md` per architettura generale
- Vedi `docs/API_REFERENCE.md` per documentazione API
- Vedi `README.md` (root) per panoramica progetto

