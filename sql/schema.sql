-- Run in Supabase SQL Editor
-- Topic 2 (Instagram CX) + optional Supabase fallback when Topic 1 API is offline.
-- Topic 1 (AI StoreBuilder) owns canonical catalogue in production — see storefrontApi.js.

-- Products catalogue (demo / cache; optional merchant_scoped_id aligns with Meta entry.id / Topic 1)
CREATE TABLE IF NOT EXISTS products (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  price       NUMERIC(10,2) NOT NULL,
  description TEXT,
  stock       INTEGER DEFAULT 0,
  category    TEXT,
  merchant_scoped_id TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Orders (CX bot may insert; Topic 1 may be source of truth for checkout — sync via API when ready)
CREATE TABLE IF NOT EXISTS orders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instagram_user_id TEXT NOT NULL,
  merchant_scoped_id TEXT DEFAULT 'default',
  items             JSONB NOT NULL,
  status            TEXT DEFAULT 'pending',
  total             NUMERIC(10,2),
  created_at        TIMESTAMPTZ DEFAULT now()
);

-- Session memory: one row per (merchant, Instagram customer PSID)
CREATE TABLE IF NOT EXISTS sessions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_scoped_id TEXT NOT NULL DEFAULT 'default',
  instagram_user_id TEXT NOT NULL,
  messages          JSONB DEFAULT '[]',
  updated_at        TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT sessions_merchant_customer_unique UNIQUE (merchant_scoped_id, instagram_user_id)
);

-- FAQs
CREATE TABLE IF NOT EXISTS faqs (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question TEXT NOT NULL,
  answer   TEXT NOT NULL,
  category TEXT,
  merchant_scoped_id TEXT
);

-- Store config (name, hours, policies, etc.)
CREATE TABLE IF NOT EXISTS store_config (
  id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key   TEXT NOT NULL,
  value TEXT NOT NULL,
  merchant_scoped_id TEXT,
  CONSTRAINT store_config_merchant_key_unique UNIQUE (merchant_scoped_id, key)
);

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

-- SME owner reminders (Topic 2 — dashboard / push notifications; not sent to IG customer)
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

CREATE TABLE IF NOT EXISTS conversation_modes (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_scoped_id   TEXT NOT NULL,
  instagram_customer_id TEXT NOT NULL,
  mode                 TEXT NOT NULL DEFAULT 'auto',
  manual_until         TIMESTAMPTZ,
  updated_at           TIMESTAMPTZ DEFAULT now(),
  created_at           TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT conversation_modes_unique UNIQUE (merchant_scoped_id, instagram_customer_id)
);
