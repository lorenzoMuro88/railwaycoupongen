# Reset Credenziali SuperAdmin su Railway

## Problema

Se il login del superadmin non funziona su Railway, potrebbe essere dovuto a:

1. **Utente disattivato**: L'utente superadmin potrebbe essere stato creato con `is_active = 0`
2. **Password non corrispondente**: La password nel database potrebbe non corrispondere a quella configurata in `SUPERADMIN_PASSWORD`
3. **Variabile d'ambiente non configurata**: `SUPERADMIN_PASSWORD` potrebbe non essere configurata correttamente su Railway

## Soluzione

### Opzione 1: Usare lo script di reset (Raccomandato)

1. **Accedi alla console Railway**:
   - Vai su Railway Dashboard → Il tuo progetto → Deployments
   - Clicca su "View Logs" o "Open Shell"

2. **Esegui lo script di verifica**:
   ```bash
   node scripts/reset-superadmin.js
   ```
   
   Questo mostrerà lo stato attuale del superadmin.

3. **Se necessario, resetta le credenziali**:
   ```bash
   node scripts/reset-superadmin.js --reset
   ```
   
   ⚠️ **IMPORTANTE**: Assicurati che `SUPERADMIN_PASSWORD` sia configurata nelle variabili d'ambiente di Railway prima di eseguire il reset!

### Opzione 2: Verificare variabili d'ambiente su Railway

1. **Verifica che `SUPERADMIN_PASSWORD` sia configurata**:
   - Vai su Railway Dashboard → Il tuo progetto → Variables
   - Cerca `SUPERADMIN_PASSWORD`
   - Se non esiste, aggiungila con una password sicura (min 12 caratteri, maiuscole, minuscole, numeri, caratteri speciali)

2. **Riavvia il servizio**:
   - Dopo aver configurato la variabile, riavvia il deployment su Railway
   - Gli utenti di default vengono creati solo se la tabella `auth_users` è vuota

### Opzione 3: Reset manuale via SQL (Avanzato)

Se hai accesso diretto al database:

```sql
-- Verifica stato superadmin
SELECT id, username, user_type, is_active, created_at, last_login 
FROM auth_users 
WHERE username = 'admin' AND user_type = 'superadmin';

-- Attiva superadmin (se disattivato)
UPDATE auth_users 
SET is_active = 1 
WHERE username = 'admin' AND user_type = 'superadmin';

-- NOTA: Per resettare la password, devi generare un hash bcrypt
-- È più semplice usare lo script reset-superadmin.js
```

## Credenziali di Default

- **Username**: `admin` (configurabile via `SUPERADMIN_USERNAME`)
- **Password**: Valore di `SUPERADMIN_PASSWORD` dalla variabile d'ambiente

## Verifica Post-Reset

Dopo aver resettato le credenziali:

1. Vai alla pagina di login superadmin: `https://tuo-dominio.railway.app/superadmin-login`
2. Inserisci:
   - Username: `admin` (o il valore di `SUPERADMIN_USERNAME` se configurato)
   - Password: Il valore di `SUPERADMIN_PASSWORD` configurato su Railway
3. Dovresti essere in grado di accedere

## Troubleshooting

### Errore: "Account disattivato"
- L'utente superadmin è stato creato con `is_active = 0`
- **Soluzione**: Esegui `node scripts/reset-superadmin.js --reset`

### Errore: "Credenziali non valide"
- La password nel database non corrisponde a `SUPERADMIN_PASSWORD`
- **Soluzione**: 
  1. Verifica che `SUPERADMIN_PASSWORD` sia configurata correttamente su Railway
  2. Esegui `node scripts/reset-superadmin.js --reset`

### Errore: "Utente superadmin non trovato"
- L'utente superadmin non esiste nel database
- **Soluzione**: 
  1. Assicurati che `SUPERADMIN_PASSWORD` sia configurata su Railway
  2. Riavvia il servizio (gli utenti vengono creati automaticamente al primo avvio se la tabella è vuota)
  3. Se necessario, elimina il database e riavvia (⚠️ ATTENZIONE: perderai tutti i dati!)

## Prevenzione

Per evitare problemi futuri:

1. ✅ **Sempre configurare `SUPERADMIN_PASSWORD`** prima del primo deploy su Railway
2. ✅ **Usare password sicure** (min 12 caratteri, maiuscole, minuscole, numeri, caratteri speciali)
3. ✅ **Verificare le variabili d'ambiente** dopo ogni deploy
4. ✅ **Mantenere backup del database** regolarmente

## Note Tecniche

- Gli utenti di default vengono creati solo se la tabella `auth_users` è vuota
- La password viene hashata con bcrypt prima di essere salvata nel database
- Il campo `is_active` viene ora impostato esplicitamente a `1` durante la creazione degli utenti di default
- Lo script `reset-superadmin.js` può essere eseguito anche localmente per testare le credenziali

---

*Ultimo aggiornamento: 2024*

