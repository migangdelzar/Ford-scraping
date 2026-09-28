CREATE TABLE ford.sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'succeeded', 'failed')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  counters JSONB NOT NULL DEFAULT '{}'::jsonb,
  error JSONB
);

CREATE INDEX sync_runs_started_at_idx ON ford.sync_runs(started_at DESC);

CREATE TABLE ford.used_vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  price NUMERIC(14, 2),
  currency CHAR(3) NOT NULL DEFAULT 'MXN',
  mileage_km INTEGER,
  transmission TEXT,
  image_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  detail_url TEXT,
  source_url TEXT NOT NULL,
  source_page_id BIGINT REFERENCES ford.pages(id) ON DELETE SET NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  content_hash TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  CHECK (price IS NULL OR price >= 0),
  CHECK (mileage_km IS NULL OR mileage_km >= 0),
  CHECK (transmission IS NULL OR transmission IN ('automatic', 'manual', 'other'))
);

CREATE INDEX used_vehicles_active_idx ON ford.used_vehicles(active);
CREATE INDEX used_vehicles_price_idx ON ford.used_vehicles(price);
CREATE INDEX used_vehicles_mileage_idx ON ford.used_vehicles(mileage_km);
CREATE INDEX used_vehicles_transmission_idx ON ford.used_vehicles(transmission);
