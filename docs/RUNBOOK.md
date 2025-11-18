# CouponGen Runbook

## Environments
- Production: Railway service (Node app) with persistent volume for data/uploads
- Staging: Railway service separato con `.env` dedicato

## Deploy (Railway)
1. Collega il repo a Railway o usa `railway up`
2. Imposta variabili: `SESSION_SECRET`, `DEFAULT_TENANT_SLUG`, `MAIL_*`, `ENFORCE_TENANT_PREFIX=true`
3. Verifica `/healthz` restituisce `{ ok: true }`

## Migrations
- On app start, schema is migrated idempotently via `schema_migrations`
- Zero-downtime: migrations are additive; data backfill runs automatically

## Sessions
- **In-memory store (default)**: Le sessioni sono gestite in memoria. Su Railway con single instance funziona perfettamente.
- **Redis OPZIONALE**: Usa Redis solo se hai bisogno di scaling multi-instance o persistenza sessioni tra deploy (`REDIS_URL`).
- Cookie flags: `secure` (dietro HTTPS), `httpOnly`, `sameSite=lax`

## Backups (SQLite)
- Files to back up: `data/coupons.db`
- Schedule: daily cron; retain 7/30 days
- Command example:
  - Copy: `cp data/coupons.db backups/coupons-$(date +%F).db`
  - Compress: `gzip backups/coupons-$(date +%F).db`
- Restore:
  - Stop app, replace `data/coupons.db`, start app

## Logs & Monitoring
- Structured logs printed to stdout with `requestId` and `tenant`
- Monitor: uptime check on `/healthz`, latency alert, error rate via log tail

## Incident Response
- Rollback: `railway rollback` (torna a deployment precedente) oppure `git checkout <prev> && railway up`
- Disable legacy → tenant redirects: set `ENFORCE_TENANT_PREFIX=false`
- Lock down login abuse: adjust `LOGIN_*` envs; consider firewall rules
- Restart app: `railway restart`

## Tenants Operations
- Create tenant: `POST /api/signup` with `tenantName`, `adminUsername`, `adminPassword`
- Default tenant slug: `DEFAULT_TENANT_SLUG`
- Isolation: all URLs must include `/t/{slug}`; legacy paths redirected

## Security Checklist
- Rotate `SESSION_SECRET` periodically
- Use HTTPS-only cookies (set `secure` and force HTTPS in Nginx)
- Validate email provider credentials and bounce settings
- Whitelist MIME types for uploads; size limits enforced

## Staging Checklist
- Seed two tenants (e.g., `default`, `demo`)
- Verify admin/store flows, uploads, analytics, exports
- Verify isolation: tenant A cannot see B’s data
- Load test key endpoints for p95 sanity

## Restore Drill
- Quarterly: take a backup, simulate DB loss, and restore; verify app works
