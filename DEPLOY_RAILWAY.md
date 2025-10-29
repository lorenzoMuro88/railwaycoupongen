# Deploy CouponGen su Railway

## Panoramica
Deploy dell'applicazione multi-tenant CouponGen su Railway con database PostgreSQL incluso, SSL automatico e gestione file uploads.

## Vantaggi di Railway
- ✅ **Deploy in 30 secondi**: Connessione GitHub → Deploy automatico
- ✅ **Database PostgreSQL incluso**: Gratuito nel piano base
- ✅ **SSL automatico**: Certificati gestiti automaticamente
- ✅ **Volume persistente**: Storage automatico per file e database
- ✅ **Backup automatico**: Snapshot del database
- ✅ **Costi prevedibili**: $8-9/mese fisso
- ✅ **Zero manutenzione**: Updates e monitoring automatici

## Prerequisiti
- Account Railway (gratuito)
- Repository GitHub pubblico o privato
- Railway CLI installato

## Passi per il Deploy

### 1) Installazione Railway CLI
```bash
# macOS
brew install railway

# Linux/Windows
curl -fsSL https://railway.app/install.sh | sh

# Verifica installazione
railway --version
```

### 2) Autenticazione
```bash
railway login
```

### 3) Deploy Automatico (Raccomandato)
1. Vai su [railway.app](https://railway.app)
2. Clicca "New Project"
3. Seleziona "Deploy from GitHub repo"
4. Scegli il repository CouponGen
5. Railway rileverà automaticamente Node.js e farà il deploy

### 4) Deploy Manuale (Script)
```bash
# Clona il repository
git clone https://github.com/lorenzoMuro88/CouponGen.git
cd CouponGen

# Rendi eseguibile lo script
chmod +x scripts/deploy-railway.sh

# Deploy produzione
./scripts/deploy-railway.sh production

# Deploy staging
./scripts/deploy-railway.sh staging
```

## Configurazione Ambiente

### Variabili d'Ambiente
Railway rileverà automaticamente le variabili dal file `.env`, ma puoi configurarle anche dal dashboard:

```bash
# Configurazione base
NODE_ENV=production
PORT=3000
SESSION_SECRET=your-secret-key-change-in-production

# Database (automatico con Railway PostgreSQL)
DATABASE_URL=postgresql://user:pass@host:port/db

# Email (Mailgun)
MAIL_PROVIDER=mailgun
MAILGUN_API_KEY=your_mailgun_api_key
MAILGUN_DOMAIN=your_domain.mailgun.org
MAILGUN_FROM=CouponGen <no-reply@send.coupongen.it>

# Tenant
DEFAULT_TENANT_SLUG=default
DEFAULT_TENANT_NAME=Default Tenant
ENFORCE_TENANT_PREFIX=false
```

### Database PostgreSQL
Railway crea automaticamente un database PostgreSQL. La variabile `DATABASE_URL` viene impostata automaticamente.

## Gestione File Uploads

### Volume Persistente
Railway monta automaticamente un volume persistente in `/app/data` per:
- Database SQLite (se usato)
- File uploads
- Backup

### Accesso ai File
```bash
# Via Railway CLI
railway shell

# Oppure via dashboard Railway
# Files → Browse → /app/data
```

## Monitoraggio e Logs

### Dashboard Railway
- **Metrics**: CPU, RAM, Network usage
- **Logs**: Logs in tempo reale
- **Deployments**: Cronologia deploy
- **Settings**: Variabili ambiente, domini

### Comandi CLI
```bash
# Logs in tempo reale
railway logs -f

# Stato progetto
railway status

# Shell remoto
railway shell

# Variabili ambiente
railway variables
```

## Backup e Restore

### Backup Automatico
Railway fa backup automatici del database PostgreSQL.

### Backup Manuale
```bash
# Export database
railway shell
pg_dump $DATABASE_URL > backup.sql

# Download file
railway shell
tar -czf uploads-backup.tar.gz /app/data/uploads
```

## Domini Personalizzati

### Configurazione Dominio
1. Vai su Railway Dashboard → Settings → Domains
2. Aggiungi il tuo dominio (es. `platform.coupongen.it`)
3. Configura i record DNS:
   ```
   CNAME platform.coupongen.it → your-app.up.railway.app
   ```
4. Railway gestirà automaticamente SSL

## Costi Stimati

### Piano Hobby ($5/mese)
- ✅ App Node.js
- ✅ Database PostgreSQL (1GB)
- ✅ Volume persistente (1GB)
- ✅ SSL automatico
- ✅ $5 di utilizzo incluso

### Utilizzo Extra
- CPU/RAM: ~$0.000463/GB-hour
- Storage: ~$0.25/GB-mese
- **Totale stimato: $8-9/mese**

## Troubleshooting

### Problemi Comuni

#### App non si avvia
```bash
# Controlla logs
railway logs

# Verifica variabili ambiente
railway variables

# Test locale
npm start
```

#### Database non connesso
```bash
# Verifica DATABASE_URL
railway variables | grep DATABASE_URL

# Test connessione
railway shell
psql $DATABASE_URL
```

#### File uploads non funzionano
```bash
# Verifica volume montato
railway shell
ls -la /app/data

# Controlla permessi
chmod 755 /app/data/uploads
```

## Comandi Utili

```bash
# Deploy rapido
railway up

# Rollback
railway rollback

# Restart app
railway restart

# Monitoraggio
railway logs -f
railway status

# Shell remoto
railway shell

# Variabili ambiente
railway variables set KEY=value
```

## Migrazione da DigitalOcean

### Passi Migrazione
1. **Backup dati attuali**:
   ```bash
   # Backup database
   sqlite3 data/coupons.db ".backup backup.db"
   
   # Backup uploads
   tar -czf uploads-backup.tar.gz static/uploads/
   ```

2. **Deploy su Railway** (seguire passi sopra)

3. **Import dati**:
   ```bash
   # Import database (se necessario)
   railway shell
   # Converti SQLite → PostgreSQL se necessario
   
   # Import uploads
   railway shell
   tar -xzf uploads-backup.tar.gz -C /app/data/
   ```

4. **Test completo**:
   ```bash
   curl https://your-app.up.railway.app/healthz
   curl -X POST https://your-app.up.railway.app/api/login \
     -H 'Content-Type: application/json' \
     -d '{"username":"admin","password":"admin123","userType":"superadmin"}'
   ```

5. **Aggiorna DNS**:
   ```
   CNAME platform.coupongen.it → your-app.up.railway.app
   ```

## Supporto
- [Documentazione Railway](https://docs.railway.app/)
- [Community Discord](https://discord.gg/railway)
- [GitHub Issues](https://github.com/railwayapp/cli/issues)
