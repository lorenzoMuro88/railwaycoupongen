-- Add per-tenant email sender fields and Mailgun domain/region
PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

-- tenants: optional custom domain for host-based routing (future use)
ALTER TABLE tenants ADD COLUMN custom_domain TEXT;

-- tenants: email sender personalization
ALTER TABLE tenants ADD COLUMN email_from_name TEXT;           -- Display name, e.g., "Brand Cliente"
ALTER TABLE tenants ADD COLUMN email_from_address TEXT;        -- Full email address, e.g., "no-reply@dominiocliente.it"

-- tenants: Mailgun per-tenant domain and region (use global API key unless customized later)
ALTER TABLE tenants ADD COLUMN mailgun_domain TEXT;            -- e.g., "mg.dominiocliente.it" or "dominio.mailgun.org"
ALTER TABLE tenants ADD COLUMN mailgun_region TEXT;            -- 'eu' | 'us' (optional, defaults to global setting)

COMMIT;

-- Optional indexes/uniqueness (keep flexible; enforce uniqueness in app logic if needed)
-- CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_custom_domain ON tenants(custom_domain) WHERE custom_domain IS NOT NULL;


