# Database Backup Guide

Questa guida descrive come utilizzare il sistema di backup automatico del database SQLite.

## Panoramica

Il sistema di backup include:
- Backup incrementali con timestamp
- Compressione gzip opzionale
- Retention policy configurabile
- Script di test restore
- Comandi npm per facilità d'uso

## Configurazione

### Variabili d'Ambiente

Configura le seguenti variabili nel file `.env`:

```env
# Directory per i backup
BACKUP_DIR=./backups

# Retention policy (giorni)
BACKUP_RETENTION_DAYS=7

# Compressione gzip (true/false)
BACKUP_COMPRESSION=true
```

### Valori di Default

- `BACKUP_DIR`: `./backups` (relativo alla root del progetto)
- `BACKUP_RETENTION_DAYS`: `7` (7 giorni)
- `BACKUP_COMPRESSION`: `true` (compressione abilitata)

## Utilizzo

### Creare un Backup

```bash
# Via npm script
npm run backup:db

# Oppure direttamente
node scripts/backup-db.js backup
```

Il backup viene salvato in `BACKUP_DIR` con nome formato:
```
coupons-2024-01-15T10-30-00.db.gz
```

### Elencare Backup Disponibili

```bash
# Via npm script
npm run backup:list

# Oppure direttamente
node scripts/backup-db.js list
```

Output esempio:
```json
[
  {
    "filename": "coupons-2024-01-15T10-30-00.db.gz",
    "path": "./backups/coupons-2024-01-15T10-30-00.db.gz",
    "size": 1048576,
    "sizeMB": "1.00",
    "created": "2024-01-15T10:30:00.000Z",
    "modified": "2024-01-15T10:30:00.000Z",
    "compressed": true
  }
]
```

### Cleanup Backup Vecchi

```bash
# Via npm script
npm run backup:cleanup

# Oppure direttamente
node scripts/backup-db.js cleanup
```

Rimuove automaticamente i backup più vecchi di `BACKUP_RETENTION_DAYS` giorni.

## Restore Database

### Restore Manuale

1. **Ferma l'applicazione** (se in esecuzione):
   ```bash
   npm run server:stop
   ```

2. **Copia il backup** nella directory del database:
   ```bash
   # Se compresso
   gunzip -c backups/coupons-2024-01-15T10-30-00.db.gz > data/coupons.db
   
   # Se non compresso
   cp backups/coupons-2024-01-15T10-30-00.db data/coupons.db
   ```

3. **Riavvia l'applicazione**:
   ```bash
   npm run server:start
   ```

### Test Restore

Lo script `test-restore.js` verifica automaticamente la funzionalità di restore:

```bash
node scripts/test-restore.js
```

Il test:
1. Crea un backup
2. Modifica il database
3. Restaura dal backup
4. Verifica l'integrità dei dati

## Automazione con Cron

### Linux/macOS

Aggiungi al crontab per backup giornaliero alle 2:00 AM:

```bash
crontab -e
```

Aggiungi:
```
0 2 * * * cd /path/to/FLYCouponGen && npm run backup:db
```

### Railway

Railway supporta cron jobs. Crea un file `railway.json`:

```json
{
  "crons": [
    {
      "command": "npm run backup:db",
      "schedule": "0 2 * * *"
    }
  ]
}
```

## Best Practices

1. **Backup Regolari**: Esegui backup almeno una volta al giorno
2. **Retention Policy**: Mantieni almeno 7 giorni di backup
3. **Test Restore**: Testa periodicamente il restore per verificare l'integrità
4. **Backup Offsite**: Considera di copiare backup su storage esterno (S3, Google Drive, etc.)
5. **Monitoraggio**: Verifica che i backup vengano creati correttamente

## Troubleshooting

### Backup Fallisce

**Errore: "Database file not found"**
- Verifica che `DATA_DIR` sia configurato correttamente
- Verifica che il file `coupons.db` esista

**Errore: "Permission denied"**
- Verifica i permessi sulla directory `BACKUP_DIR`
- Assicurati che la directory esista o possa essere creata

### Restore Fallisce

**Errore: "Database is locked"**
- Ferma l'applicazione prima di fare restore
- Verifica che nessun processo stia usando il database

**Errore: "Backup file corrupted"**
- Verifica l'integrità del file backup
- Prova con un backup più recente

## File di Backup

### Struttura File

Ogni backup include:
- `coupons-YYYY-MM-DDTHH-MM-SS.db` - File database principale
- `coupons-YYYY-MM-DDTHH-MM-SS.db.gz` - Versione compressa (se compressione abilitata)
- `coupons-YYYY-MM-DDTHH-MM-SS.db-wal` - Write-Ahead Log (se presente)
- `coupons-YYYY-MM-DDTHH-MM-SS.db-shm` - Shared Memory (se presente)

### Compressione

Con compressione gzip abilitata:
- **Riduzione spazio**: ~70-90% (dipende dai dati)
- **Tempo backup**: Leggermente più lento
- **Tempo restore**: Leggermente più lento

## Sicurezza

- I backup contengono dati sensibili (password hash, email, etc.)
- Proteggi la directory `BACKUP_DIR` con permessi appropriati
- Non committare backup nel repository Git
- Considera encryption per backup offsite

## Riferimenti

- Vedi `scripts/backup-db.js` per implementazione completa
- Vedi `scripts/test-restore.js` per test restore
- Vedi `env.example` per configurazione variabili

