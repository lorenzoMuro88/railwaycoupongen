#!/usr/bin/env bash
# CouponGen Deploy Configuration - EXAMPLE
# Copia questo file come deploy-config.sh e modifica i valori

# Configurazione server produzione
export DEPLOY_SERVER="167.172.42.248"
export DEPLOY_USER="root"
export DEPLOY_SSH_KEY=""  # Path alla chiave SSH se usi autenticazione a chiave
export DEPLOY_APP_PATH="/opt/coupongen"
export DEPLOY_BRANCH="feature/migration-cloud-multitenant-prerelease"

# Configurazione server staging (se diverso)
export STAGING_SERVER="167.172.42.248"
export STAGING_USER="root"
export STAGING_APP_PATH="/opt/coupongen"

# Configurazione Docker
export PRODUCTION_COMPOSE_FILE=""
export STAGING_COMPOSE_FILE="-f docker-compose.staging.yml"

# Porte
export PRODUCTION_PORT="3000"
export STAGING_PORT="3001"

# URL applicazioni
export PRODUCTION_URL="https://platform.coupongen.it"
export STAGING_URL="https://staging.coupongen.it"
