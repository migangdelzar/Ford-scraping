ALTER TABLE ford.offers
  ADD COLUMN IF NOT EXISTS tax_rate_percent NUMERIC(7,4),
  ADD COLUMN IF NOT EXISTS opening_commission_rate_percent NUMERIC(7,4),
  ADD COLUMN IF NOT EXISTS maximum_down_payment_percent NUMERIC(7,4),
  ADD COLUMN IF NOT EXISTS life_insurance_price NUMERIC(14,2);

UPDATE ford.offers
SET tax_rate_percent = NULLIF(metadata->>'taxRate', '')::numeric,
    opening_commission_rate_percent = NULLIF(metadata->>'openingCommissionRate', '')::numeric,
    maximum_down_payment_percent = NULLIF(metadata->>'maximumDownPaymentPercent', '')::numeric,
    life_insurance_price = NULLIF(metadata->>'lifeInsurance', '')::numeric
WHERE metadata->>'extraction' = 'financing-api';

ALTER TABLE ford.offers
  ADD CONSTRAINT offers_tax_rate_percent_check
    CHECK (tax_rate_percent IS NULL OR tax_rate_percent >= 0),
  ADD CONSTRAINT offers_opening_commission_rate_percent_check
    CHECK (opening_commission_rate_percent IS NULL OR opening_commission_rate_percent >= 0),
  ADD CONSTRAINT offers_maximum_down_payment_percent_check
    CHECK (maximum_down_payment_percent IS NULL OR maximum_down_payment_percent BETWEEN 0 AND 100),
  ADD CONSTRAINT offers_life_insurance_price_check
    CHECK (life_insurance_price IS NULL OR life_insurance_price >= 0);
