#!/usr/bin/env bash
set -euo pipefail

BASE_URL=${BASE_URL:-"http://localhost:3000"}
DEFAULT_SLUG=${DEFAULT_SLUG:-"default"}
DEMO_SLUG=${DEMO_SLUG:-"demo"}
ADMIN_USER=${ADMIN_USER:-"admin"}
ADMIN_PASS=${ADMIN_PASS:-"admin123"}

info() { echo "[INFO] $*"; }

echo "Using BASE_URL=$BASE_URL DEFAULT_SLUG=$DEFAULT_SLUG DEMO_SLUG=$DEMO_SLUG"

# Health
info "Health check"
curl -fsS "$BASE_URL/healthz" | jq . >/dev/null

# Signup demo tenant
info "Signup demo tenant"
curl -fsS -X POST "$BASE_URL/api/signup" \
  -H 'Content-Type: application/json' \
  -c cookies_demo.txt \
  -d '{"tenantName":"Demo","adminUsername":"demoadmin","adminPassword":"demo123"}' | jq .

# Login default admin
info "Login default admin"
curl -fsS -X POST "$BASE_URL/api/login" \
  -H 'Content-Type: application/json' \
  -c cookies_default.txt \
  -d '{"username":"'$ADMIN_USER'","password":"'$ADMIN_PASS'","userType":"admin"}' | jq .

# Create campaign on demo
info "Create campaign on demo"
curl -fsS -X POST "$BASE_URL/t/$DEMO_SLUG/api/admin/campaigns" \
  -H 'Content-Type: application/json' \
  -b cookies_demo.txt \
  -d '{"name":"CampaignDemo","description":"E2E","discount_type":"percent","discount_value":"10"}' | tee demo_campaign.json | jq .
DEMO_CODE=$(jq -r '.campaign_code' demo_campaign.json)

# Activate campaign
info "Activate demo campaign"
DEMO_ID=$(jq -r '.id' demo_campaign.json)
curl -fsS -X PUT "$BASE_URL/t/$DEMO_SLUG/api/admin/campaigns/$DEMO_ID/activate" -b cookies_demo.txt | jq .

# Submit coupon under demo
info "Submit coupon under demo"
curl -fsS -X POST "$BASE_URL/t/$DEMO_SLUG/submit" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d "email=e2e_demo@example.com&firstName=E2E&lastName=Demo&campaign_id=$DEMO_CODE" -I | grep -i "Location:" || true

# Lookup coupon via demo API (best-effort: search store active list)
info "List active coupons (demo)"
curl -fsS "$BASE_URL/t/$DEMO_SLUG/api/store/coupons/active" -b cookies_demo.txt | jq '.[0]'

# Isolation: ensure default tenant cannot see demo campaign
info "Ensure default cannot see demo campaigns"
curl -fsS "$BASE_URL/t/$DEFAULT_SLUG/api/admin/campaigns" -b cookies_default.txt | jq '.[] | select(.name=="CampaignDemo")' | grep -q . && { echo "[ERROR] Leakage detected"; exit 1; } || echo "[OK] No leakage"

echo "E2E smoke completed"
