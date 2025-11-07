-- Add tenant_id to form_customization table for multi-tenant isolation
PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

-- Add tenant_id column to form_customization
ALTER TABLE form_customization ADD COLUMN tenant_id INTEGER;

-- Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_form_customization_tenant_id ON form_customization(tenant_id);

-- Migrate existing data: assign to default tenant (if exists)
-- This assumes there's a default tenant with id=1 or slug='default'
-- If no default tenant exists, existing configs will have tenant_id=NULL
-- and will need to be manually assigned or recreated per tenant
UPDATE form_customization 
SET tenant_id = (SELECT id FROM tenants WHERE slug = 'default' LIMIT 1)
WHERE tenant_id IS NULL;

COMMIT;

