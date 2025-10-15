#!/usr/bin/env bash
set -euo pipefail

# Backup CouponGen SQLite DBs and uploads for prod and staging
# Retention: 7 days

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")"/.. && pwd)"
BACKUP_DIR="$ROOT_DIR/backups"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"

mkdir -p "$BACKUP_DIR"

echo "[Backup] Starting at $TIMESTAMP"

# Database backups (if exist)
if [[ -f "$ROOT_DIR/data/coupons.db" ]]; then
  gzip -c "$ROOT_DIR/data/coupons.db" > "$BACKUP_DIR/coupons-prod-$TIMESTAMP.db.gz"
  echo "[Backup] Saved prod DB -> $BACKUP_DIR/coupons-prod-$TIMESTAMP.db.gz"
fi

if [[ -f "$ROOT_DIR/data-staging/coupons.db" ]]; then
  gzip -c "$ROOT_DIR/data-staging/coupons.db" > "$BACKUP_DIR/coupons-staging-$TIMESTAMP.db.gz"
  echo "[Backup] Saved staging DB -> $BACKUP_DIR/coupons-staging-$TIMESTAMP.db.gz"
fi

# Uploads archives (may be large)
if [[ -d "$ROOT_DIR/static/uploads" ]]; then
  tar -czf "$BACKUP_DIR/uploads-prod-$TIMESTAMP.tar.gz" -C "$ROOT_DIR/static" uploads
  echo "[Backup] Saved prod uploads -> $BACKUP_DIR/uploads-prod-$TIMESTAMP.tar.gz"
fi

if [[ -d "$ROOT_DIR/static/uploads-staging" ]]; then
  tar -czf "$BACKUP_DIR/uploads-staging-$TIMESTAMP.tar.gz" -C "$ROOT_DIR/static" uploads-staging
  echo "[Backup] Saved staging uploads -> $BACKUP_DIR/uploads-staging-$TIMESTAMP.tar.gz"
fi

# Retention policy: delete files older than 7 days
find "$BACKUP_DIR" -type f -mtime +7 -print -delete || true

echo "[Backup] Completed."


