<!-- 09dfc9f5-d287-4305-9d22-d6123ac2eb7f 6c7d6fec-1376-46c8-87d6-6fdf51ea8667 -->
# Deploy CouponGen su Digital Ocean

## Panoramica

Deploy dell'applicazione multi-tenant CouponGen su Digital Ocean Droplet Basic (1GB RAM, 1 vCPU - $6/mese) con ambiente staging e produzione sullo stesso server, Nginx con SSL/TLS, backup automatici giornalieri.

## Architettura Finale

- **Droplet Digital Ocean**: Ubuntu 22.04 LTS, 1GB RAM, 1 vCPU
- **Produzione**: 
- URL: `https://platform.coupongen.it`
- App Node.js su porta interna 3000 (docker-compose)
- Nginx reverse proxy con SSL Let's Encrypt
- **Staging**: 
- URL: `https://staging.coupongen.it`
- App Node.js su porta interna 3001 (docker-compose separato)
- Stesso Nginx, server block dedicato
- **Backup**: cron giornaliero DB + uploads, retention 7 giorni
- **Monitoraggio**: healthcheck endpoint `/healthz` per entrambi gli ambienti

**Risultato**: Applicazione accessibile pubblicamente su `platform.coupongen.it` con certificato SSL valido

## File da Creare/Modificare

### 1. Script di Deploy e Setup

Creare `scripts/deploy.sh` - script automatico per setup iniziale droplet:

- Installa Docker, Docker Compose, Nginx, certbot
- Configura firewall UFW (80, 443, 22)
- Crea struttura directories per prod/staging

### 2. Docker Compose per Staging

Creare `docker-compose.staging.yml` basato su quello esistente:

- Porta 3001 invece di 3000
- Volumi separati per data e uploads (`./data-staging`, `./static/uploads-staging`)
- Variabili ambiente da `.env.staging`

### 3. Nginx Configuration

Aggiornare `nginx.conf.example` → `nginx.conf`:

- Server block produzione (porta 3000)
- Server block staging (porta 3001, sottodominio)
- Redirect HTTP → HTTPS
- Headers sicurezza (HSTS, X-Frame-Options, etc.)
- Rate limiting su login endpoints
- Compressione gzip
- Cache static files

### 4. Backup Script

Creare `scripts/backup.sh`:

- Backup `data/coupons.db` + `data-staging/coupons.db`
- Backup `static/uploads/` + `static/uploads-staging/`
- Compressione gzip con timestamp
- Cleanup backups > 7 giorni
- Log risultati

### 5. Environment Files

Creare template `.env.production` e `.env.staging`:

- `NODE_ENV=production`
- `ENFORCE_TENANT_PREFIX=true`
- `SESSION_SECRET` diversi per prod/staging
- `REDIS_URL` puntano a redis containers separati
- Mailgun configurato (stessi credentials)
- `DEFAULT_TENANT_SLUG=default`

### 6. Deploy Guide

Creare `DEPLOY.md` con istruzioni passo-passo:

1. Setup Droplet Digital Ocean
2. Configurazione DNS (A record per dominio + staging)
3. Clone repository e setup
4. Configurazione variabili ambiente
5. Deploy con Docker Compose
6. Setup SSL con certbot
7. Configurazione backup automatici
8. Verifica deployments

### 7. Monitoring Script

Creare `scripts/healthcheck.sh`:

- Curl su `/healthz` per prod e staging
- Alert via log se down
- Opzionale: integrazione webhook per notifiche

### 8. Systemd Services (opzionale)

Creare `scripts/coupongen-backup.service` e `.timer`:

- Backup automatico giornaliero alle 2:00 AM
- Gestito da systemd invece di cron

## Costi Stimati (Mensili)

- **Droplet Basic**: $6/mese (1GB RAM, 25GB SSD, 1TB transfer)
- **Backups Digital Ocean**: $1.20/mese (20% del costo droplet, opzionale)
- **Mailgun**: Free tier (5000 email/mese) o da $0.80/1000 email
- **Dominio**: ~$10-15/anno (già posseduto)
- **Totale**: ~$7-8/mese

## Considerazioni Tecniche

### Sostenibilità 1GB RAM

Con 1GB RAM dobbiamo ottimizzare:

- Redis con max memory 128MB per istanza
- Node app con `--max-old-space-size=384` per container
- Swap di 2GB come safety net
- Monitoring memoria con alert al 80%

**Limite stimato**: 2-3 tenant attivi, ~100-200 coupon/giorno totali. Per crescita oltre questo, upgrade a $12/mese droplet.

### Backup Strategy

- **Giornalieri**: data/coupons.db (pochi MB), uploads (~10-50MB stimati)
- **Storage locale**: 7 giorni × ~50MB = 350MB disco
- **Opzione cloud**: Digital Ocean Spaces ($5/mese per 250GB) se uploads crescono
- **Restore time**: ~2-5 minuti (stop app, replace DB, restart)

### Security Checklist

- Firewall UFW abilitato
- SSH solo con key (no password)
- Nginx rate limiting su `/api/login`
- HTTPS enforced
- Session secrets robusti
- Cookie secure flags
- Fail2ban opzionale per SSH

## Istruzioni Passo-Passo per il Deploy

### FASE 1: Preparazione Locale (5-10 minuti)

**Passo 1.1** - Io creerò tutti i file necessari:

- `scripts/deploy.sh` - script setup automatico
- `docker-compose.staging.yml` - configurazione staging
- `nginx.conf` - configurazione Nginx completa
- `scripts/backup.sh` - script backup automatici
- `.env.production` e `.env.staging` - template environment
- `DEPLOY.md` - guida dettagliata
- `scripts/healthcheck.sh` - monitoring
- `scripts/coupongen-backup.service` e `.timer` - systemd

**Passo 1.2** - Tu dovrai:

- Verificare i file creati
- Personalizzare `.env.production` e `.env.staging` con:
  - `SESSION_SECRET` (genera stringa random sicura)
  - Credenziali Mailgun (API key, domain, etc.)
  - Altri parametri specifici se necessari

### FASE 2: Setup Digital Ocean (10-15 minuti)

**Passo 2.1** - Crea Droplet su Digital Ocean:

1. Vai su https://cloud.digitalocean.com/
2. Crea nuovo Droplet:

   - **Image**: Ubuntu 22.04 LTS
   - **Plan**: Basic - $6/mese (1GB RAM / 1 vCPU / 25GB SSD)
   - **Datacenter**: Frankfurt (FRA1) o Amsterdam (AMS3) per vicinanza Europa
   - **Authentication**: SSH key (raccomandato) o password
   - **Hostname**: coupongen-prod

3. Annota l'IP pubblico del Droplet (es: `165.232.xxx.xxx`)

**Passo 2.2** - Configura DNS per coupongen.it:

1. Vai al pannello DNS del tuo provider dominio
2. Aggiungi questi record A:
   ```
   platform.coupongen.it  →  165.232.xxx.xxx  (TTL: 300)
   staging.coupongen.it   →  165.232.xxx.xxx  (TTL: 300)
   ```

3. Attendi 5-15 minuti per propagazione DNS
4. Verifica con: `ping platform.coupongen.it` (deve rispondere con IP del Droplet)

### FASE 3: Setup Iniziale Server (15-20 minuti)

**Passo 3.1** - Connettiti al Droplet:

```bash
ssh root@165.232.xxx.xxx
```

**Passo 3.2** - Esegui lo script di setup automatico:

```bash
# Scarica il repository
git clone https://github.com/lorenzoMuro88/CouponGen.git /opt/coupongen
cd /opt/coupongen

# Rendi eseguibile e lancia lo script di deploy
chmod +x scripts/deploy.sh
./scripts/deploy.sh
```

Lo script installerà automaticamente:

- Docker e Docker Compose
- Nginx
- Certbot (Let's Encrypt)
- Configurerà firewall UFW
- Creerà swap 2GB
- Configurerà directories

**Passo 3.3** - Configura gli environment files:

```bash
# Copia i template
cp .env.production .env
cp .env.staging .env.staging

# Modifica con i tuoi valori (usa nano o vim)
nano .env
nano .env.staging
```

Valori CRITICI da impostare:

- `SESSION_SECRET=` (stringa casuale lunga, diversa per prod/staging)
- `MAILGUN_API_KEY=`
- `MAILGUN_DOMAIN=`
- `MAILGUN_FROM=`

### FASE 4: Deploy Applicazioni (10 minuti)

**Passo 4.1** - Avvia produzione:

```bash
docker compose up -d --build
```

Verifica:

```bash
docker compose ps  # Devono essere "Up" app e redis
docker compose logs -f app  # Controlla log, Ctrl+C per uscire
curl http://localhost:3000/healthz  # Deve rispondere {"ok":true}
```

**Passo 4.2** - Avvia staging:

```bash
docker compose -f docker-compose.staging.yml up -d --build
```

Verifica:

```bash
docker compose -f docker-compose.staging.yml ps
curl http://localhost:3001/healthz  # Deve rispondere {"ok":true}
```

### FASE 5: Setup Nginx e SSL (10-15 minuti)

**Passo 5.1** - Configura Nginx:

```bash
# Copia la configurazione
cp /opt/coupongen/nginx.conf /etc/nginx/nginx.conf

# Testa la configurazione
nginx -t

# Se OK, riavvia Nginx
systemctl restart nginx
```

**Passo 5.2** - Ottieni certificati SSL con Let's Encrypt:

```bash
# Per produzione
certbot --nginx -d platform.coupongen.it

# Per staging
certbot --nginx -d staging.coupongen.it
```

Quando richiesto:

- Email: inserisci la tua email
- Terms of Service: accetta (Y)
- Redirect HTTP to HTTPS: sì (opzione 2)

Certbot configurerà automaticamente Nginx con SSL.

**Passo 5.3** - Verifica HTTPS:

```bash
systemctl status nginx  # Deve essere "active (running)"
```

Apri browser e vai su:

- `https://platform.coupongen.it` - deve mostrare l'app (no errori SSL)
- `https://staging.coupongen.it` - deve mostrare l'app

### FASE 6: Setup Backup Automatici (5 minuti)

**Passo 6.1** - Configura systemd timer:

```bash
# Copia i file systemd
cp /opt/coupongen/scripts/coupongen-backup.service /etc/systemd/system/
cp /opt/coupongen/scripts/coupongen-backup.timer /etc/systemd/system/

# Abilita e avvia il timer
systemctl daemon-reload
systemctl enable coupongen-backup.timer
systemctl start coupongen-backup.timer

# Verifica
systemctl status coupongen-backup.timer
systemctl list-timers coupongen-backup.timer
```

**Passo 6.2** - Test manuale backup:

```bash
/opt/coupongen/scripts/backup.sh
ls -lh /opt/coupongen/backups/  # Verifica che i file siano stati creati
```

### FASE 7: Verifica Finale (5-10 minuti)

**Checklist completa**:

1. ✅ Produzione online: `https://platform.coupongen.it`
2. ✅ Staging online: `https://staging.coupongen.it`
3. ✅ SSL valido su entrambi (lucchetto verde browser)
4. ✅ Healthcheck: 

   - `curl https://platform.coupongen.it/healthz`
   - `curl https://staging.coupongen.it/healthz`

5. ✅ Containers running:
   ```bash
   docker ps  # Devono esserci 4 containers (2 app + 2 redis)
   ```

6. ✅ Backup configurato:
   ```bash
   systemctl status coupongen-backup.timer
   ```

7. ✅ Firewall attivo:
   ```bash
   ufw status  # Deve mostrare 22, 80, 443 ALLOW
   ```


### FASE 8: Configurazione Iniziale App (5 minuti)

**Passo 8.1** - Crea primo tenant su STAGING (per test):

```bash
curl -X POST https://staging.coupongen.it/api/signup \
  -H "Content-Type: application/json" \
  -d '{
    "tenantName": "Demo Test",
    "adminUsername": "admin",
    "adminPassword": "changeme123!"
  }'
```

**Passo 8.2** - Testa login staging:

1. Vai su `https://staging.coupongen.it/t/demo-test/admin`
2. Login con admin / changeme123!
3. Verifica dashboard, crea campagna test, etc.

**Passo 8.3** - Crea tenant produzione:

```bash
curl -X POST https://platform.coupongen.it/api/signup \
  -H "Content-Type: application/json" \
  -d '{
    "tenantName": "Il tuo nome tenant",
    "adminUsername": "admin",
    "adminPassword": "PASSWORD_SICURA_QUI"
  }'
```

**IMPORTANTE**: Salva le credenziali in un password manager!

### FASE 9: Monitoring e Manutenzione

**Setup monitoraggio esterno** (opzionale ma raccomandato):

1. Crea account gratuito su https://uptimerobot.com
2. Aggiungi monitor:

   - `https://platform.coupongen.it/healthz` (check ogni 5 min)
   - `https://staging.coupongen.it/healthz` (check ogni 15 min)

3. Configura alert via email

**Comandi utili per manutenzione**:

```bash
# Logs produzione
docker compose logs -f app

# Logs staging
docker compose -f docker-compose.staging.yml logs -f app

# Restart produzione
docker compose restart app

# Update applicazione (dopo git pull)
docker compose up -d --build

# Verifica uso risorse
docker stats
htop
df -h  # Spazio disco
```

## Prossimi Step Post-Deploy

1. Test completo flussi admin/store su staging
2. Configurare monitoring esterno (UptimeRobot)
3. Test restore da backup (drill mensile)
4. Documentare credenziali e procedure in password manager
5. Pianificare upgrade Droplet se necessario in futuro

### To-dos

- [ ] Creare scripts/deploy.sh per setup automatico Droplet (Docker, Nginx, firewall, directories)
- [ ] Creare docker-compose.staging.yml per ambiente staging su porta 3001
- [ ] Configurare nginx.conf con SSL, rate limiting, server blocks prod/staging
- [ ] Creare scripts/backup.sh per backup giornalieri DB + uploads con retention 7 giorni
- [ ] Creare .env.production e .env.staging con configurazioni ottimizzate
- [ ] Creare DEPLOY.md con guida completa step-by-step per deploy su Digital Ocean
- [ ] Creare scripts/healthcheck.sh per monitoraggio automatico prod/staging
- [ ] Creare systemd timer/service per backup automatici