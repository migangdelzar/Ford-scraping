# Ford Uruapan Hybrid Search

TypeScript ingestion and search platform for public Ford Uruapan pages.

The system keeps deterministic vehicle facts in PostgreSQL and searchable sections in `ford.documents`. Optional embeddings are stored in `ford.document_embeddings` and indexed with pgvector HNSW. Search applies SQL filters first, then Spanish full-text and vector retrieval, score fusion, and provenance enrichment.

## Local setup

```bash
npm install
cp .env.example .env
docker-compose up -d postgres ollama
docker-compose run --rm ollama-model
npm run migrate
```

The default local embedding provider is Ollama with the quantized BGE-M3 model `qllama/bge-m3:q8_0`. It serves multilingual embeddings through the Docker endpoint at `http://127.0.0.1:11435/api/embed`; the host port is `11435` so an existing native Ollama installation on `11434` is not disturbed. BGE-M3 produces 1024-dimensional vectors, so the pgvector column and HNSW cosine index use `VECTOR(1024)`.

Create a local database snapshot with `npm run db:backup` before database-mutating work. Dumps are stored under `backups/` and ignored by Git. See [`docs/database-backups.md`](docs/database-backups.md) for restore instructions.

## Commands

```bash
npm run dev -- crawl --max-pages=50
npm run dev -- crawl-comparisons
npm run dev -- ingest
npm run dev -- refresh-offer-documents
npm run dev -- sync-financing
npm run dev -- sync --max-pages=1000 --embedding-limit=100
npm run dev -- scheduler
EMBEDDING_PROVIDER=ollama EMBEDDING_API_URL=http://127.0.0.1:11435/api/embed npm run dev -- embed --limit=10
npm run dev -- api
```

Embedding is local and does not require an API key. The embedding worker is incremental and safe to rerun; unchanged ready rows are skipped and pending documents can be processed in small batches.
`refresh-offer-documents` rebuilds semantic profiles for offers already stored in the database without calling Ford's financing endpoint.

## REST

```bash
curl -X POST http://localhost:3000/search \
  -H 'content-type: application/json' \
  -d '{"query":"SUV familiar con buena tecnología","filters":{"model":"Territory","maxPrice":800000,"modelYear":2026}}'
```

Vehicle `model` and `modelYear` filters are exact SQL constraints. Financing
search accepts `termMonths` to constrain a stated duration before ranking.

Ford Service owns AI tool execution through in-process Spring AI callbacks. This Node app has no MCP server or remote tool endpoint. The read-only catalog views remain available for Ford Service's separately configured database reader; Ford-scraping remains their only writer and migration owner.

Semantic vectors are generated from `ford.documents.semantic_content`; exact source evidence stays in `content` for keyword search and returned context. Structured prices, dates, trim attributes, and promotion terms remain in relational columns/JSONB and are retrieved with SQL. Empty `semantic_content` disables vector indexing for a document such as a price-only chunk. Vehicle and comparison images stay as URLs and metadata; image bytes and image URLs are never embedded.

`get_vehicle` with a model year returns that exact unit. Without a year, it
returns all model-year units stored for the exact model in `ford.model_years`,
newest first, with each unit's available price and compact specification data.
If the catalog has no matching units, it returns an empty option list so the
assistant can ask for another model or clarify the request; it must not invent
a model year.

The former MCP evaluators were retired with the Node MCP runtime. The catalog QA question set remains as migration and parity reference data; a Spring-based evaluation runner is a follow-up task.

For production OCI Instance Principal and Vault mapping requirements, see [`docs/operations.md`](docs/operations.md#production-runtime-secrets). Secret values stay in OCI Vault; deployment variables contain only secret OCIDs.

## Observability with Langfuse

The catalog/API search layer supports optional Langfuse tracing through OpenTelemetry. Set `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` to enable it; when either value is missing, the application uses a no-op observer and does not contact Langfuse. Search spans include query filters, candidate/result counts, semantic-search status, latency, and the top result identifier, but not full catalog result payloads or user identifiers. Spring AI owns model and in-process tool-call spans.

See [`docs/langfuse-spring-ai-integration.md`](docs/langfuse-spring-ai-integration.md) for the integration contract and privacy guidance.

Financing synchronization first requires the financing page to be crawled. The sync command then loads `/Financiamiento/`, extracts its short-lived request token, and calls Ford's read-only `POST /info/consultas.ashx` actions: `GetPlanesActivosPorClaveGen`, `GetPlanesActivosPorVersion`, and `GetPlanes`. The normalized results are stored in `ford.offers`, converted into searchable documents, and queued for local embeddings. No quote, contact, or personal-data form is submitted.

The Node image retains the existing scheduler command for local use and rollback. Production is moving to the protected monthly GitHub Actions workflow, which invokes the promoted immutable image once on emme-2 after a same-day backup check. Keep the current scheduler active until the protected manual workflow succeeds; only then perform the reversible scheduler-disable cutover. The full sync fetches `/Todos/`, `/Seminuevos/`, `/Promociones/`, and `/Financiamiento/`, refreshes Seminuevos inventory and financing, and skips unchanged page ingestion.

## Tests

```bash
npm run lint
npm run build
npm test -- --run
DATABASE_URL=postgres://postgres:postgres@localhost:5432/ford_test npm run migrate
FORD_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/ford_test npm run test:integration
```

Integration tests require the local PostgreSQL container. Crawling is read-only and excludes form, contact, quote, appointment, and personal-data flows.

## Catalog QA evaluations

The catalog QA question set under `evals/catalog-qa/questions.jsonl` is retained for future Spring Service parity and evaluation work. Its former Node MCP runner was removed.
