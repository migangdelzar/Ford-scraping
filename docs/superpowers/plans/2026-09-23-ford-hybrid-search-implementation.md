# Ford Uruapan Hybrid Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a TypeScript Ford Uruapan ingestion and search platform with PostgreSQL + pgvector hybrid retrieval, REST access, and a read-only MCP server.

**Architecture:** A Playwright crawler stores raw public pages and hashes them before focused parsers normalize vehicle facts into PostgreSQL. Search documents are generated per semantic section and optionally embedded through an OpenAI-compatible provider. A shared `SearchService` applies SQL filters, PostgreSQL full-text search, pgvector similarity, score fusion, and provenance enrichment; Fastify and MCP are thin adapters over that service.

**Tech Stack:** Node.js 22+, TypeScript, npm, Playwright, Fastify, `pg`, PostgreSQL 16 + pgvector, Zod, Vitest, Docker Compose, official MCP TypeScript SDK.

## Global Constraints

- Use PostgreSQL with the `ford` schema, `pgcrypto`, `pg_trgm`, and `vector`; do not add a separate vector database.
- Use parameterized SQL and never interpolate user-controlled values into SQL.
- Crawl only public informational pages on the configured Ford host; never submit forms or personal-data flows.
- Keep structured values and semantic documents separate; never use embeddings as the source of truth for price/year/category constraints.
- Embeddings are optional: without credentials, ingestion succeeds and documents remain `pending`; no fake vectors are generated.
- Preserve raw HTML, normalized URLs, content hashes, source URLs, crawl timestamps, and parse warnings for replay and provenance.
- Write a failing test before production code for every behavior change; use test doubles at network and embedding boundaries.
- Preserve the repository’s currently empty state except for files created by this plan.

---

## File Map

Create these focused units:

```text
package.json
package-lock.json
tsconfig.json
vitest.config.ts
.env.example
.gitignore
docker-compose.yml
README.md

src/
  config.ts
  composition-root.ts
  domain/contracts.ts
  domain/normalization.ts
  domain/documents.ts
  crawl/url-policy.ts
  crawl/page-classifier.ts
  crawl/crawler.ts
  crawl/page-parser.ts
  parsers/catalog-parser.ts
  parsers/model-parser.ts
  parsers/technical-sheet-parser.ts
  parsers/public-page-parser.ts
  parsers/registry.ts
  storage/database.ts
  storage/page-repository.ts
  storage/catalog-repository.ts
  storage/document-repository.ts
  storage/search-repository.ts
  embeddings/provider.ts
  embeddings/worker.ts
  search/search-service.ts
  search/ranking.ts
  api/app.ts
  api/routes.ts
  mcp/server.ts
  cli.ts

db/migrations/001_extensions.sql
db/migrations/002_schema.sql
db/migrations/003_indexes.sql

tests/
  unit/url-policy.test.ts
  unit/page-classifier.test.ts
  unit/normalization.test.ts
  unit/parsers.test.ts
  unit/documents.test.ts
  unit/ranking.test.ts
  unit/config.test.ts
  integration/database.test.ts
  integration/search-repository.test.ts
  api/routes.test.ts
  mcp/server.test.ts
fixtures/pages/*.html
```

### Task 1: Bootstrap the TypeScript runtime and local database

**Files:**
- Create: `package.json`, `package-lock.json`, `tsconfig.json`, `vitest.config.ts`, `.env.example`, `.gitignore`, `docker-compose.yml`
- Create: `src/config.ts`, `src/storage/database.ts`
- Create: `db/migrations/001_extensions.sql`, `db/migrations/002_schema.sql`, `db/migrations/003_indexes.sql`
- Create: `tests/unit/config.test.ts`, `tests/integration/database.test.ts`
- Create: `README.md`

**Interfaces:**
- `loadConfig(env: NodeJS.ProcessEnv): AppConfig` validates `DATABASE_URL`, `FORD_BASE_URL`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`, and optional embedding credentials.
- `createPool(config: AppConfig): Pool` returns a `pg.Pool`.
- `runMigrations(pool: Pool): Promise<void>` applies ordered SQL files once.

- [ ] **Step 1: Write the failing config test**

```ts
it('accepts a database and base URL without embedding credentials', () => {
  const config = loadConfig({
    DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/ford',
    FORD_BASE_URL: 'https://www.forduruapan.mx',
    EMBEDDING_PROVIDER: 'ollama',
    EMBEDDING_MODEL: 'qllama/bge-m3:q8_0',
    EMBEDDING_DIMENSIONS: '1024'
  });

  expect(config.embedding.apiKey).toBeUndefined();
  expect(config.embedding.provider).toBe('ollama');
  expect(config.embedding.dimensions).toBe(1024);
});
```

- [ ] **Step 2: Run the focused test and confirm it fails because `loadConfig` is missing**

Run: `npm test -- --run tests/unit/config.test.ts`

Expected: FAIL with an import or missing-function error for `loadConfig`.

- [ ] **Step 3: Implement configuration validation and the package scripts**

Use `zod` to validate environment values. Add scripts:

```json
{
  "dev": "tsx src/cli.ts",
  "build": "tsc -p tsconfig.json",
  "test": "vitest",
  "test:unit": "vitest run tests/unit",
  "test:integration": "vitest run tests/integration",
  "lint": "tsc -p tsconfig.json --noEmit",
  "migrate": "tsx src/cli.ts migrate"
}
```

- [ ] **Step 4: Add migrations for extensions and the full relational schema**

Create tables for `sources`, `pages`, `models`, `model_years`, `categories`, `model_year_categories`, `variants`, `specifications`, `features`, `images`, `promotions`, `documents`, and `document_embeddings`. Include UUID keys, foreign keys, normalized uniqueness constraints, JSONB metadata, provenance page references, document hashes, embedding status/error columns, and `TSVECTOR GENERATED ALWAYS` over Spanish title/content.

- [ ] **Step 5: Add indexes and migration execution**

Create indexes for page type/hash, model names with trigram, model year/price, specification keys, document full-text search, and HNSW cosine similarity. `runMigrations` must use a transaction, create a migration ledger, and skip already-applied filenames.

- [ ] **Step 6: Run unit and database verification**

Run: `npm test -- --run tests/unit/config.test.ts`

Expected: PASS.

Run: `docker compose up -d postgres && npm run migrate`

Expected: migration command exits 0 and creates the `ford` schema.

- [ ] **Step 7: Document setup and commit when Git exists**

Document `cp .env.example .env`, `docker compose up -d postgres`, `npm install`, `npm run migrate`, and test commands in `README.md`. If the workspace has no Git repository, leave the files uncommitted and report that fact.

### Task 2: Build URL policy, page classification, and domain contracts

**Files:**
- Create: `src/domain/contracts.ts`, `src/domain/normalization.ts`, `src/crawl/url-policy.ts`, `src/crawl/page-classifier.ts`
- Create: `tests/unit/url-policy.test.ts`, `tests/unit/page-classifier.test.ts`, `tests/unit/normalization.test.ts`

**Interfaces:**
- `normalizeUrl(rawUrl: string, baseUrl: URL): string`
- `isAllowedPublicUrl(url: URL, config: CrawlPolicy): boolean`
- `classifyPage(url: URL, title: string, text: string): PageType`
- `normalizeModelName(value: string): string`
- `normalizeSpecName(value: string): string`
- Domain types: `StoredPage`, `PageType`, `CatalogCandidate`, `VehicleCandidate`, `SpecificationCandidate`, `DocumentCandidate`, `SearchRequest`, and `SearchResult`.

- [ ] **Step 1: Write failing URL-policy tests**

```ts
it('removes fragments and tracking query parameters', () => {
  const result = normalizeUrl(
    'https://www.forduruapan.mx/Todos/?utm_source=x#catalog',
    new URL('https://www.forduruapan.mx')
  );
  expect(result).toBe('https://www.forduruapan.mx/Todos/');
});

it('rejects form and personal-data paths', () => {
  expect(isAllowedPublicUrl(new URL('https://www.forduruapan.mx/Cotiza/'), policy)).toBe(false);
  expect(isAllowedPublicUrl(new URL('https://www.forduruapan.mx/Todos/'), policy)).toBe(true);
});
```

- [ ] **Step 2: Run tests and verify the expected missing-function failures**

Run: `npm test -- --run tests/unit/url-policy.test.ts tests/unit/page-classifier.test.ts tests/unit/normalization.test.ts`

Expected: FAIL because the contracts and helpers are not implemented.

- [ ] **Step 3: Implement URL policy and page classification**

Allow only configured hostnames, `http`/`https`, and public informational routes. Strip fragments and known tracking parameters. Reject routes containing `cotiza`, `contact`, `form`, `financiamiento` actions, appointment submission paths, and external hosts. Classify `/Todos/`, `Ficha-Tecnica`, promotions, service, seminuevos, FAQ, dealer, model, and unknown routes.

- [ ] **Step 4: Implement normalization and domain contracts**

Use Unicode normalization, whitespace collapsing, case folding, and explicit aliases for power, torque, displacement, transmission, drivetrain, fuel economy, cargo capacity, payload, and seating capacity. Keep original display text alongside normalized keys.

- [ ] **Step 5: Run focused tests and refactor only after green**

Run: `npm test -- --run tests/unit/url-policy.test.ts tests/unit/page-classifier.test.ts tests/unit/normalization.test.ts`

Expected: PASS.

### Task 3: Add fixture-driven parsers for all page types

**Files:**
- Create: `src/crawl/page-parser.ts`, `src/parsers/catalog-parser.ts`, `src/parsers/model-parser.ts`, `src/parsers/technical-sheet-parser.ts`, `src/parsers/public-page-parser.ts`, `src/parsers/registry.ts`
- Create: `fixtures/pages/catalog.html`, `fixtures/pages/model.html`, `fixtures/pages/technical-sheet.html`, `fixtures/pages/promotion.html`, `fixtures/pages/financing.html`, `fixtures/pages/service.html`, `fixtures/pages/used-vehicle.html`, `fixtures/pages/faq.html`, `fixtures/pages/dealer-information.html`
- Create: `tests/unit/parsers.test.ts`

**Interfaces:**
- `PageParser<T>.supports(page: StoredPage): boolean`
- `PageParser<T>.parse(page: StoredPage): ParseResult<T>`
- `createParserRegistry(): PageParser<unknown>[]`
- `parseCatalogPage(page: StoredPage): ParseResult<CatalogCandidate[]>`
- `parseModelPage(page: StoredPage): ParseResult<VehicleCandidate>`
- `parseTechnicalSheet(page: StoredPage): ParseResult<SpecificationCandidate[]>`
- `parsePublicInformationPage(page: StoredPage): ParseResult<PublicPageCandidate>`

- [ ] **Step 1: Add representative HTML fixtures and write failing parser tests**

Each fixture must contain the smallest HTML that proves the contract. The catalog fixture must include card title, year, category, displayed price, and an actual link. The technical fixture must include both a table and a definition list. The public-page fixtures must prove type-specific document extraction and source retention.

```ts
it('extracts catalog price and preserves the card link', () => {
  const result = parseCatalogPage(readPage('catalog.html'));
  expect(result.value[0]).toMatchObject({
    modelName: 'Territory',
    modelYear: 2026,
    startingPrice: 559900,
    sourceUrl: 'https://www.forduruapan.mx/TERRITORY/26/'
  });
});
```

- [ ] **Step 2: Run parser tests and confirm they fail before implementation**

Run: `npm test -- --run tests/unit/parsers.test.ts`

Expected: FAIL because parser functions and fixture readers are missing.

- [ ] **Step 3: Implement focused HTML parsers**

Use `cheerio` for deterministic HTML parsing. Extract actual anchors, images, headings, metadata, tables, definition lists, and section headings. Parse MXN prices safely, return warnings for malformed fields, and never throw away the raw page. The generic public parser should retain title, text, outbound public links, and a document type for promotions, financing, service, used vehicles, FAQs, and dealer information.

- [ ] **Step 4: Implement registry dispatch and warnings**

Order specific parsers before the generic parser. Return an explicit `unknown` result when no parser supports the page. Do not infer unsupported structured vehicle facts from marketing prose.

- [ ] **Step 5: Run parser tests and refactor after green**

Run: `npm test -- --run tests/unit/parsers.test.ts`

Expected: PASS.

### Task 4: Implement raw page storage and normalized entity upserts

**Files:**
- Create: `src/storage/page-repository.ts`, `src/storage/catalog-repository.ts`
- Modify: `src/storage/database.ts`
- Create: `tests/integration/database.test.ts`

**Interfaces:**
- `PageRepository.upsert(page: FetchedPage): Promise<PageChange>`
- `PageRepository.getByUrl(url: string): Promise<StoredPage | null>`
- `CatalogRepository.upsertCatalog(candidate: CatalogCandidate, page: StoredPage): Promise<ModelYearRef>`
- `CatalogRepository.upsertVehicle(candidate: VehicleCandidate, page: StoredPage): Promise<VehicleRef>`
- `CatalogRepository.upsertSpecifications(ref: VehicleRef, specs: SpecificationCandidate[], page: StoredPage): Promise<void>`

- [ ] **Step 1: Write failing integration tests for idempotent page/entity writes**

```ts
it('does not mark an unchanged page as changed', async () => {
  const first = await pages.upsert(sampleFetchedPage);
  const second = await pages.upsert(sampleFetchedPage);
  expect(first.changed).toBe(true);
  expect(second.changed).toBe(false);
});

it('upserts the same model-year without duplicates', async () => {
  await catalog.upsertCatalog(sampleCatalogCandidate, samplePage);
  await catalog.upsertCatalog(sampleCatalogCandidate, samplePage);
  await expect(countModelYears('Territory', 2026)).resolves.toBe(1);
});
```

- [ ] **Step 2: Run integration tests and verify they fail for missing repositories**

Run: `docker compose up -d postgres && npm run migrate && npm test -- --run tests/integration/database.test.ts`

Expected: FAIL with missing repository methods before implementation.

- [ ] **Step 3: Implement page upsert and change detection**

Hash normalized extracted text plus raw HTML metadata, update `last_changed_at` only when the hash changes, and retain the latest HTTP status, content type, raw HTML, extracted text, and crawl error.

- [ ] **Step 4: Implement model/category/year/variant/specification/feature/image/promotion upserts**

Use `ON CONFLICT` constraints defined by the schema. Attach source-page IDs to every extracted fact and preserve original values in JSONB metadata where normalization changes representation.

- [ ] **Step 5: Run database integration tests**

Run: `npm test -- --run tests/integration/database.test.ts`

Expected: PASS with no duplicate canonical entities.

### Task 5: Generate searchable documents and optional embeddings

**Files:**
- Create: `src/domain/documents.ts`, `src/storage/document-repository.ts`, `src/embeddings/provider.ts`, `src/embeddings/worker.ts`
- Create: `tests/unit/documents.test.ts`

**Interfaces:**
- `buildDocuments(vehicle: VehicleAggregate): DocumentCandidate[]`
- `hashDocument(content: string): string`
- `EmbeddingProvider.embed(texts: string[]): Promise<number[][]>`
- `EmbeddingWorker.run(options: { limit: number }): Promise<EmbeddingRunSummary>`

- [ ] **Step 1: Write failing document and provider tests**

```ts
it('creates separate searchable sections for overview, technology, safety, and specs', () => {
  const docs = buildDocuments(sampleVehicleAggregate);
  expect(docs.map(doc => doc.documentType)).toEqual([
    'overview', 'technology', 'safety', 'specifications', 'pricing'
  ]);
});

it('marks embedding work pending when no API key is configured', async () => {
  const summary = await runEmbeddingWorker({
    provider: createEmbeddingProvider({ apiKey: undefined }),
    limit: 10
  });
  expect(summary.pending).toBeGreaterThan(0);
  expect(summary.failed).toBe(0);
});
```

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `npm test -- --run tests/unit/documents.test.ts`

Expected: FAIL because document generation and worker functions are missing.

- [ ] **Step 3: Implement section-level document generation**

Prefix each document with model, year, category, and price context. Generate stable content hashes. Upsert documents only when the hash changes; preserve prior embedding status for unchanged content.

- [ ] **Step 4: Implement the provider boundary and pending behavior**

Implement an OpenAI-compatible HTTP adapter behind `EmbeddingProvider`, and define `runEmbeddingWorker(deps: { provider: EmbeddingProvider }, options: { limit: number })`. Batch inputs. When no API key is configured, return a pending summary without calling the network. On provider errors, persist retryable error status and continue processing other documents.

- [ ] **Step 5: Run tests and add a test double for provider success**

Run: `npm test -- --run tests/unit/documents.test.ts`

Expected: PASS, including both pending and successful fake-provider paths.

### Task 6: Implement hybrid ranking and repository queries

**Files:**
- Create: `src/search/ranking.ts`, `src/storage/search-repository.ts`, `src/search/search-service.ts`
- Create: `tests/unit/ranking.test.ts`, `tests/integration/search-repository.test.ts`

**Interfaces:**
- `SearchRepository.findCandidates(filters: VehicleFilters): Promise<VehicleRef[]>`
- `SearchRepository.searchKeyword(query: string, candidates: VehicleRef[], limit: number): Promise<DocumentHit[]>`
- `SearchRepository.searchSemantic(embedding: number[], candidates: VehicleRef[], limit: number): Promise<DocumentHit[]>`
- `fuseScores(keywordHits: DocumentHit[], semanticHits: DocumentHit[], weights: ScoreWeights): RankedVehicle[]`
- `SearchService.search(request: SearchRequest): Promise<SearchResponse>`

- [ ] **Step 1: Write failing score-fusion and hard-filter tests**

```ts
it('never ranks a vehicle outside the SQL candidate set', async () => {
  const response = await search.search({
    query: 'SUV familiar con tecnología',
    filters: { maxPrice: 800000, modelYear: 2026 }
  });
  expect(response.results.every(result =>
    result.price <= 800000 && result.modelYear === 2026
  )).toBe(true);
});
```

- [ ] **Step 2: Run ranking and repository tests to verify the red state**

Run: `npm test -- --run tests/unit/ranking.test.ts tests/integration/search-repository.test.ts`

Expected: FAIL because ranking and repository methods are missing.

- [ ] **Step 3: Implement deterministic candidate SQL**

Join models, model years, categories, variants, and normalized specification metadata. Apply `minPrice`, `maxPrice`, `modelYear`, category, body type, and fuel type only in SQL. Use parameter arrays or temporary candidate CTEs; never build SQL by string concatenation.

- [ ] **Step 4: Implement Spanish full-text and pgvector retrieval**

Use `websearch_to_tsquery('spanish', $query)` and `ts_rank_cd` for keyword hits. Use cosine distance with the HNSW index for semantic hits. Restrict both searches to the deterministic candidate set.

- [ ] **Step 5: Implement score normalization, fusion, and vehicle collapse**

Normalize each candidate list to `[0, 1]`, combine explicit default weights of `0.30` keyword and `0.70` semantic when semantic results exist, and use keyword-only mode when embeddings are unavailable. Aggregate section hits by vehicle while returning matched sections and provenance.

- [ ] **Step 6: Run all search tests**

Run: `npm test -- --run tests/unit/ranking.test.ts tests/integration/search-repository.test.ts`

Expected: PASS, including exact hard-filter behavior and degraded semantic status.

### Task 7: Add Fastify REST routes

**Files:**
- Create: `src/api/app.ts`, `src/api/routes.ts`
- Create: `tests/api/routes.test.ts`

**Interfaces:**
- `buildApiApp(services: AppServices): FastifyInstance`
- `POST /search` accepts `SearchRequest` and returns `SearchResponse`.
- `GET /vehicles/:model/:year` returns structured data plus provenance.
- `GET /vehicles/:id/compare` returns a validated comparison.
- `GET /health` reports database and embedding capability.

- [ ] **Step 1: Write failing route tests**

```ts
it('passes validated search filters to the shared search service', async () => {
  const app = buildApiApp({ search: fakeSearchService, vehicles: fakeVehicleService });
  const response = await app.inject({
    method: 'POST',
    url: '/search',
    payload: { query: 'SUV familiar', filters: { maxPrice: 800000, modelYear: 2026 } }
  });
  expect(response.statusCode).toBe(200);
  expect(fakeSearchService.search).toHaveBeenCalledWith(expect.objectContaining({
    filters: { maxPrice: 800000, modelYear: 2026 }
  }));
});
```

- [ ] **Step 2: Run API tests and confirm missing app/routes failure**

Run: `npm test -- --run tests/api/routes.test.ts`

Expected: FAIL because `buildApiApp` is missing.

- [ ] **Step 3: Implement Zod validation and Fastify handlers**

Return `400` for invalid filters, bound `limit` to `1..50`, return `404` for unknown vehicles, and return structured errors without leaking database messages. Keep handlers thin and delegate all retrieval to application services.

- [ ] **Step 4: Run API tests**

Run: `npm test -- --run tests/api/routes.test.ts`

Expected: PASS.

### Task 8: Add the read-only MCP server

**Files:**
- Create: `src/mcp/server.ts`
- Create: `tests/mcp/server.test.ts`

**Interfaces:**
- `buildMcpServer(services: AppServices): McpServer`
- Register tools: `search_vehicles`, `get_vehicle`, `compare_vehicles`, `get_vehicle_provenance`, `list_promotions`, `get_catalog_status`.
- `serveMcpStdio(services: AppServices): Promise<void>` starts the configured stdio transport.

- [ ] **Step 1: Write failing MCP tests**

```ts
it('exposes search_vehicles with bounded filters and delegates to SearchService', async () => {
  const server = buildMcpServer({ search: fakeSearchService, vehicles: fakeVehicleService });
  const tools = await listTools(server);
  expect(tools).toContainEqual(expect.objectContaining({ name: 'search_vehicles' }));
  await callTool(server, 'search_vehicles', {
    query: 'SUV familiar',
    filters: { maxPrice: 800000, modelYear: 2026 }
  });
  expect(fakeSearchService.search).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run MCP tests and confirm the expected missing-server failure**

Run: `npm test -- --run tests/mcp/server.test.ts`

Expected: FAIL because the MCP server factory is missing.

- [ ] **Step 3: Implement the MCP adapter with the official current SDK**

Keep tool schemas aligned with REST Zod schemas. Return JSON-serializable structured results and bounded errors. Do not import database repositories into MCP code. Use stdio as the default transport and write protocol traffic only through the SDK, never to stdout directly.

- [ ] **Step 4: Run MCP tests**

Run: `npm test -- --run tests/mcp/server.test.ts`

Expected: PASS.

### Task 9: Implement crawler, ingestion commands, and composition root

**Files:**
- Create: `src/crawl/crawler.ts`, `src/composition-root.ts`, `src/cli.ts`
- Modify: `src/storage/page-repository.ts`, `src/storage/catalog-repository.ts`, `src/domain/documents.ts`
- Create: `tests/unit/crawler.test.ts`

**Interfaces:**
- `crawlCatalog(options: CrawlOptions): Promise<CrawlSummary>`
- `ingestChangedPages(options: IngestOptions): Promise<IngestSummary>`
- CLI commands: `migrate`, `crawl`, `ingest`, `embed`, `api`, `mcp`.

- [ ] **Step 1: Write failing crawler policy test**

```ts
it('queues discovered public model and technical-sheet links but not form links', async () => {
  const summary = await crawlWithFakeFetcher(catalogPageWithLinks);
  expect(summary.discoveredUrls).toContain('https://www.forduruapan.mx/TERRITORY/26/');
  expect(summary.discoveredUrls).not.toContain('https://www.forduruapan.mx/Cotiza/');
});
```

- [ ] **Step 2: Run the crawler test and confirm it fails before implementation**

Run: `npm test -- --run tests/unit/crawler.test.ts`

Expected: FAIL because crawler composition is missing.

- [ ] **Step 3: Implement Playwright crawling with injected fetcher and bounded concurrency**

Use an injected `PageFetcher` in tests and a Playwright adapter in production. Start at `/Todos/`, follow only normalized allowed links, wait for network idle with a timeout, save pages before parsing, and record per-page failures. Use a queue with a fixed concurrency limit and a maximum pages option.

- [ ] **Step 4: Implement ingestion orchestration and document upserts**

Run page parsing only for changed pages, route candidates to repositories, build section documents, and report counts for fetched, changed, parsed, warned, failed, and document-updated pages.

- [ ] **Step 5: Implement the composition root and CLI**

Construct config, pool, repositories, parsers, services, API, and MCP adapters in one place. Ensure `api` and `mcp` commands share the exact same service instances and do not create separate search implementations.

- [ ] **Step 6: Run the crawler test and the full unit suite**

Run: `npm test -- --run tests/unit/crawler.test.ts tests/unit`

Expected: PASS.

### Task 10: Finish operational documentation and full verification

**Files:**
- Modify: `README.md`, `.env.example`
- Create: `docs/operations.md`

- [ ] **Step 1: Document local startup and commands**

Document:

```bash
npm install
docker compose up -d postgres
npm run migrate
npm run dev -- api
npm run dev -- mcp
npm run dev -- crawl --max-pages=50
npm run dev -- ingest
npm run dev -- embed
```

Explain that embedding is optional and pending documents are expected when the API key is absent.

- [ ] **Step 2: Document safety boundaries and provenance**

State that crawling is read-only, form routes are excluded, raw pages are retained, prices must be accompanied by source URL and crawl timestamp, and catalog values can become stale.

- [ ] **Step 3: Run the complete verification set**

Run: `npm run build`

Expected: TypeScript exits 0.

Run: `npm test -- --run`

Expected: all unit, API, MCP, and available integration tests pass.

Run: `docker compose up -d postgres && npm run migrate && npm run test:integration`

Expected: database migrations and PostgreSQL + pgvector integration tests pass.

- [ ] **Step 4: Inspect the final diff and report exact evidence**

Run: `git status --short` when Git metadata exists, otherwise `find . -maxdepth 4 -type f -print`. Report changed files, commands, pass counts, and any environment-dependent checks that could not run. Do not claim live-site crawling or embedding-provider success unless those commands were explicitly run.
