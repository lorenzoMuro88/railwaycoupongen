# Deploy CouponGen su Digital Ocean

## Panoramica
Deploy dell'applicazione multi-tenant CouponGen su un singolo Droplet con ambienti produzione e staging, Nginx reverse proxy e SSL Let's Encrypt, backup automatici.

## Architettura
- Droplet Ubuntu 22.04 LTS
- Produzione: app su porta 3000, URL `https://platform.coupongen.it`
- Staging: app su porta 3001, URL `https://staging.coupongen.it`
- Nginx come reverse proxy + SSL
- Backup giornalieri di DB e uploads (retention 7 giorni)

## Prerequisiti
- Dominio configurabile (record A per `platform.coupongen.it` e `staging.coupongen.it`)
- Accesso SSH al Droplet

## Passi

### 1) Crea Droplet e DNS
1. Crea un Droplet Ubuntu 22.04 (Basic 1GB/1vCPU).
2. Annota l'IP pubblico.
3. Aggiungi record DNS A:
   - `platform.coupongen.it -> <IP>`
   - `staging.coupongen.it -> <IP>`

### 2) Setup iniziale server
```bash
ssh root@<IP>
apt update -y
# Clona repo
git clone https://github.com/lorenzoMuro88/CouponGen.git /opt/coupongen
cd /opt/coupongen
chmod +x scripts/deploy.sh
sudo ./scripts/deploy.sh
```

Lo script installa Docker, Compose, Nginx, Certbot, abilita UFW (22,80,443), crea swap 2GB e directories.

### 3) Configura environment
```bash
cp .env.production .env
cp .env.staging .env.staging
nano .env
nano .env.staging
```
Imposta almeno: `SESSION_SECRET`, `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_FROM`.

### 4) Avvio container
Produzione:
```bash
docker compose up -d --build
curl http://localhost:3000/healthz
```
Staging:
```bash
docker compose -f docker-compose.staging.yml up -d --build
curl http://localhost:3001/healthz
```

### 5) Configura Nginx e SSL
```bash
cp /opt/coupongen/nginx.conf /etc/nginx/nginx.conf
nginx -t && systemctl restart nginx
# Certificati
certbot --nginx -d platform.coupongen.it
certbot --nginx -d staging.coupongen.it
```

### 6) Backup automatici (systemd)
```bash
cp /opt/coupongen/scripts/coupongen-backup.service /etc/systemd/system/
cp /opt/coupongen/scripts/coupongen-backup.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now coupongen-backup.timer
systemctl status coupongen-backup.timer
```
Test manuale:
```bash
/opt/coupongen/scripts/backup.sh
ls -lh /opt/coupongen/backups/
```

### 7) Verifiche
- `https://platform.coupongen.it` e `https://staging.coupongen.it` raggiungibili con SSL valido
- `curl https://platform.coupongen.it/healthz` → 200
- `docker ps` mostra 4 container (2 app + 2 redis)
- `ufw status` permette 22,80,443

## Note operative
- Limiti risorse: 1GB RAM ⇒ usare swap e monitorare memoria
- Upgrade Droplet a 2GB se aumentano i tenant/traffico
- Impostare monitor esterno (UptimeRobot) su `/healthz`
