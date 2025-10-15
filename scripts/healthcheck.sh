#!/usr/bin/env bash
set -euo pipefail

PROD_URL="${1:-https://platform.coupongen.it/healthz}"
STAGING_URL="${2:-https://staging.coupongen.it/healthz}"

check() {
  local url="$1"
  local name="$2"
  http_code=$(curl -sk -o /dev/null -w "%{http_code}" "$url" || true)
  if [[ "$http_code" == "200" ]]; then
    echo "[$name] OK ($http_code) - $url"
  else
    echo "[$name] DOWN ($http_code) - $url" >&2
    return 1
  fi
}

rc=0
check "$PROD_URL" "PROD" || rc=1
check "$STAGING_URL" "STAGING" || rc=1
exit $rc


