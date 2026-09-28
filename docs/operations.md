# Operations

## Ingestion flow

1. `crawl` starts at `/Todos/`, follows allowed public links, and stores raw HTML plus content hashes.
2. `ingest` parses changed page types and upserts structured facts, section documents, and provenance.
3. `embed` batches pending documents through the configured OpenAI-compatible endpoint.
4. `api` and `mcp` expose the shared hybrid search service.

All writes are idempotent. Re-running ingestion for unchanged content does not reset ready embeddings. Changed document content reuses its logical document key and returns to `pending`.

## Safety boundaries

- The crawler never submits forms.
- URL policy rejects quote, contact, appointment, and form routes.
- Raw HTML is retained so parsers can be improved and replayed.
- User-facing price answers must include their source URL and crawl timestamp.
- Catalog prices and promotions can become stale; `get_catalog_status` exposes freshness counts.

## Hybrid search behavior

Hard filters are applied to relational tables before retrieval. Full-text search uses PostgreSQL Spanish search vectors. Semantic search uses `document_embeddings.embedding <=> query::vector` with the HNSW cosine index. Results are collapsed from document sections to vehicle records and retain matched sections and provenance.

If embeddings are unavailable, search reports `semanticSearch: "unavailable"` and returns deterministic/keyword results rather than claiming semantic ranking.

## MCP

The local MCP command uses stdio through the official TypeScript SDK. MCP tools are read-only adapters over the same REST application services; they do not contain SQL or alternate ranking rules.
