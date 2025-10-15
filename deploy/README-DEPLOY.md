# 🚀 Script di Deploy CouponGen

Questo documento spiega come utilizzare gli script di deploy automatizzati per CouponGen.

## 📁 File Disponibili

- `auto-deploy.sh` - Script completo con molte opzioni
- `auto-deploy-windows.sh` - Script completo ottimizzato per Windows
- `quick-deploy.sh` - Script semplificato per deploy rapidi
- `quick-deploy.ps1` - Script PowerShell per Windows
- `restart-app.sh` - Script dedicato per riavvio applicazione (Bash)
- `restart-app.ps1` - Script dedicato per riavvio applicazione (PowerShell)
- `deploy-config.sh` - Configurazione con credenziali (NON COMMITTARE)
- `deploy-config.example.sh` - Esempio di configurazione
- `README-DEPLOY.md` - Questa documentazione

## ⚙️ Setup Iniziale

### 1. Configura le credenziali

```bash
# Copia il file di esempio
cp deploy/deploy-config.example.sh deploy/deploy-config.sh

# Modifica con le tue credenziali
nano deploy/deploy-config.sh
```

### 2. Rendi eseguibili gli script

```bash
chmod +x deploy/auto-deploy.sh
chmod +x deploy/quick-deploy.sh
```

## 🚀 Utilizzo

### Windows (PowerShell)

```powershell
# Deploy semplice con PowerShell
.\deploy\quick-deploy.ps1

# Deploy con messaggio personalizzato
.\deploy\quick-deploy.ps1 -CommitMessage "Fix login error"
```

### Linux/macOS (Bash)

```bash
# Deploy semplice con messaggio di commit
./deploy/quick-deploy.sh

# Deploy con autenticazione automatica (Windows Compatible)
./deploy/auto-deploy-windows.sh
```

### Deploy Avanzato

```bash
# Deploy con opzioni personalizzate
./deploy/auto-deploy.sh -m "Fix login error" --env production

# Deploy solo aggiornamento (senza commit)
./deploy/auto-deploy.sh --no-commit

# Deploy senza riavvio
./deploy/auto-deploy.sh --no-restart

# Simulazione (dry-run)
./deploy/auto-deploy.sh --dry-run
```

### Riavvio Applicazione

```bash
# Riavvio semplice (Bash)
./deploy/restart-app.sh

# Riavvio staging (Bash)
./deploy/restart-app.sh --env staging

# Riavvio semplice (PowerShell)
.\deploy\restart-app.ps1

# Riavvio staging (PowerShell)
.\deploy\restart-app.ps1 -Environment staging
```

## 📋 Opzioni Disponibili

### auto-deploy.sh

| Opzione | Descrizione |
|---------|-------------|
| `-h, --help` | Mostra help |
| `-m, --message MESSAGE` | Messaggio di commit personalizzato |
| `-s, --server SERVER` | IP del server |
| `-u, --user USER` | Utente SSH (default: root) |
| `-e, --env ENV` | Ambiente: production/staging |
| `-b, --branch BRANCH` | Branch da deployare |
| `--no-commit` | Salta commit e push |
| `--no-restart` | Salta riavvio applicazione |
| `--dry-run` | Simula senza eseguire |

## 🔧 Configurazione

### deploy-config.sh

```bash
# Server produzione
export DEPLOY_SERVER="167.172.42.248"
export DEPLOY_USER="root"
export DEPLOY_PASSWORD="hPmCLn7dk6YfjXV"
export DEPLOY_APP_PATH="/opt/coupongen"
export DEPLOY_BRANCH="feature/migration-cloud-multitenant-prerelease"

# URL applicazioni
export PRODUCTION_URL="https://platform.coupongen.it"
export STAGING_URL="https://staging.coupongen.it"
```

## 🔄 Funzionalità di Riavvio Avanzate

### Processo di Riavvio

Gli script di deploy e riavvio includono:

1. **Arresto pulito** dei container esistenti
2. **Pulizia sistema** Docker (rimozione immagini non utilizzate)
3. **Ricostruzione** e avvio container
4. **Attesa intelligente** per l'avvio (15 secondi)
5. **Health check** con retry (3 tentativi)
6. **Test endpoint** login automatico
7. **Verifica stato** finale container

### Verifiche Post-Riavvio

- ✅ **Health Check**: `/healthz` endpoint
- ✅ **Login Test**: Test automatico endpoint `/api/login`
- ✅ **Container Status**: Verifica stato container Docker
- ✅ **Log Analysis**: Visualizzazione log in caso di errori

## 🔐 Sicurezza

⚠️ **IMPORTANTE**: 
- Il file `deploy-config.sh` contiene credenziali sensibili
- È già escluso dal repository tramite `.gitignore`
- Non committare mai questo file

## 📊 Monitoraggio Post-Deploy

```bash
# Verifica stato container
ssh root@167.172.42.248 'cd /opt/coupongen && docker compose ps'

# Visualizza log applicazione
ssh root@167.172.42.248 'cd /opt/coupongen && docker compose logs -f app'

# Test health check
curl https://platform.coupongen.it/healthz

# Test login endpoint
curl -X POST https://platform.coupongen.it/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123","userType":"superadmin"}'
```

## 🆘 Risoluzione Problemi

### Errore di connessione SSH
```bash
# Verifica connessione
ssh root@167.172.42.248 'echo "Connessione OK"'

# Se necessario, accetta la chiave host
ssh-keyscan -H 167.172.42.248 >> ~/.ssh/known_hosts
```

### Errore di permessi
```bash
# Rendi eseguibili gli script
chmod +x deploy/*.sh
```

### Deploy fallito
```bash
# Controlla log sul server
ssh root@167.172.42.248 'cd /opt/coupongen && docker compose logs app'

# Riavvia manualmente
ssh root@167.172.42.248 'cd /opt/coupongen && docker compose restart'
```

## 📝 Esempi di Utilizzo

### Deploy giornaliero
```bash
./deploy/quick-deploy.sh
```

### Deploy con messaggio specifico
```bash
./deploy/auto-deploy.sh -m "Fix: Risolto errore 500 su login"
```

### Deploy su staging
```bash
./deploy/auto-deploy.sh --env staging -m "Test nuove funzionalità"
```

### Deploy solo aggiornamento codice
```bash
./deploy/auto-deploy.sh --no-commit
```

### Simulazione deploy
```bash
./deploy/auto-deploy.sh --dry-run
```
