# Operations

## Ingestion flow

1. `crawl` starts at `/Todos/`, follows allowed public links, and stores raw HTML plus content hashes. `crawl-comparisons` refreshes the distinct `/Comparativo/` trim routes already found on stored model pages.
2. `ingest` parses changed page types and upserts structured facts, section documents, and provenance. Technical-sheet ingestion splits factual `vehicle_profile` evidence into small source-backed chunks; semantic-only search terms are added only when matching source facts exist. Grouped values remain unassigned to trims, and stale chunks are pruned after reingestion.
3. `refresh-offer-documents` rebuilds semantic profiles for stored offers without calling Ford; `embed` batches pending documents through the configured OpenAI-compatible endpoint.
4. `api` and `mcp` expose the shared hybrid search service.

All writes are idempotent. Re-running ingestion for unchanged content does not reset ready embeddings. Changed document content reuses its logical document key and returns to `pending`.

## Safety boundaries

- The crawler never submits forms.
- URL policy rejects quote, contact, appointment, and form routes.
- Raw HTML is retained so parsers can be improved and replayed.
- User-facing price answers must include their source URL and crawl timestamp.
- Catalog prices and promotions can become stale; `get_catalog_status` exposes freshness counts.

## Hybrid search behavior

Hard model, year, price, category, and financing-term filters are applied to relational tables before retrieval. Generic vehicle search omits police fleet models unless the buyer names a model. SUV category aliases map to Ford's two stored SUV category labels. Full-text and semantic vehicle search use vehicle-profile chunks and model-page overviews only; competitor comparison documents stay in the dedicated comparison path. Keyword retrieval OR-matches source terms so unmatched lifestyle words do not discard exact evidence. Keyword and vector hits choose the best evidence per model-year before score fusion. Semantic search uses only ready vectors matching the configured embedding model and uses `document_embeddings.embedding <=> query::vector` with the HNSW cosine index. Vehicle results retain matched sections and provenance. Crawled pages store their anchor links in `ford.page_links`; vehicle images and their source pages are stored in `ford.images`.

If embeddings are unavailable, search reports `semanticSearch: "unavailable"` and returns deterministic/keyword results rather than claiming semantic ranking.

Vector input comes from `ford.documents.semantic_content`; `content` remains the exact source-backed text used by keyword search and answer context. Vehicle profiles use short technical-sheet chunks with conservative query terms derived from the same facts; promotions and trim-versus-competitor comparisons have separate semantic narratives. Numeric prices, validity dates, and exact attributes stay in relational fields or JSONB. Documents with empty semantic content are skipped by vector indexing (for example, a price-only chunk). Images are direct URLs and metadata only; they are never embedded.

## MCP

The local MCP command uses stdio through the official TypeScript SDK. MCP tools are read-only adapters over shared services. Vehicle detail links come from model-page sources attached to stored variants; trim comparison links come from stored comparison records. `compare_trims` compares exact trims within one model-year and excludes malformed yes/no values for quantitative fields. `compare_model_years` reports price changes and only compares differing single-valued facts, leaving grouped or placeholder facts out of deltas. `compare_vehicles` handles multiple Ford nameplates or powertrain variants. `get_variant_comparisons` returns source-published Ford-versus-competitor tables with `paired_facts`; mismatched source rows remain under `excluded_source_rows` with warnings. Missing data remains unknown; it is never treated as a feature removal.
