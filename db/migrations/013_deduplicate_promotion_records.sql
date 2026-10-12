WITH ranked_promotions AS (
  SELECT o.id,
         row_number() OVER (
           PARTITION BY o.offer_type, o.external_key
           ORDER BY
             (o.model_year_id IS NOT NULL) DESC,
             (page.url LIKE '%/') DESC,
             page.crawled_at DESC NULLS LAST,
             o.created_at,
             o.id
         ) AS duplicate_rank
  FROM ford.offers o
  LEFT JOIN ford.pages page ON page.id = o.source_page_id
  WHERE o.offer_type = 'promotion' AND o.external_key IS NOT NULL
)
DELETE FROM ford.offers o
USING ranked_promotions duplicate
WHERE o.id = duplicate.id AND duplicate.duplicate_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS offers_type_external_key_uidx
  ON ford.offers(offer_type, external_key)
  WHERE external_key IS NOT NULL;
