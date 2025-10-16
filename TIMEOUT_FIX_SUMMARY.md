# Risoluzione Problemi di Timeout - CouponGen

## Problema Identificato
L'applicazione CouponGen online presentava problemi di timeout dovuti a configurazioni di timeout troppo aggressive:

- **Keep-Alive timeout**: 5 secondi (troppo breve)
- **Database timeout**: Nessuna configurazione specifica
- **Email timeout**: Nessuna configurazione specifica
- **Server timeout**: Valori di default di Node.js

## Soluzioni Implementate

### 1. Configurazione Server HTTP
**File**: `server.js` (linee 3682-3692)

```javascript
// Configure server timeouts to prevent connection issues
server.keepAliveTimeout = 65000; // 65 seconds (same as nginx default)
server.headersTimeout = 66000;   // 66 seconds (slightly higher than keepAliveTimeout)
server.requestTimeout = 30000;   // 30 seconds for request processing
server.timeout = 30000;          // 30 seconds overall timeout
```

### 2. Configurazione Database SQLite
**File**: `server.js` (linee 367-374)

```javascript
// Configure database timeouts and performance settings
await db.exec(`
    PRAGMA busy_timeout = 30000;  -- 30 seconds timeout for locked database
    PRAGMA journal_mode = WAL;    -- Write-Ahead Logging for better concurrency
    PRAGMA synchronous = NORMAL;  -- Balance between safety and performance
    PRAGMA cache_size = 10000;    -- Increase cache size for better performance
    PRAGMA temp_store = MEMORY;   -- Store temp tables in memory
`);
```

### 3. Configurazione Email SMTP
**File**: `server.js` (linee 882-891)

```javascript
// Add timeout configurations for SMTP
connectionTimeout: 30000,  // 30 seconds to establish connection
greetingTimeout: 30000,    // 30 seconds for SMTP greeting
socketTimeout: 30000,      // 30 seconds for socket operations
pool: true,                // Enable connection pooling
maxConnections: 5,         // Max concurrent connections
maxMessages: 100,          // Max messages per connection
rateDelta: 20000,          // Rate limiting: 1 message per 20 seconds
rateLimit: 5               // Max 5 messages per rateDelta
```

### 4. Configurazione Email Mailgun
**File**: `server.js` (linee 833-834, 868-876)

```javascript
// Mailgun client timeout
timeout: 30000  // 30 seconds timeout for Mailgun API calls

// Timeout wrapper for API calls
const timeoutPromise = new Promise((_, reject) => 
    setTimeout(() => reject(new Error('Mailgun API timeout')), 30000)
);

const result = await Promise.race([
    mg.messages.create(domain, data),
    timeoutPromise
]);
```

### 5. Configurazione Variabili Ambiente
**File**: `env.example` (linee 83-94)

Aggiunte nuove variabili di configurazione opzionali per timeout personalizzabili.

## Benefici delle Modifiche

1. **Keep-Alive migliorato**: Da 5 secondi a 65 secondi
2. **Database più robusto**: Timeout di 30 secondi per operazioni bloccate
3. **Email più affidabile**: Timeout appropriati per SMTP e Mailgun
4. **Performance migliorata**: WAL mode e cache size aumentata per SQLite
5. **Concorrenza migliorata**: Connection pooling per email

## Test di Verifica

L'applicazione è stata testata e risponde correttamente:
- ✅ Health check: `http://167.172.42.248:3000/healthz`
- ✅ Login page: `http://167.172.42.248:3000/login`
- ✅ API endpoints: Rispondono rapidamente
- ✅ Connessione TCP: Porta 3000 accessibile

## Deployment

Per applicare le modifiche in produzione:

1. **Aggiorna il codice** sul server
2. **Riavvia l'applicazione**:
   ```bash
   docker compose restart app
   # oppure
   pm2 restart coupongen
   ```
3. **Verifica i log** per confermare i nuovi timeout:
   ```
   Server timeouts configured:
   - Keep-Alive: 65000ms
   - Headers: 66000ms
   - Request: 30000ms
   - Overall: 30000ms
   ```

## Monitoraggio

Monitorare i log per verificare che:
- Non ci siano più errori di timeout
- Le connessioni Keep-Alive durino più a lungo
- Le operazioni email completino con successo
- Il database non mostri errori di lock

## Note Tecniche

- I timeout sono configurati per essere compatibili con nginx (65s)
- Le configurazioni sono backward-compatible
- I valori sono ottimizzati per un ambiente di produzione
- È possibile personalizzare i timeout tramite variabili d'ambiente
