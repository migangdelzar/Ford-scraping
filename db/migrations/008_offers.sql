ALTER TABLE ford.promotions RENAME TO offers;

ALTER TABLE ford.offers
  ADD COLUMN IF NOT EXISTS offer_type TEXT NOT NULL DEFAULT 'promotion',
  ADD COLUMN IF NOT EXISTS provider TEXT,
  ADD COLUMN IF NOT EXISTS variant_id UUID REFERENCES ford.variants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cash_price NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS discount_percent NUMERIC(7,2),
  ADD COLUMN IF NOT EXISTS down_payment_amount NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS down_payment_percent NUMERIC(7,2),
  ADD COLUMN IF NOT EXISTS monthly_payment NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS term_months INTEGER,
  ADD COLUMN IF NOT EXISTS months_without_interest INTEGER,
  ADD COLUMN IF NOT EXISTS annual_interest_rate NUMERIC(7,4),
  ADD COLUMN IF NOT EXISTS cat_percent NUMERIC(7,4),
  ADD COLUMN IF NOT EXISTS currency CHAR(3) NOT NULL DEFAULT 'MXN',
  ADD COLUMN IF NOT EXISTS requires_credit_approval BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS conditions TEXT,
  ADD COLUMN IF NOT EXISTS content_hash TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE ford.offers
SET content_hash = encode(digest(
  coalesce(title, '') || '|' || coalesce(description, '') || '|' ||
  coalesce(valid_from::text, '') || '|' || coalesce(valid_until::text, ''),
  'sha256'
), 'hex')
WHERE content_hash IS NULL;

ALTER TABLE ford.offers
  ALTER COLUMN content_hash SET NOT NULL;

ALTER TABLE ford.offers
  ADD CONSTRAINT offers_type_check CHECK (
    offer_type IN ('promotion', 'discount', 'financing', 'months_without_interest',
                   'cashback', 'lease', 'trade_in', 'other')
  ),
  ADD CONSTRAINT offers_months_check CHECK (
    months_without_interest IS NULL OR months_without_interest >= 0
  ),
  ADD CONSTRAINT offers_term_check CHECK (term_months IS NULL OR term_months > 0),
  ADD CONSTRAINT offers_rate_check CHECK (
    annual_interest_rate IS NULL OR annual_interest_rate >= 0
  ),
  ADD CONSTRAINT offers_dates_check CHECK (
    valid_until IS NULL OR valid_from IS NULL OR valid_until >= valid_from
  );

ALTER TABLE ford.documents
  ADD COLUMN IF NOT EXISTS offer_id UUID REFERENCES ford.offers(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS offers_model_year_idx ON ford.offers(model_year_id);
CREATE INDEX IF NOT EXISTS offers_variant_idx ON ford.offers(variant_id);
CREATE INDEX IF NOT EXISTS offers_type_idx ON ford.offers(offer_type);
CREATE INDEX IF NOT EXISTS offers_validity_idx ON ford.offers(valid_from, valid_until);
CREATE INDEX IF NOT EXISTS offers_msi_idx ON ford.offers(months_without_interest);
CREATE INDEX IF NOT EXISTS offers_content_hash_idx ON ford.offers(content_hash);
CREATE INDEX IF NOT EXISTS documents_offer_id_idx ON ford.documents(offer_id);
