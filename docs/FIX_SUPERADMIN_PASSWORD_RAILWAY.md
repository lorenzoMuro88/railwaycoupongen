# Fix Password SuperAdmin su Railway - Guida Rapida

## ⚠️ IMPORTANTE: Il file .env locale NON serve per Railway!

- Il file `.env` locale serve **solo per sviluppo locale**
- Su Railway, le variabili d'ambiente sono quelle configurate nel **Dashboard Railway**
- Cambiare solo la variabile su Railway **NON cambia** la password nel database se l'utente esiste già

## Problema

Hai configurato `SUPERADMIN_PASSWORD` su Railway, ma il login non funziona perché:
- L'utente superadmin è già stato creato nel database con una password diversa
- La password nel database non corrisponde a quella in `SUPERADMIN_PASSWORD`

## Soluzione: Reset Password nel Database

### Step 1: Verifica che SUPERADMIN_PASSWORD sia configurata su Railway

1. Vai su **Railway Dashboard** → Il tuo progetto → **Variables**
2. Verifica che `SUPERADMIN_PASSWORD` sia presente e abbia il valore corretto
3. Se non c'è, aggiungila con una password sicura

### Step 2: Accedi alla console Railway

1. Vai su **Railway Dashboard** → Il tuo progetto → **Deployments**
2. Clicca su **"View Logs"** o **"Open Shell"** (o **"Deploy Logs"** → **"Shell"**)

### Step 3: Esegui lo script di reset

**Opzione A - Usando npm (più semplice):**
```bash
# Prima verifica lo stato
npm run reset:superadmin-check

# Poi resetta la password (sincronizza database con SUPERADMIN_PASSWORD)
npm run reset:superadmin
```

**Opzione B - Usando node direttamente:**
```bash
# Prima verifica lo stato
node scripts/reset-superadmin.js

# Poi resetta la password (sincronizza database con SUPERADMIN_PASSWORD)
node scripts/reset-superadmin.js --reset
```

Lo script:
- ✅ Legge `SUPERADMIN_PASSWORD` dalle variabili d'ambiente di Railway
- ✅ Genera un nuovo hash bcrypt della password
- ✅ Aggiorna la password nel database
- ✅ Attiva l'utente se è disattivato

### Step 4: Prova il login

1. Vai a: `https://tuo-dominio.railway.app/superadmin-login`
2. Username: `admin`
3. Password: Il valore di `SUPERADMIN_PASSWORD` configurato su Railway

## Credenziali

- **Username**: `admin` (o il valore di `SUPERADMIN_USERNAME` se configurato)
- **Password**: Il valore di `SUPERADMIN_PASSWORD` configurato su Railway

## Troubleshooting

### Lo script dice "SUPERADMIN_PASSWORD non configurata"
- Verifica che la variabile sia configurata su Railway Dashboard → Variables
- Riavvia il deployment dopo aver aggiunto/modificato la variabile

### Lo script dice "Utente superadmin non trovato"
- Gli utenti vengono creati automaticamente solo se la tabella `auth_users` è vuota
- Se il database è vuoto, riavvia il servizio e gli utenti verranno creati automaticamente

### Il login ancora non funziona dopo il reset
1. Verifica che `SUPERADMIN_PASSWORD` su Railway corrisponda esattamente alla password che stai usando
2. Controlla i log di Railway per eventuali errori
3. Esegui di nuovo: `node scripts/reset-superadmin.js` per verificare lo stato

## Nota sul file .env locale

Il file `.env` locale:
- ✅ Serve per sviluppo locale
- ❌ NON viene usato su Railway
- ❌ NON serve aggiornarlo per Railway

Su Railway, usa sempre le **variabili d'ambiente del Dashboard Railway**.

---

*Ultimo aggiornamento: 2024*

