CREATE SCHEMA IF NOT EXISTS ford_read;

CREATE OR REPLACE VIEW ford_read.vehicle_search_v1
WITH (security_barrier = true)
AS
SELECT my.id AS model_year_id,
       m.name AS model,
       m.normalized_name,
       my.model_year AS year,
       my.starting_price AS price,
       my.currency::text AS currency,
       category.name AS category,
       my.metadata->>'body_type' AS body_type,
       my.metadata->>'fuel_type' AS fuel_type,
       coalesce(model_page.url,
         CASE WHEN price_source.page_type = 'model' THEN price_source.url END) AS model_page_url,
       price_source.url AS price_source_url,
       coalesce(model_page.crawled_at, price_source.crawled_at) AS observed_at
FROM ford.model_years my
JOIN ford.models m ON m.id = my.model_id
LEFT JOIN ford.pages price_source ON price_source.id = my.source_page_id
LEFT JOIN LATERAL (
  SELECT p.url, p.crawled_at
  FROM ford.variants v
  JOIN ford.pages p ON p.id = v.source_page_id
  WHERE v.model_year_id = my.id AND p.page_type = 'model'
  ORDER BY p.crawled_at DESC NULLS LAST, p.id DESC
  LIMIT 1
) model_page ON true
LEFT JOIN LATERAL (
  SELECT c.name
  FROM ford.model_year_categories myc
  JOIN ford.categories c ON c.id = myc.category_id
  WHERE myc.model_year_id = my.id
  ORDER BY c.name
  LIMIT 1
) category ON true
WHERE my.active IS TRUE;

CREATE OR REPLACE VIEW ford_read.vehicle_facts_v1
WITH (security_barrier = true)
AS
SELECT my.id AS model_year_id,
       m.name AS model,
       my.model_year AS year,
       v.name AS trim,
       'specification'::text AS fact_type,
       s.name AS fact_name,
       coalesce(s.value_text, s.value_numeric::text) AS fact_value,
       s.unit AS fact_unit,
       fact_source.url AS source_url,
       fact_source.crawled_at AS observed_at,
       model_page.url AS model_page_url
FROM ford.specifications s
JOIN ford.model_years my ON my.id = coalesce(s.model_year_id,
  (SELECT variant.model_year_id FROM ford.variants variant WHERE variant.id = s.variant_id))
JOIN ford.models m ON m.id = my.model_id
LEFT JOIN ford.variants v ON v.id = s.variant_id
LEFT JOIN ford.pages fact_source ON fact_source.id = s.source_page_id
LEFT JOIN LATERAL (
  SELECT p.url
  FROM ford.variants model_variant
  JOIN ford.pages p ON p.id = model_variant.source_page_id
  WHERE model_variant.model_year_id = my.id AND p.page_type = 'model'
  ORDER BY p.crawled_at DESC NULLS LAST, p.id DESC
  LIMIT 1
) model_page ON true
WHERE coalesce(s.value_text, s.value_numeric::text) IS NOT NULL
  AND btrim(coalesce(s.value_text, s.value_numeric::text)) <> ''
  AND btrim(coalesce(s.value_text, s.value_numeric::text)) NOT IN ('-', '—')
UNION ALL
SELECT my.id AS model_year_id,
       m.name AS model,
       my.model_year AS year,
       v.name AS trim,
       'feature'::text AS fact_type,
       f.name AS fact_name,
       f.description AS fact_value,
       NULL::text AS fact_unit,
       fact_source.url AS source_url,
       fact_source.crawled_at AS observed_at,
       model_page.url AS model_page_url
FROM ford.features f
JOIN ford.model_years my ON my.id = coalesce(f.model_year_id,
  (SELECT variant.model_year_id FROM ford.variants variant WHERE variant.id = f.variant_id))
JOIN ford.models m ON m.id = my.model_id
LEFT JOIN ford.variants v ON v.id = f.variant_id
LEFT JOIN ford.pages fact_source ON fact_source.id = f.source_page_id
LEFT JOIN LATERAL (
  SELECT p.url
  FROM ford.variants model_variant
  JOIN ford.pages p ON p.id = model_variant.source_page_id
  WHERE model_variant.model_year_id = my.id AND p.page_type = 'model'
  ORDER BY p.crawled_at DESC NULLS LAST, p.id DESC
  LIMIT 1
) model_page ON true
WHERE f.description IS NOT NULL AND btrim(f.description) <> '';

CREATE OR REPLACE VIEW ford_read.promotions_v1
WITH (security_barrier = true)
AS
SELECT o.id AS promotion_id,
       m.name AS model,
       my.model_year AS year,
       o.title,
       o.description,
       o.discount_amount,
       o.discount_percent,
       o.cash_price,
       o.currency::text AS currency,
       o.valid_from,
       o.valid_until,
       o.conditions,
       source.url AS source_url,
       source.crawled_at AS observed_at
FROM ford.offers o
LEFT JOIN ford.model_years my ON my.id = o.model_year_id
LEFT JOIN ford.models m ON m.id = my.model_id
LEFT JOIN ford.pages source ON source.id = o.source_page_id
WHERE o.offer_type IN ('promotion', 'discount', 'cashback', 'trade_in');

COMMENT ON VIEW ford_read.vehicle_search_v1 IS
  'Versioned, read-only MÍA search contract. Ford-scraping owns schema and writes.';
COMMENT ON VIEW ford_read.vehicle_facts_v1 IS
  'Versioned, read-only MÍA model facts with direct source URLs and crawl timestamps.';
COMMENT ON VIEW ford_read.promotions_v1 IS
  'Versioned, read-only MÍA dealer promotion evidence. Validity must be checked against an explicit as-of date.';
