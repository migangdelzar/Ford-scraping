CREATE OR REPLACE VIEW ford_read.vehicle_variants_v2
WITH (security_barrier = true)
AS
SELECT variant.*,
       (SELECT comparison_page.url
        FROM ford.comparisons comparison
        JOIN ford.pages comparison_page ON comparison_page.id = comparison.source_page_id
        WHERE comparison.variant_id = source_variant.id
        ORDER BY comparison_page.url
        LIMIT 1) AS comparison_url
FROM ford_read.vehicle_variants_v1 variant
JOIN ford.variants source_variant ON source_variant.id = variant.variant_id;

COMMENT ON VIEW ford_read.vehicle_variants_v2 IS
  'Versioned read-only variant evidence with its exact published comparison URL when available.';
