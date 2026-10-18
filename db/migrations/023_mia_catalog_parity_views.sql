-- Forward-only catalog read-contract expansion. Keep prior migrations immutable.
CREATE SCHEMA IF NOT EXISTS ford_read;

CREATE OR REPLACE VIEW ford_read.vehicle_variants_v1
WITH (security_barrier = true)
AS
SELECT v.id AS variant_id,
       my.id AS model_year_id,
       m.name AS model,
       m.normalized_name AS normalized_model,
       my.model_year AS year,
       coalesce(v.trim_name, v.name) AS trim,
       coalesce(v.normalized_name, lower(v.name)) AS normalized_trim,
       v.price,
       v.currency::text AS currency,
       model_page.url AS model_page_url,
       coalesce(price_page.url, comparison_page.url, variant_page.url) AS price_source_url,
       coalesce(price_page.crawled_at, comparison_page.crawled_at, variant_page.crawled_at) AS observed_at
FROM ford.variants v
JOIN ford.model_years my ON my.id = v.model_year_id
JOIN ford.models m ON m.id = my.model_id
LEFT JOIN ford.pages variant_page ON variant_page.id = v.source_page_id
LEFT JOIN LATERAL (
  SELECT p.url, p.crawled_at
  FROM ford.variants model_variant
  JOIN ford.pages p ON p.id = model_variant.source_page_id
  WHERE model_variant.model_year_id = my.id AND p.page_type = 'model'
  ORDER BY p.crawled_at DESC NULLS LAST, p.id DESC
  LIMIT 1
) model_page ON true
LEFT JOIN LATERAL (
  SELECT p.url, p.crawled_at
  FROM ford.specifications s
  JOIN ford.pages p ON p.id = s.source_page_id
  WHERE s.normalized_name = 'precio'
    AND (s.variant_id = v.id OR (s.variant_id IS NULL AND s.model_year_id = my.id))
  ORDER BY (s.variant_id = v.id) DESC, s.id DESC
  LIMIT 1
) price_page ON true
LEFT JOIN LATERAL (
  SELECT p.url, p.crawled_at
  FROM ford.comparisons c
  JOIN ford.pages p ON p.id = c.source_page_id
  WHERE c.variant_id = v.id
  ORDER BY p.crawled_at DESC NULLS LAST, p.id DESC
  LIMIT 1
) comparison_page ON true
WHERE my.active IS TRUE;

CREATE OR REPLACE VIEW ford_read.vehicle_facts_v2
WITH (security_barrier = true)
AS
SELECT s.variant_id,
       my.id AS model_year_id,
       m.name AS model,
       my.model_year AS year,
       coalesce(v.trim_name, v.name) AS trim,
       s.category,
       'specification'::text AS fact_type,
       s.name AS fact_name,
       s.normalized_name AS fact_name_normalized,
       coalesce(s.value_text, s.value_numeric::text) AS fact_value,
       s.value_numeric,
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
  AND btrim(coalesce(s.value_text, s.value_numeric::text)) NOT IN ('', '-', '—')
  AND fact_source.url IS NOT NULL AND fact_source.crawled_at IS NOT NULL
UNION ALL
SELECT f.variant_id,
       my.id AS model_year_id,
       m.name AS model,
       my.model_year AS year,
       coalesce(v.trim_name, v.name) AS trim,
       f.category,
       'feature'::text AS fact_type,
       f.name AS fact_name,
       f.normalized_name AS fact_name_normalized,
       f.description AS fact_value,
       NULL::numeric AS value_numeric,
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
WHERE f.description IS NOT NULL AND btrim(f.description) <> ''
  AND fact_source.url IS NOT NULL AND fact_source.crawled_at IS NOT NULL;

CREATE OR REPLACE VIEW ford_read.offers_v1
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
       o.offer_type,
       o.provider,
       o.down_payment_amount,
       o.down_payment_percent,
       o.monthly_payment,
       o.term_months,
       o.months_without_interest,
       o.annual_interest_rate,
       o.cat_percent,
       o.requires_credit_approval,
       source.url AS source_url,
       source.crawled_at AS observed_at,
       coalesce(o.metadata->>'modelUrl', model_page.url) AS model_page_url,
       o.metadata->'benefits' AS benefits,
       o.metadata->'termConflict' AS term_conflict
FROM ford.offers o
LEFT JOIN ford.model_years my ON my.id = o.model_year_id
LEFT JOIN ford.models m ON m.id = my.model_id
LEFT JOIN ford.pages source ON source.id = o.source_page_id
LEFT JOIN LATERAL (
  SELECT p.url
  FROM ford.variants v
  JOIN ford.pages p ON p.id = v.source_page_id
  WHERE v.model_year_id = my.id AND p.page_type = 'model'
  ORDER BY p.crawled_at DESC NULLS LAST, p.id DESC
  LIMIT 1
) model_page ON true;

CREATE OR REPLACE VIEW ford_read.promotions_v2
WITH (security_barrier = true)
AS
SELECT *
FROM ford_read.offers_v1
WHERE offer_type IN ('promotion', 'discount', 'cashback', 'trade_in');

CREATE OR REPLACE VIEW ford_read.page_links_v1
WITH (security_barrier = true)
AS
SELECT source.url AS source_page_url,
       source.page_type AS source_page_type,
       source.crawled_at AS observed_at,
       link.href,
       link.target_url,
       link.anchor_text,
       link.rel,
       link.is_internal,
       link.link_type
FROM ford.page_links link
JOIN ford.pages source ON source.id = link.source_page_id
UNION ALL
SELECT source.url AS source_page_url,
       source.page_type AS source_page_type,
       source.crawled_at AS observed_at,
       comparison_page.url AS href,
       comparison_page.url AS target_url,
       'Compáralo en el mercado' AS anchor_text,
       ''::text AS rel,
       true AS is_internal,
       'internal'::text AS link_type
FROM ford.variants variant
JOIN ford.pages source ON source.id = variant.source_page_id
JOIN ford.comparisons comparison ON comparison.variant_id = variant.id
JOIN ford.pages comparison_page ON comparison_page.id = comparison.source_page_id;

CREATE OR REPLACE VIEW ford_read.vehicle_images_v1
WITH (security_barrier = true)
AS
SELECT m.name AS model,
       my.model_year AS year,
       coalesce(v.trim_name, v.name) AS trim,
       image.url AS image_url,
       image.alt_text,
       image.image_type,
       image.width,
       image.height,
       source.url AS source_url,
       source.crawled_at AS observed_at
FROM ford.images image
LEFT JOIN ford.model_years my ON my.id = coalesce(image.model_year_id,
  (SELECT variant.model_year_id FROM ford.variants variant WHERE variant.id = image.variant_id))
LEFT JOIN ford.models m ON m.id = my.model_id
LEFT JOIN ford.variants v ON v.id = image.variant_id
LEFT JOIN ford.pages source ON source.id = image.source_page_id;

CREATE OR REPLACE VIEW ford_read.comparison_facts_v1
WITH (security_barrier = true)
AS
SELECT m.name AS model,
       my.model_year AS year,
       coalesce(v.trim_name, v.name) AS trim,
       comparison.competitor_make,
       comparison.competitor_model,
       comparison.competitor_year,
       comparison.competitor_variant,
       attribute.category,
       attribute.name AS fact_name,
       attribute.value_text AS fact_value,
       attribute.unit AS fact_unit,
       source.url AS source_url,
       source.crawled_at AS observed_at
FROM ford.comparisons comparison
JOIN ford.model_years my ON my.id = comparison.model_year_id
JOIN ford.models m ON m.id = my.model_id
JOIN ford.variants v ON v.id = comparison.variant_id
JOIN ford.comparison_attributes attribute ON attribute.comparison_id = comparison.id
LEFT JOIN ford.pages source ON source.id = comparison.source_page_id;

CREATE OR REPLACE VIEW ford_read.provenance_v1
WITH (security_barrier = true)
AS
SELECT m.name AS model,
       my.model_year AS year,
       coalesce(v.trim_name, v.name) AS trim,
       p.url AS source_url,
       p.page_type,
       p.title,
       p.http_status,
       p.crawled_at AS observed_at,
       p.last_changed_at,
       p.crawl_error
FROM ford.model_years my
JOIN ford.models m ON m.id = my.model_id
LEFT JOIN ford.variants v ON v.model_year_id = my.id
LEFT JOIN ford.pages p ON p.id = coalesce(v.source_page_id, my.source_page_id);

CREATE OR REPLACE VIEW ford_read.document_provenance_v1
WITH (security_barrier = true)
AS
SELECT d.id AS document_id,
       d.content_hash,
       source.content_hash AS page_content_hash,
       d.title,
       d.document_type,
       m.name AS model,
       my.model_year AS year,
       coalesce(v.trim_name, v.name) AS trim,
       source.url AS source_url,
       coalesce(d.metadata->>'modelUrl', model_page.url) AS model_page_url,
       source.crawled_at AS observed_at
FROM ford.documents d
LEFT JOIN ford.model_years my ON my.id = d.model_year_id
LEFT JOIN ford.models m ON m.id = my.model_id
LEFT JOIN ford.variants v ON v.id = d.variant_id
LEFT JOIN ford.pages source ON source.id = d.page_id
LEFT JOIN LATERAL (
  SELECT p.url
  FROM ford.variants model_variant
  JOIN ford.pages p ON p.id = model_variant.source_page_id
  WHERE model_variant.model_year_id = my.id AND p.page_type = 'model'
  ORDER BY p.crawled_at DESC NULLS LAST, p.id DESC
  LIMIT 1
) model_page ON true;

CREATE OR REPLACE VIEW ford_read.catalog_status_v1
WITH (security_barrier = true)
AS
SELECT (SELECT count(*) FROM ford.models) AS model_count,
       (SELECT count(*) FROM ford.model_years WHERE active IS TRUE) AS active_model_year_count,
       (SELECT count(*) FROM ford.variants) AS variant_count,
       (SELECT count(*) FROM ford.pages) AS page_count,
       (SELECT count(*) FROM ford.documents) AS document_count,
       (SELECT count(*) FROM ford.document_embeddings WHERE status = 'ready') AS embedded_document_count,
       (SELECT count(*) FROM ford.document_embeddings WHERE status = 'pending') AS pending_embedding_count,
       (SELECT max(crawled_at) FROM ford.pages) AS latest_page_crawl_at,
       (SELECT status FROM ford.sync_runs ORDER BY started_at DESC LIMIT 1) AS latest_sync_status,
       (SELECT started_at FROM ford.sync_runs ORDER BY started_at DESC LIMIT 1) AS latest_sync_started_at,
       (SELECT finished_at FROM ford.sync_runs ORDER BY started_at DESC LIMIT 1) AS latest_sync_finished_at;

COMMENT ON VIEW ford_read.vehicle_variants_v1 IS
  'Versioned read-only Ford variant prices and source evidence.';
COMMENT ON VIEW ford_read.vehicle_facts_v2 IS
  'Versioned read-only MÍA facts with variant identity, categories, normalized names, numeric values, and complete source evidence.';
COMMENT ON VIEW ford_read.offers_v1 IS
  'Versioned read-only source-backed Ford offer and financing terms. No payment calculations are performed.';
COMMENT ON VIEW ford_read.promotions_v2 IS
  'Versioned read-only dealer promotions projected from source-backed offers.';
COMMENT ON VIEW ford_read.page_links_v1 IS
  'Versioned read-only links found on crawled Ford pages.';
COMMENT ON VIEW ford_read.vehicle_images_v1 IS
  'Versioned read-only vehicle image URLs and their source evidence.';
COMMENT ON VIEW ford_read.comparison_facts_v1 IS
  'Versioned read-only Ford-versus-competitor comparison facts with source links.';
COMMENT ON VIEW ford_read.provenance_v1 IS
  'Versioned read-only catalog provenance, crawl status, and timestamps.';
COMMENT ON VIEW ford_read.document_provenance_v1 IS
  'Versioned read-only provenance lookup by stable document identifier.';
COMMENT ON VIEW ford_read.catalog_status_v1 IS
  'Versioned aggregate catalog and latest sync status; exposes no credentials or customer data.';
