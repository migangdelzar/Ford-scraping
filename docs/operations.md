# Operations

## Ingestion flow

1. `crawl` starts at `/Todos/`, follows allowed public links, and stores raw HTML plus content hashes. `crawl-comparisons` refreshes distinct `/Comparativo/` routes already found on stored model pages.
2. `ingest` parses changed pages and upserts structured facts, documents, and provenance. Technical-sheet ingestion keeps factual vehicle evidence in source-backed chunks; grouped values remain unassigned to trims and stale chunks are pruned after reingestion.
3. `refresh-offer-documents` rebuilds semantic profiles for stored offers without calling Ford; `embed` batches pending documents through the configured OpenAI-compatible endpoint.
4. `api` exposes the shared hybrid-search service. Ford Service owns customer AI tool execution through in-process Spring AI callbacks.

All writes are idempotent. Re-running ingestion for unchanged content does not reset ready embeddings. Changed document content reuses its logical document key and returns to `pending`.

## Safety boundaries

- The crawler never submits forms.
- URL policy rejects quote, contact, appointment, and form routes.
- Raw HTML is retained so parsers can be improved and replayed.
- Catalog prices and promotions can become stale; the catalog status view exposes freshness counts.
- Ford-scraping owns catalog writes and migrations. Ford Service receives read-only access.

## Hybrid search behavior

Hard model, year, price, category, and financing-term filters are applied to relational tables before retrieval. Generic vehicle search omits police fleet models unless the buyer names a model. SUV category aliases map to Ford's two stored SUV category labels. Full-text and semantic vehicle search use vehicle-profile chunks and model-page overviews only; competitor comparison documents stay in the dedicated comparison path. Keyword retrieval OR-matches source terms so unmatched lifestyle words do not discard exact evidence. Keyword and vector hits choose the best evidence per model-year before score fusion. Semantic search uses only ready vectors matching the configured embedding model and uses `document_embeddings.embedding <=> query::vector` with the HNSW cosine index. Vehicle results retain matched sections and provenance. Crawled pages store their anchor links in `ford.page_links`; vehicle images and their source pages are stored in `ford.images`.

If embeddings are unavailable, search reports `semanticSearch: "unavailable"` and returns deterministic/keyword results rather than claiming semantic ranking.

## MÍA tool runtime transition

The Node MCP server, CLI commands, container smoke, release workflow, and runtime token mapping are removed from this branch. The Node catalog writer, migrations, REST API, scheduler image, and catalog read views remain. Ford Service has local Spring AI callback implementations behind `FORD_CATALOG_TOOLS_ENABLED`; this flag remains off until its catalog datasource and tool behavior are verified. A temporary loss of customer catalog tools is accepted during this transition.

This repository change does not stop an already-running OCI container or remove Cloudflare Tunnel routes, GitHub environment variables, OCI Vault secrets, or IAM grants. Keep those resources available for rollback until the Service path is verified and a separate production cutover is performed.

## Production runtime secrets

The catalog scheduler can use `FORD_SECRETS_PROVIDER=oci-vault`. In that mode it obtains OCI Instance Principal credentials on the VM and reads its database password from Vault at startup. GitHub Actions passes only a nonsecret Vault secret OCID; secret values are not sent through the runner. The default `environment` provider is for local development and does not contact OCI.

The former MCP bearer and Cloudflare Access secrets are no longer consumed by this Node runtime. Do not delete their OCI/GitHub entries as part of this code change; remove them only after confirming no deployed service or rollback workflow uses them.
