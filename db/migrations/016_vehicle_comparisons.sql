CREATE TABLE IF NOT EXISTS ford.comparisons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_year_id UUID NOT NULL REFERENCES ford.model_years(id) ON DELETE CASCADE,
  variant_id UUID NOT NULL REFERENCES ford.variants(id) ON DELETE CASCADE,
  competitor_make TEXT NOT NULL,
  competitor_model TEXT NOT NULL,
  competitor_year INTEGER,
  competitor_variant TEXT,
  source_page_id BIGINT NOT NULL UNIQUE REFERENCES ford.pages(id) ON DELETE CASCADE,
  raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ford.comparison_attributes (
  id BIGSERIAL PRIMARY KEY,
  comparison_id UUID NOT NULL REFERENCES ford.comparisons(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  value_text TEXT NOT NULL,
  value_numeric NUMERIC,
  unit TEXT,
  raw_data JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS comparisons_model_year_variant_idx
  ON ford.comparisons(model_year_id, variant_id);
CREATE INDEX IF NOT EXISTS comparison_attributes_lookup_idx
  ON ford.comparison_attributes(comparison_id, normalized_name);
CREATE INDEX IF NOT EXISTS comparison_attributes_raw_data_idx
  ON ford.comparison_attributes USING GIN(raw_data);
