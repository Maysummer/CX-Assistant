-- Run once if you already created tables from the earlier single-tenant schema.sql
-- Topic 2: multi-merchant sessions + owner follow-ups + optional merchant_scoped_id on catalogue tables.

-- owner_follow_ups
CREATE TABLE IF NOT EXISTS owner_follow_ups (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_scoped_id   TEXT NOT NULL,
  instagram_customer_id TEXT NOT NULL,
  summary              TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'open',
  created_at           TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS owner_follow_ups_merchant_status_idx
  ON owner_follow_ups (merchant_scoped_id, status);

-- sessions → composite unique (merchant + customer)
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS merchant_scoped_id TEXT DEFAULT 'default';
UPDATE sessions SET merchant_scoped_id = 'default' WHERE merchant_scoped_id IS NULL;
ALTER TABLE sessions ALTER COLUMN merchant_scoped_id SET NOT NULL;

ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_instagram_user_id_key;
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_merchant_customer_unique;

CREATE UNIQUE INDEX IF NOT EXISTS sessions_merchant_customer_uidx
  ON sessions (merchant_scoped_id, instagram_user_id);

-- Optional tenant column on catalogue (Supabase fallback)
ALTER TABLE products ADD COLUMN IF NOT EXISTS merchant_scoped_id TEXT;
ALTER TABLE faqs ADD COLUMN IF NOT EXISTS merchant_scoped_id TEXT;

-- store_config: migrate from global unique(key) to (merchant_scoped_id, key)
ALTER TABLE store_config ADD COLUMN IF NOT EXISTS merchant_scoped_id TEXT DEFAULT 'default';
UPDATE store_config SET merchant_scoped_id = 'default' WHERE merchant_scoped_id IS NULL;

ALTER TABLE store_config DROP CONSTRAINT IF EXISTS store_config_key_key;
ALTER TABLE store_config DROP CONSTRAINT IF EXISTS store_config_merchant_key_unique;

CREATE UNIQUE INDEX IF NOT EXISTS store_config_merchant_key_uidx
  ON store_config (merchant_scoped_id, key);

-- store_info: structured merchant-specific store metadata for fallback and frontend use
CREATE TABLE IF NOT EXISTS store_info (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_scoped_id TEXT NOT NULL DEFAULT 'default',
  store_name        TEXT,
  hours             TEXT,
  currency          TEXT,
  instagram_handle  TEXT,
  address           TEXT,
  other_info        JSONB,
  updated_at        TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT store_info_merchant_unique UNIQUE (merchant_scoped_id)
);

-- orders: merchant scope for reporting
ALTER TABLE orders ADD COLUMN IF NOT EXISTS merchant_scoped_id TEXT DEFAULT 'default';
