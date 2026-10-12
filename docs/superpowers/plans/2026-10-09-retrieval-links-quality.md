# Ford Retrieval and Source Link Quality Implementation Plan

> **For agentic workers:** This plan is being executed inline in the current session. Keep changes additive and preserve existing local work.

**Goal:** Return exact vehicle and comparison URLs consistently, and make general vehicle search rank vehicle evidence instead of competitor comparison chunks.

**Architecture:** Keep `source_page_id` as the page that supplied catalog price/provenance. Add a dedicated model detail page reference on each model year, populate it during model-page ingestion, and use normalized comparison records to return direct trim comparison routes. General vehicle retrieval uses concise source-backed vehicle-profile chunks and model-page overviews; competitor comparison facts remain available from `get_variant_comparisons`.

**Tech Stack:** TypeScript, PostgreSQL, pgvector, existing MCP services and migrations.

## Global Constraints

- Preserve existing worktree changes and database data.
- Do not store image bytes or image embeddings.
- Keep exact prices/spec facts and filters relational; semantic retrieval ranks descriptive vehicle text.
- Tests and verification are authorized by the user's explicit request to check retrieval and reranking.

## Files

- `db/migrations/019_model_page_links.sql`: add and backfill canonical model detail page pointer.
- `src/storage/catalog-repository.ts`: persist model page ID separately from catalog source.
- `src/storage/read-services.ts`: resolve model URLs, model images/spec links, and trim comparison routes from their correct source pages.
- `src/storage/search-repository.ts`: return canonical model URLs and exclude comparison chunks from general vehicle search.
- `src/mcp/server.ts`: expose direct links consistently in detail and comparison results if needed.
- `docs/operations.md`: document migration and retrieval behavior.

## Tasks

1. Add migration with nullable `model_page_id` foreign key and safe backfill from Ford model routes matching normalized model/year. Preserve `source_page_id` unchanged.
2. Update catalog persistence so model page ingestion writes `model_page_id`; catalog ingestion continues writing `source_page_id`.
3. Update vehicle detail, vehicle comparison, and year comparison reads to return `modelPageUrl` from the dedicated model page. Build `comparisonUrls` from exact comparison rows joined to trim and source page, not links on the catalog page.
4. Restrict general vehicle keyword/vector search to curated vehicle overview documents; exact model/year/price filters remain SQL filters. Keep competitor comparison retrieval in the dedicated comparison service.
5. Apply migration; reingest stored model pages if needed; manually inspect Expedition 2027 and representative other models plus semantic/lifestyle search outputs.
6. Run TypeScript build, focused tests, local DB/MCP checks, and the semantic retrieval evaluator.

## Verification on 2026-10-09

- Focused tests pass for profile chunking, comparison row quality, grouped year deltas, category aliases, and stale chunk pruning.
- Build passes. The local profile corpus was refreshed: 38 technical sheets produced 141 profile chunks; 139 changed/new profile vectors were embedded successfully.
- MCP checks return direct model links, exact trim `Comparativo` routes, model-year prices, and per-spec sources.
- The live Expedition 2027 Active vs. King Ranch Max comparison returns a $230,000 MXN price difference and source-backed shared fact differences.
- Expedition King Ranch Max vs. Tahoe returns 17 like-for-like paired facts and preserves 10 questionable source rows with warnings and the exact Ford comparison page.
- The semantic evaluator has 3 curated SUV lifestyle cases and 7 financing fact cases. For vehicle cases, current blend and RRF tie on aggregate metrics; three cases are too small to declare a ranking winner. The live blend returns useful candidates after stated category filters, but more labeled queries are required before calling reranking robust.
