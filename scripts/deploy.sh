#!/usr/bin/env bash
set -euo pipefail

# CouponGen deploy bootstrap for a fresh Ubuntu 22.04 Droplet
# - Installs Docker, Compose plugin, Nginx, Certbot, UFW
# - Sets up 2GB swap
# - Creates required directories for prod/staging and backups

if [[ $(id -u) -ne 0 ]]; then
  echo "Please run as root (use: sudo ./scripts/deploy.sh)" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

echo "[1/7] Updating apt and installing base packages..."
apt-get update -y
apt-get install -y \
  ca-certificates curl gnupg lsb-release \
  ufw nginx \
  certbot python3-certbot-nginx \
  git

echo "[2/7] Installing Docker Engine and Compose plugin..."
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker

echo "[3/7] Configuring UFW firewall (22,80,443)..."
ufw allow OpenSSH
ufw allow 80
ufw allow 443
yes | ufw enable || true

echo "[4/7] Ensuring 2G swap is configured..."
if ! swapon --show | grep -q swapfile; then
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  if ! grep -q "/swapfile" /etc/fstab; then
    echo "/swapfile none swap sw 0 0" >> /etc/fstab
  fi
fi

echo "[5/7] Enabling and starting Nginx..."
systemctl enable --now nginx

echo "[6/7] Creating application directories..."
APP_DIR="$(pwd)"
mkdir -p "$APP_DIR/data" "$APP_DIR/static/uploads"
mkdir -p "$APP_DIR/data-staging" "$APP_DIR/static/uploads-staging"
mkdir -p "$APP_DIR/backups"

echo "[7/7] Done. Next steps:"
echo "- Create/adjust .env and .env.staging (see .env.production / .env.staging templates)"
echo "- Start prod: docker compose up -d --build"
echo "- Start staging: docker compose -f docker-compose.staging.yml up -d --build"
echo "- Configure Nginx and run certbot for SSL"


