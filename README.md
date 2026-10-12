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
npm run dev -- mcp
MCP_HTTP_BEARER_TOKEN=local-development-token npm run dev -- mcp-http
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

The MCP server exposes the read-only tools `search_vehicles`, `search_vehicle_and_offers`, `search_offers`, `get_vehicle`, `get_page_links`, `compare_vehicles`, `compare_trims`, `compare_model_years`, `get_variant_comparisons`, `get_vehicle_provenance`, `list_promotions`, and `get_catalog_status`. Search and vehicle detail results return direct model-page URLs separately from price-source URLs; trim and competitor comparisons return Ford's exact visual Comparativo URL. `get_vehicle` returns stored model images and source links; `get_page_links` returns every link found on a crawled page in pages of up to 200. `get_variant_comparisons` returns Ford's exact comparison page, competitor facts, and image links.

Semantic vectors are generated from `ford.documents.semantic_content`; exact source evidence stays in `content` for keyword search and returned context. Structured prices, dates, trim attributes, and promotion terms remain in relational columns/JSONB and are retrieved with SQL. Empty `semantic_content` disables vector indexing for a document such as a price-only chunk. Vehicle and comparison images stay as URLs and metadata; image bytes and image URLs are never embedded.

`get_vehicle` with a model year returns that exact unit. Without a year, it
returns all model-year units stored for the exact model in `ford.model_years`,
newest first, with each unit's available price and compact specification data.
If the catalog has no matching units, it returns an empty option list so the
assistant can ask for another model or clarify the request; it must not invent
a model year.

Run repeatable end-to-end MCP flow checks with `npm run eval:mcp`. By default it sends 100 simulated buyer flows (700 tool calls total) to a separate local MCP process; use `-- --flows=10 --concurrency=2` for a smaller run. The evaluator checks tool responses and a deterministic, grounded reply template. It does not invoke an LLM or change Codex MCP configuration. It needs the local `.env` and a reachable catalog database.

Run actual local-model conversations with `npm run eval:mcp:llm`. It defaults to 100 synthetic leads, passes the live MCP tool schemas to Ollama, executes model-requested tool calls through stdio MCP, and scores tool choice plus financing disclosures. It uses `qwen2.5:3b` at `http://127.0.0.1:11434` by default; set `OLLAMA_MODEL` or `OLLAMA_CHAT_URL` to override them. No API key or Codex MCP setup is required. Use `npm run eval:mcp:llm -- --flows=1 --start=0` for the first flow, then increment `--start` to run distinct flows one at a time.

The default MCP transport is stdio. For a remote client, start the protected Streamable HTTP transport with `mcp-http`; it listens on `127.0.0.1:3001/mcp` by default. Configure `MCP_HTTP_ALLOWED_HOSTS` for the tunnel hostname and `MCP_HTTP_ALLOWED_ORIGINS` for browser clients before exposing it through Cloudflare Tunnel.

## Observability with Langfuse

The TypeScript MCP/API search layer supports optional Langfuse tracing through OpenTelemetry. Set `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` to enable it; when either value is missing, the application uses a no-op observer and does not contact Langfuse. Search spans include query filters, candidate/result counts, semantic-search status, latency, and the top result identifier, but not full catalog result payloads or user identifiers.

The Spring AI caller should instrument its own model and tool-call spans with Spring Boot Micrometer/OpenTelemetry and export them to the same Langfuse project. The MCP server remains responsible for retrieval spans; Spring AI remains responsible for model and end-to-end conversation spans. Use stdio for a local Spring AI process; use Streamable HTTP behind authentication when the MCP server is deployed as a separate service.

See [`docs/langfuse-spring-ai-integration.md`](docs/langfuse-spring-ai-integration.md) for the integration contract and privacy guidance.

Financing synchronization first requires the financing page to be crawled. The sync command then loads `/Financiamiento/`, extracts its short-lived request token, and calls Ford's read-only `POST /info/consultas.ashx` actions: `GetPlanesActivosPorClaveGen`, `GetPlanesActivosPorVersion`, and `GetPlanes`. The normalized results are stored in `ford.offers`, converted into searchable documents, and queued for local embeddings. No quote, contact, or personal-data form is submitted.

The scheduled sync runs at `12:00` in `America/Mexico_City` by default. It fetches `/Todos/`, `/Seminuevos/`, `/Promociones/`, and `/Financiamiento/` with HTTP and Cheerio, follows allowed public links, refreshes the Seminuevos `CheckDist` inventory endpoint, refreshes financing plans, and only reprocesses changed page hashes. Start the containerized scheduler with `docker-compose up -d scheduler` after the PostgreSQL and Ollama services are available.

## Tests

```bash
npm run lint
npm run build
npm test -- --run
DATABASE_URL=postgres://postgres:postgres@localhost:5432/ford npm run test:integration
```

Integration tests require the local PostgreSQL container. Crawling is read-only and excludes form, contact, quote, appointment, and personal-data flows.

## Catalog QA evaluations

Run 192 synthetic Spanish customer-style questions across every stored Ford catalog model-year with local MCP and Ollama, then score answer quality with local RAGAS. See [the evaluation guide](docs/mcp-catalog-qa-evals.md) for setup, commands, and report interpretation.
