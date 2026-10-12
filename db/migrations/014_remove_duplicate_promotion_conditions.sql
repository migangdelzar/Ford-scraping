UPDATE ford.offers
SET conditions = NULL,
    updated_at = now()
WHERE offer_type = 'promotion'
  AND conditions IS NOT DISTINCT FROM description;
