# CouponGen Runbook

## Environments
- Production: single Droplet (Node app + Redis via docker-compose) behind Nginx
- Staging: mirror of production with separate `.env`

## Deploy (Docker Compose)
1. Copy repo and `.env` (from `env.example`)
2. Set `SESSION_SECRET`, `DEFAULT_TENANT_SLUG`, `MAIL_*`, `ENFORCE_TENANT_PREFIX=true`
3. `docker compose up -d --build`
4. Configure Nginx with `nginx.conf.example` and TLS (Let’s Encrypt)
5. Verify `/healthz` returns `{ ok: true }`

## Migrations
- On app start, schema is migrated idempotently via `schema_migrations`
- Zero-downtime: migrations are additive; data backfill runs automatically

## Sessions
- In production, sessions use Redis (`REDIS_URL`)
- Cookie flags: `secure` (when behind HTTPS), `httpOnly`, `sameSite=lax`

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
- Rollback: `git checkout <prev> && docker compose up -d --build`
- Disable legacy → tenant redirects: set `ENFORCE_TENANT_PREFIX=false`
- Lock down login abuse: adjust `LOGIN_*` envs; consider firewall rules

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
