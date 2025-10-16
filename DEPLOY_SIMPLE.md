# 🚀 Deploy Semplificato CouponGen

Script unico per deploy completo: push su GitHub + aggiornamento server con ricostruzione container.

## 📁 File Necessari

- `deploy.sh` - Script Bash per Linux/macOS
- `deploy.ps1` - Script PowerShell per Windows  
- `deploy/deploy-config.sh` - Configurazione con credenziali (NON COMMITTARE)
- `deploy/deploy-config.example.sh` - Template configurazione

## ⚙️ Setup Iniziale

### 1. Configura le credenziali

```bash
# Copia il template
cp deploy/deploy-config.example.sh deploy/deploy-config.sh

# Modifica con le tue credenziali
nano deploy/deploy-config.sh
```

### 2. Rendi eseguibile (Linux/macOS)

```bash
chmod +x deploy.sh
```

## 🚀 Utilizzo

### Linux/macOS (Bash)

```bash
# Deploy produzione
./deploy.sh

# Deploy staging
./deploy.sh staging
```

### Windows (PowerShell)

```powershell
# Deploy produzione
.\deploy.ps1

# Deploy staging
.\deploy.ps1 -Environment staging
```

## 🔄 Cosa Fa lo Script

### STEP 1: Push su GitHub
- Controlla modifiche locali
- Chiede messaggio di commit (o usa automatico)
- Fa `git add .` e `git commit`
- Fa `git push origin <branch>`

### STEP 2: Aggiornamento Server
- Si connette via SSH al server
- Fa `git fetch origin` e `git reset --hard origin/<branch>`
- Arresta container esistenti: `docker compose down`
- Pulisce sistema Docker: `docker system prune -f`
- Ricostruisce e avvia: `docker compose up -d --build`
- Attende 15 secondi per l'avvio
- Verifica health check con retry (3 tentativi)
- Testa endpoint login automaticamente

### STEP 3: Test Finale
- Testa health check esterno
- Mostra URL dell'applicazione
- Fornisce comandi per monitoraggio

## 🔧 Configurazione

### deploy-config.sh

```bash
# Server produzione
export DEPLOY_SERVER="167.172.42.248"
export DEPLOY_USER="root"
export DEPLOY_PASSWORD="your_password"
export DEPLOY_APP_PATH="/opt/coupongen"
export DEPLOY_BRANCH="feature/migration-cloud-multitenant-prerelease"
```

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
```

## 🆘 Risoluzione Problemi

### Errore di connessione SSH
```bash
# Verifica connessione
ssh root@167.172.42.248 'echo "Connessione OK"'
```

### Deploy fallito
```bash
# Controlla log sul server
ssh root@167.172.42.248 'cd /opt/coupongen && docker compose logs app'

# Riavvia manualmente
ssh root@167.172.42.248 'cd /opt/coupongen && docker compose restart'
```

### Health check fallito
- Controlla che l'applicazione sia avviata: `docker compose ps`
- Verifica i log: `docker compose logs app`
- Controlla che la porta sia aperta: `netstat -tlnp | grep :3000`

## 📝 Esempi

### Deploy giornaliero
```bash
./deploy.sh
```

### Deploy su staging
```bash
./deploy.sh staging
```

### Deploy con messaggio personalizzato
Lo script chiederà automaticamente il messaggio di commit se ci sono modifiche.
