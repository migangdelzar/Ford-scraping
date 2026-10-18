CREATE OR REPLACE VIEW ford_read.offers_v2
WITH (security_barrier = true)
AS
SELECT offer.*,
       source.tax_rate_percent,
       source.opening_commission_rate_percent,
       source.maximum_down_payment_percent,
       source.life_insurance_price
FROM ford_read.offers_v1 offer
JOIN ford.offers source ON source.id = offer.promotion_id;

CREATE OR REPLACE VIEW ford_read.promotions_v3
WITH (security_barrier = true)
AS
SELECT *
FROM ford_read.offers_v2
WHERE offer_type IN ('promotion', 'discount', 'cashback', 'trade_in');

CREATE OR REPLACE VIEW ford_read.comparison_facts_v2
WITH (security_barrier = true)
AS
SELECT comparison.*,
       comparison.source_url AS comparison_url
FROM ford_read.comparison_facts_v1 comparison;

CREATE OR REPLACE VIEW ford_read.catalog_pages_v1
WITH (security_barrier = true)
AS
SELECT page.url AS source_url,
       page.title,
       page.page_type,
       page.http_status,
       page.crawled_at AS observed_at,
       page.last_changed_at,
       page.crawl_error
FROM ford.pages page;

COMMENT ON VIEW ford_read.offers_v2 IS
  'Versioned read-only offer evidence including structured Ford Credit inputs when present.';
COMMENT ON VIEW ford_read.promotions_v3 IS
  'Versioned read-only dealer promotions projected from offers_v2.';
COMMENT ON VIEW ford_read.comparison_facts_v2 IS
  'Versioned read-only comparison facts with the exact source comparison URL.';
COMMENT ON VIEW ford_read.catalog_pages_v1 IS
  'Versioned page registry distinguishing known pages with no links from unknown URLs.';
