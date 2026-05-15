-- Run in Supabase SQL Editor (from guide)

CREATE TABLE products (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  price       NUMERIC(10,2) NOT NULL,
  description TEXT,
  stock       INTEGER DEFAULT 0,
  category    TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE orders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instagram_user_id TEXT NOT NULL,
  items             JSONB NOT NULL,
  status            TEXT DEFAULT 'pending',
  total             NUMERIC(10,2),
  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE sessions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  instagram_user_id TEXT UNIQUE NOT NULL,
  messages          JSONB DEFAULT '[]',
  updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE faqs (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question TEXT NOT NULL,
  answer   TEXT NOT NULL,
  category TEXT
);

CREATE TABLE store_config (
  id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key   TEXT UNIQUE NOT NULL,
  value TEXT NOT NULL
);

-- Optional: full-text search on products (enables .textSearch in Supabase client)
ALTER TABLE products ADD COLUMN IF NOT EXISTS fts tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(name, '') || ' ' || coalesce(description, '') || ' ' || coalesce(category, ''))
  ) STORED;

CREATE INDEX IF NOT EXISTS products_fts_idx ON products USING gin (fts);
