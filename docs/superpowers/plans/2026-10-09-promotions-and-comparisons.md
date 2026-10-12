# Promotions and Trim Comparisons Implementation Plan

> **For agentic workers:** Execute inline, task by task. Do not delegate.

**Goal:** Ingest detailed Ford promotions and trim comparison pages as sourced relational facts, then expose them through MCP.

**Architecture:** Keep current PostgreSQL/pgvector architecture. Normalize comparison identity and attributes, preserve page payload in JSONB, link Ford facts to existing variants, and generate compact MCP responses from SQL. Embeddings remain for semantic retrieval only.

**Tech Stack:** TypeScript, PostgreSQL, pgvector, Cheerio, Playwright crawler, MCP SDK.

## Global Constraints

- Preserve unrelated working tree edits.
- Use the current project APIs and existing page/provenance storage.
- Keep exact facts linked to Ford source URLs.
- Do not infer missing values or reinterpret ambiguous competitor values.
- Do not add or run tests for this task; verify with build and database/MCP manual checks.
- Do not change the embedding model.

---

## Files and responsibilities

- `src/domain/contracts.ts`: comparison page and comparison fact types, plus promotion benefit metadata contract.
- `src/crawl/page-classifier.ts`, `src/crawl/url-policy.ts`, `src/crawl/crawler.ts`: identify, allow, and enqueue only Ford Comparativo routes with supported display parameters.
- `src/parsers/comparison-parser.ts`: parse vehicle headers, comparison groups, paired attributes, and source-backed values.
- `src/parsers/public-page-parser.ts`: parse promotion legal conditions and explicit secondary benefits.
- `src/storage/comparison-repository.ts`: transactionally upsert comparison parents, competitor facts, and Ford variant specs.
- `src/storage/catalog-repository.ts`: provide safe replacement of variant-level specifications by source page.
- `src/crawl/ingestion.ts`, `src/parsers/registry.ts`: wire comparison parser and persistence into ingestion.
- `src/storage/read-services.ts`: deterministic trim comparison and competitor-comparison read services.
- `src/mcp/server.ts`, `src/composition-root.ts`: register and wire `compare_trims`, `compare_model_years`, and `get_variant_comparisons`.
- `db/migrations/016_vehicle_comparisons.sql`: create normalized comparison tables and indexes.
- `db/migrations/017_semantic_document_content.sql`: separate answer evidence from embedding text.
- `db/migrations/018_disable_uncurated_embeddings.sql`: remove vectors for documents without a curated semantic profile.
- `tasks/todo.md`: track implementation and manual verification.

## Tasks

### Task 1: Crawl and classify comparison routes

- [x] Add the `comparison` page type and classify `/Comparativo/` before general vehicle-year routes.
- [x] Allow comparison URLs with only `exterior` and `interior` query keys; keep all other query-string crawling blocked.
- [x] Enqueue comparison URLs found on stored model pages without recursively crawling unrelated page families.
- [x] Add a focused `crawl-comparisons` command that refreshes one route per trim and skips color duplicates.

### Task 2: Parse comparison pages and promotion details

- [x] Parse the source's Ford/competitor headers and exact category/name/value pairs.
- [x] Attach a Ford variant name from the route/header and competitor make/model/year/trim from the page header.
- [x] Keep raw comparison values; parse numeric value/unit only when unambiguous.
- [x] Extract promotion legal clauses into `conditions` and explicit insurance/deferred-payment benefits into structured metadata.

### Task 3: Persist comparisons and Ford trim facts

- [x] Create comparison parent/fact tables with page provenance and JSONB raw payload.
- [x] Upsert parent and facts transactionally and idempotently by source page.
- [x] Resolve Ford model-year/variant and save Ford-side facts to variant-linked specs; preserve competitor values as source text.
- [x] Separate semantic content from exact source evidence; exclude price-only and image data from embeddings.
- [x] Reingest promotions so conditions and benefit metadata are populated.

### Task 4: Expose deterministic MCP comparison retrieval

- [x] Add `compare_trims` for exact same-model/year variant comparison with per-fact source URLs and shared-fact deltas.
- [x] Add `compare_model_years` for exact years, price/promotions, and shared-fact deltas.
- [x] Add `get_variant_comparisons` for Ford vs source-listed competitor, with exact comparison and image URLs.
- [x] Return unknown for attributes absent from either side; do not synthesize values.

### Task 5: Apply and verify on the Ford DB

- [x] Back up the correct `colima-ford-scraping` database before migration.
- [x] Run migration, crawl Comparativo routes, and ingest stored pages.
- [x] Refresh offer semantic documents for existing rows, embed pending vectors, and verify no image URLs enter semantic content.
- [x] Manually inspect Expedition 2027 King Ranch Max vs Tahoe, two Expedition trims, model-year comparisons, and promotion benefits through MCP.
- [x] Record final counts, exact source links, build result, and parser gaps here.

## Results

- `npm run build`: passed. Tests were not run per task constraint.
- Backup: `backups/ford-pre-comparison-20261009.dump` (pg_restore list validation passed; SHA-256 sidecar saved).
- Migrations 016-018 applied to the `colima-ford-scraping` Ford database.
- Crawl: 110 comparison routes fetched, 0 failures. Ingestion: 267 pages, 366 documents, 0 failures.
- Database: 110 comparison rows, 2,447 competitor attributes, 2,447 variant-linked specs, 110 priced variants; 10 promotions with conditions and 3 with structured benefits (including Bronco Sport one-year insurance and 90-day deferred first payment).
- Embeddings: 885 ready, 0 pending, 0 failed; 83 documents intentionally excluded (price-only or uncurated). No semantic text contains image paths or URLs.
- Manual MCP: Expedition 2027 King Ranch Max returns Chevrolet Tahoe 2026 High Country, 27 paired facts per side, exact comparison URL, and absolute Ford/competitor image URLs. Active vs King Ranch Max returns a source-backed $230,000 trim price difference and 4 shared-fact differences. Expedition 2025/2026/2027 returns exact model links, prices, active 2026 promotion, and shared-fact changes. Bronco Sport 2026 promotion returns $130,000 bonus, October 1–November 2 2026 validity, one-year free insurance, and first payment in 90 days.
- Comparisons are limited to the Ford Uruapan routes currently crawled. Cross-model/nameplate comparison uses `compare_vehicles`; model-year/trim deltas are calculated from shared stored facts, so missing rows are not described as removed features or redesigns.
