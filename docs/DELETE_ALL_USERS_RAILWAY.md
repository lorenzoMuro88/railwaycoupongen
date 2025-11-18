# Eliminare Tutti gli Utenti su Railway

## Scopo

Questo script elimina tutti gli utenti dal database su Railway, permettendo la ricreazione automatica degli utenti di default al prossimo avvio usando le password dalle variabili d'ambiente.

## Quando Usarlo

- ✅ Dopo una build completa da zero
- ✅ Quando vuoi ripulire il database e ricreare gli utenti con password corrette
- ✅ Quando ci sono problemi con le credenziali e vuoi ripartire da zero

## Procedura

### Step 1: Verifica Variabili d'Ambiente

Prima di eliminare gli utenti, assicurati che siano configurate su Railway:

1. Vai su **Railway Dashboard** → Il tuo progetto → **Variables**
2. Verifica che siano presenti:
   - `SUPERADMIN_PASSWORD` (password per utente superadmin)
   - `STORE_PASSWORD` (password per utente store)

Se non ci sono, aggiungile prima di procedere!

### Step 2: Accedi alla Console Railway

1. Vai su **Railway Dashboard** → Il tuo progetto → **Deployments**
2. Clicca su **"View Logs"** o **"Open Shell"** (o **"Deploy Logs"** → **"Shell"**)

### Step 3: Esegui lo Script

**Opzione A - Con conferma interattiva:**
```bash
npm run delete:all-users
```

Lo script mostrerà:
- Elenco di tutti gli utenti che verranno eliminati
- Richiesta di conferma (scrivi "SI" per confermare)

**Opzione B - Senza conferma (per script automatizzati):**
```bash
npm run delete:all-users-confirm
```

### Step 4: Riavvia il Server

Dopo aver eliminato gli utenti, riavvia il deployment su Railway:

1. Vai su **Railway Dashboard** → Il tuo progetto → **Deployments**
2. Clicca su **"Redeploy"** o **"Restart"**

### Step 5: Verifica Creazione Utenti

Al riavvio, il server creerà automaticamente gli utenti di default se:
- La tabella `auth_users` è vuota (✅ dopo l'eliminazione)
- `SUPERADMIN_PASSWORD` e `STORE_PASSWORD` sono configurate

Puoi verificare con:
```bash
npm run reset:superadmin-check
```

## Credenziali di Default

Dopo il riavvio, gli utenti di default saranno:

- **SuperAdmin**:
  - Username: `admin`
  - Password: Valore di `SUPERADMIN_PASSWORD` configurato su Railway

- **Store**:
  - Username: `store`
  - Password: Valore di `STORE_PASSWORD` configurato su Railway

## Troubleshooting

### Gli utenti non vengono ricreati dopo il riavvio

1. Verifica che `SUPERADMIN_PASSWORD` e `STORE_PASSWORD` siano configurate su Railway
2. Controlla i log del deployment per eventuali errori
3. Verifica che la tabella `auth_users` sia vuota:
   ```bash
   npm run reset:superadmin-check
   ```
   Dovrebbe dire "Utente superadmin non trovato"

### Errore durante l'eliminazione

- Verifica di avere accesso al database
- Controlla i log per dettagli sull'errore
- Assicurati che il server non sia in esecuzione durante l'eliminazione (opzionale, ma raccomandato)

## Nota Importante

⚠️ **ATTENZIONE**: Questo script elimina TUTTI gli utenti, inclusi:
- Superadmin
- Admin di tutti i tenant
- Store di tutti i tenant

Gli altri dati (tenant, campagne, coupon, ecc.) NON vengono eliminati.

Se vuoi eliminare anche tutti gli altri dati, considera di:
- Eliminare il volume del database su Railway
- Oppure usare `npm run clean:db` (⚠️ solo in sviluppo locale)

---

*Ultimo aggiornamento: 2024*

