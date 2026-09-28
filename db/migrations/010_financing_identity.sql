ALTER TABLE ford.offers
  ADD COLUMN IF NOT EXISTS external_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS offers_source_external_key_uidx
  ON ford.offers(source_page_id, external_key)
  WHERE external_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS offers_external_key_idx
  ON ford.offers(external_key);
