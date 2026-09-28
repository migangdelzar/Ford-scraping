CREATE SCHEMA IF NOT EXISTS ford;

CREATE TABLE ford.sources (
  id BIGSERIAL PRIMARY KEY,
  base_url TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ford.pages (
  id BIGSERIAL PRIMARY KEY,
  source_id BIGINT NOT NULL REFERENCES ford.sources(id),
  url TEXT NOT NULL UNIQUE,
  canonical_url TEXT,
  page_type TEXT NOT NULL DEFAULT 'unknown',
  http_status INTEGER,
  content_type TEXT,
  title TEXT,
  raw_html TEXT,
  extracted_text TEXT,
  content_hash TEXT,
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  crawled_at TIMESTAMPTZ,
  last_changed_at TIMESTAMPTZ,
  crawl_error TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE ford.models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand TEXT NOT NULL DEFAULT 'Ford',
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  slug TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (brand, normalized_name)
);

CREATE TABLE ford.model_years (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id UUID NOT NULL REFERENCES ford.models(id) ON DELETE CASCADE,
  model_year INTEGER NOT NULL,
  display_name TEXT,
  source_page_id BIGINT REFERENCES ford.pages(id),
  starting_price NUMERIC(14, 2),
  currency CHAR(3) NOT NULL DEFAULT 'MXN',
  price_label TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (model_id, model_year)
);

CREATE TABLE ford.categories (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  normalized_name TEXT NOT NULL UNIQUE
);

CREATE TABLE ford.model_year_categories (
  model_year_id UUID NOT NULL REFERENCES ford.model_years(id) ON DELETE CASCADE,
  category_id BIGINT NOT NULL REFERENCES ford.categories(id) ON DELETE CASCADE,
  source_page_id BIGINT REFERENCES ford.pages(id),
  PRIMARY KEY (model_year_id, category_id)
);

CREATE TABLE ford.variants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_year_id UUID NOT NULL REFERENCES ford.model_years(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  trim_name TEXT,
  price NUMERIC(14, 2),
  currency CHAR(3) NOT NULL DEFAULT 'MXN',
  source_page_id BIGINT REFERENCES ford.pages(id),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (model_year_id, normalized_name)
);

CREATE TABLE ford.specifications (
  id BIGSERIAL PRIMARY KEY,
  variant_id UUID REFERENCES ford.variants(id) ON DELETE CASCADE,
  model_year_id UUID REFERENCES ford.model_years(id) ON DELETE CASCADE,
  category TEXT,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  value_text TEXT,
  value_numeric NUMERIC,
  unit TEXT,
  source_page_id BIGINT REFERENCES ford.pages(id),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE ford.features (
  id BIGSERIAL PRIMARY KEY,
  variant_id UUID REFERENCES ford.variants(id) ON DELETE CASCADE,
  model_year_id UUID REFERENCES ford.model_years(id) ON DELETE CASCADE,
  category TEXT,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  description TEXT,
  source_page_id BIGINT REFERENCES ford.pages(id),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE ford.images (
  id BIGSERIAL PRIMARY KEY,
  model_year_id UUID REFERENCES ford.model_years(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES ford.variants(id) ON DELETE CASCADE,
  url TEXT NOT NULL UNIQUE,
  alt_text TEXT,
  image_type TEXT,
  width INTEGER,
  height INTEGER,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE ford.promotions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_year_id UUID REFERENCES ford.model_years(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  valid_from DATE,
  valid_until DATE,
  source_page_id BIGINT REFERENCES ford.pages(id),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE ford.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id UUID REFERENCES ford.models(id) ON DELETE CASCADE,
  model_year_id UUID REFERENCES ford.model_years(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES ford.variants(id) ON DELETE CASCADE,
  page_id BIGINT REFERENCES ford.pages(id) ON DELETE CASCADE,
  document_type TEXT NOT NULL,
  title TEXT,
  content TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'es',
  content_hash TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  search_vector TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('spanish', coalesce(title, '') || ' ' || content)
  ) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (content_hash)
);

CREATE TABLE ford.document_embeddings (
  document_id UUID PRIMARY KEY REFERENCES ford.documents(id) ON DELETE CASCADE,
  embedding VECTOR(1024),
  embedding_model TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'failed')),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
