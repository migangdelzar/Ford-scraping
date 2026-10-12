# Promotion and vehicle comparison ingestion design

## Goal

Make promotion details and Ford's trim-specific Comparativo pages usable as grounded relational and semantic evidence for the Ford MCP.

## Current evidence

- Promotions already store full card text and source provenance, but all 10 current promotion rows have `conditions = NULL`; free insurance and deferred-payment benefits remain buried in prose.
- The catalog has 121 variants, but no variant prices and no specifications, features, or images linked to `variant_id`.
- Model pages expose 46 Comparativo routes. The crawler stores these URLs but does not fetch the routes, and its query-string policy blocks their `exterior` and `interior` parameters.
- A live Expedition 2027 King Ranch Max page contains a structured two-column comparison against Chevrolet Tahoe 2026 High Country across General, Motor, Interior, Seguridad, Transmisión, Llantas, Exterior, and Desempeño.

## Design

1. Classify and crawl only Ford URLs matching `/{MODEL}/{YY|YYYY}/Comparativo/{TRIM}/`, allowing only the source page's `exterior` and `interior` query parameters. Keep ordinary search/filter query URLs excluded.
2. Parse the two vehicle headers, categories, Ford-side attributes, competitor-side values, and direct image URLs. Preserve source wording such as `Sí`, `No`, or missing values without converting ambiguous entries to booleans.
3. Add `ford.comparisons` and `ford.comparison_attributes`. The parent links the Ford model-year, trim, source page, and competitor identity; child facts store normalized names and exact competitor values. Parent JSONB preserves the raw headers, rows, and extraction metadata.
4. Store Ford-side comparison values in existing `ford.specifications` rows linked to `variant_id`. Trim comparisons then use relational joins on normalized attribute names and units. Do not duplicate canonical specs in a second JSONB field.
5. Keep the complete promotion description, extract explicit legal conditions into `conditions`, and persist recognized non-price benefits (for example, free insurance and delayed first payment) as structured JSONB entries in `offers.metadata`. Existing numeric offer columns remain authoritative for price, bonus, financing term, rate, CAT, and validity.
6. Expose exact trim-to-trim and Ford-versus-competitor records via separate deterministic MCP tools. Every fact row carries its Ford page URL. Vector documents summarize only source-extracted comparison and promotion facts; SQL remains the path for exact values.
7. Separate exact document evidence (`ford.documents.content`) from the text sent to the embedder (`semantic_content`). Use source-grounded natural language for model, promotion, and comparison intent; keep exact prices, dates, and attribute values in SQL/JSONB and the evidence text. Price-only chunks and generic whole-page promotion documents opt out of vectors with empty semantic content.
8. Keep image URLs in relational data or JSONB metadata and in MCP responses. Never place image bytes or image URLs in semantic text or vector them.
9. Compare trim and model-year differences at query time from values present on both sides. Do not create an upgrade, redesign, or removed-feature claim from a missing source value. Cross-nameplate comparisons use the existing exact model/year comparison tool; external-brand comparisons use the actual Comparativo page.

## Limits and safeguards

- Never infer that `No` means a verified negative specification when Ford's page uses it ambiguously; preserve the source text.
- No competitor fact is returned unless an ingested Comparativo page provides it.
- Trim and model-year differences are computed only for shared normalized attributes. Missing facts remain unknown.
- Semantic text does not include image URLs, static IDs, price-only details, or unsupported buyer/lifestyle claims.
- Promotion benefits are structured only for explicit source phrases; all remaining terms stay in the captured description/conditions.
- Comparison pages must be idempotent by source page. Re-ingestion replaces that page's facts and variant facts transactionally.
- No embedding model change is included; source coverage and structured retrieval are the current bottlenecks.

## Retrieval contract

- `compare_trims` accepts one model, one year, and at least two exact trim names; returns matching values with source URLs and marks absent values as unknown.
- `get_variant_comparisons` accepts a model, year, and optional exact trim; returns only source-backed competitor rows and the exact Comparativo URL.
- Promotion results retain validity, exact model/year, direct model URL, promotion source URL, structured amounts, benefit entries, and legal terms.

## Verification

Build TypeScript, crawl and ingest the stored Ford comparison routes, verify row counts and route/trim provenance in PostgreSQL, and invoke the MCP handlers manually for Expedition 2027 trim and competitor comparisons plus a promotion with insurance/payment benefits. Tests are not run under the active task constraint.
