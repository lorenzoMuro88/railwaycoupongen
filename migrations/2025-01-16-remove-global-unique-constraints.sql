-- Remove global UNIQUE constraints and add tenant-scoped UNIQUE constraints
-- This allows multiple tenants to have the same campaign_code and name
PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

-- Drop existing unique indexes if they exist
DROP INDEX IF EXISTS idx_campaigns_code;

-- Create tenant-scoped unique indexes
-- campaign_code must be unique per tenant (but can be duplicated across tenants)
CREATE UNIQUE INDEX IF NOT EXISTS idx_campaigns_code_tenant ON campaigns(campaign_code, tenant_id);

-- name must be unique per tenant (but can be duplicated across tenants)
CREATE UNIQUE INDEX IF NOT EXISTS idx_campaigns_name_tenant ON campaigns(name, tenant_id);

COMMIT;

