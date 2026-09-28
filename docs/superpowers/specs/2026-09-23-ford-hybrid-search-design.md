# Ford Uruapan Hybrid Search Platform Design

## Goal

Build a TypeScript application that ingests public Ford Uruapan vehicle and dealership pages into PostgreSQL, keeps structured vehicle facts separate from semantic documents, and exposes deterministic, keyword, and pgvector retrieval through both REST and MCP.

## Scope

The first implementation is a complete scaffold covering:

- New-vehicle catalog discovery from the configured Ford Uruapan base URL.
- Model, model-year, category, variant, specification, feature, image, promotion, and source-page persistence.
- Parser boundaries for model pages, technical sheets, promotions, financing, service, used vehicles, FAQs, and dealer information.
- Incremental page storage using normalized URLs and content hashes.
- Search-document generation at meaningful semantic sections rather than one vector per SQL row.
- Configurable OpenAI-compatible embeddings. Ingestion remains successful when credentials are absent; affected documents stay `pending` and are never assigned fake vectors.
- Hybrid search: SQL filters first, then keyword and pgvector retrieval, score fusion, and provenance-rich results.
- REST search endpoints and a read-only MCP server backed by the same application service.

The first crawler pass is read-only and limited to public informational pages. It must not submit quote, contact, financing, or other personal-data forms.

## Non-goals

- Automating lead forms, financing applications, appointments, or other state-changing workflows.
- Guaranteeing extraction from page types without a fixture or observed site structure; unsupported pages must be retained as raw pages and reported as parseable-but-unstructured.
- Introducing a separate vector database.
- Letting an LLM decide hard constraints such as price, model year, category, or availability.

## Architecture

```text
Ford Uruapan public pages
        |
        v
Playwright crawler -> URL policy -> raw page storage/content hash
        |
        v
Page-type parser registry
        |
        v
Normalization + provenance
        |
        +----------------------+
        |                      |
        v                      v
PostgreSQL structured data    Search documents
        |                      |
        |                      v
        |                Embedding worker
        |                      |
        +-----------> pgvector / full-text search
                               |
                    Hybrid SearchService
                       /               \
                      v                 v
                 REST API          MCP server
```

The application uses ports at external boundaries:

- `PageFetcher`: browser-backed page retrieval.
- `PageRepository`: source-page upsert and change detection.
- `CatalogRepository`: normalized entity upserts and provenance writes.
- `EmbeddingProvider`: OpenAI-compatible embedding calls.
- `SearchRepository`: SQL, full-text, and pgvector candidate retrieval.

The composition root wires concrete PostgreSQL, Playwright, and embedding adapters. Parsers and ranking logic remain deterministic and testable without network access.

## Runtime and dependencies

- Node.js TypeScript application.
- Playwright for dynamic browser-backed crawling.
- PostgreSQL with `pgcrypto`, `pg_trgm`, and `vector` extensions.
- `pg` for database access, with parameterized SQL.
- Fastify for REST HTTP.
- Official MCP TypeScript server SDK for stdio first; HTTP transport remains an extension point.
- Zod for input/configuration validation and shared search contracts.
- Vitest for unit tests; Docker Compose and PostgreSQL for integration tests.

Exact dependency versions are selected from the package manager during implementation and pinned in the lockfile. The MCP package must use the current stable SDK package layout rather than legacy imports.

## Data model

The SQL schema is namespaced under `ford` and includes:

- `sources`: configured domains and crawl sources.
- `pages`: canonical URL, page type, status, raw HTML, extracted text, hash, timestamps, and crawl errors.
- `models`: canonical Ford model identity.
- `model_years`: model/year identity, catalog price, currency, active state, and source page.
- `categories` and `model_year_categories`: many-to-many catalog classification.
- `variants`: trim/version pricing and source page.
- `specifications`: normalized key, text/numeric value, unit, and provenance.
- `features`: model-year or variant features and provenance.
- `images`: public image URLs and accessibility text.
- `promotions`: title, description, validity dates, and source page.
- `documents`: section-level searchable text, owner entity, document type, hash, metadata, and generated full-text vector.
- `document_embeddings`: embedding vector, provider model, status, error, and timestamps.

Every extracted fact carries source-page identity and crawl timestamps either through the owning row or an explicit provenance record. Price and availability are time-sensitive and must not be treated as timeless model attributes.

The current migration uses `VECTOR(1024)` for local BGE-M3 embeddings served by Dockerized Ollama. Runtime configuration refuses dimensions other than 1024 because the pgvector column and HNSW index are provisioned for that shape. A future dimension requires a new versioned migration and embedding table strategy.

## Crawling and parsing

The crawler starts from `/Todos/` and discovers linked public pages. It normalizes URLs by removing fragments and tracking parameters, enforces the configured host allowlist, and rejects form/action paths. It stores every fetched page before parsing so a parser can be improved and replayed without recrawling.

Page classification is path- and content-aware and returns one of:

`catalog`, `model`, `technical_sheet`, `promotion`, `financing`, `service`, `used_vehicle`, `faq`, `dealer_information`, or `unknown`.

The parser registry maps each type to a focused parser contract:

```ts
interface PageParser<T> {
  supports(page: StoredPage): boolean;
  parse(page: StoredPage): ParseResult<T>;
}
```

All parsers return normalized candidates plus warnings. A malformed field does not discard the raw page or unrelated valid fields. Unknown pages remain available for later replay and are observable in ingestion output.

The catalog parser uses the actual card link when present instead of reconstructing model URLs from display names. Technical-sheet parsers extract tables and definition-list pairs, then apply canonical specification aliases such as `power_hp`, `torque_nm`, `transmission`, `drivetrain`, `seating_capacity`, and `cargo_capacity`.

## Incremental ingestion

The ingestion command runs in phases:

1. Discover URLs from the seed catalog and configured public links.
2. Fetch and upsert pages.
3. Skip parsing and document regeneration when a page content hash is unchanged.
4. Parse changed pages by page type.
5. Upsert canonical entities and provenance.
6. Generate or replace only documents whose normalized content hash changed.
7. Leave embedding work to a separate worker command.

Database writes are idempotent. A failed page is recorded with its error and does not roll back successful pages from the same crawl batch.

## Search behavior

The public search request is:

```ts
{
  query: string;
  filters?: {
    maxPrice?: number;
    minPrice?: number;
    modelYear?: number;
    category?: string;
    bodyType?: string;
    fuelType?: string;
  };
  limit?: number;
}
```

Search execution is:

1. Validate request and normalize filters.
2. Apply deterministic SQL constraints against structured tables.
3. Retrieve keyword candidates using PostgreSQL Spanish full-text search.
4. Retrieve semantic candidates from pgvector for documents belonging to the deterministic candidate set, when an embedding is available.
5. Fuse normalized keyword and semantic scores with explicit weights.
6. Collapse section hits into vehicle-level results while retaining matched document sections.
7. Apply stable tie-breaking and return source URLs, crawl timestamps, and matched evidence.

If query embedding is unavailable, the service returns deterministic and keyword results with an explicit `semanticSearch: "unavailable"` status. It never silently pretends keyword results are semantic results.

The service returns structured results suitable for an LLM to explain, but the LLM is not part of hard filtering or price validation.

## REST API

Initial endpoints:

- `POST /search`: hybrid vehicle search.
- `GET /vehicles/:model/:year`: structured vehicle details and provenance.
- `GET /vehicles/:id/compare`: validated comparison of selected vehicle records.
- `GET /health`: database and embedding capability status.

Request and response contracts are defined once with Zod and reused by route handlers and MCP tools.

## MCP server

The MCP server is an adapter over `SearchService`, `VehicleQueryService`, and `ProvenanceService`; it does not contain SQL or duplicate ranking logic.

Initial read-only tools:

- `search_vehicles`: natural-language query plus deterministic filters.
- `get_vehicle`: model/year or canonical entity lookup.
- `compare_vehicles`: compare two or more canonical vehicles.
- `get_vehicle_provenance`: retrieve source URLs and crawl timestamps for a result field.
- `list_promotions`: deterministic promotion lookup with validity filters.
- `get_catalog_status`: report crawl and embedding freshness.

The first transport is stdio for local MCP hosts. Tool inputs are schema-validated, limits are bounded, and errors are returned as structured tool errors. No tool submits forms or changes dealership data.

## Error handling and observability

- Configuration errors fail fast at process startup.
- Network fetch failures are recorded per page and retried with bounded backoff.
- Parser failures become page-level warnings/errors with raw HTML retained.
- Database transactions are scoped to one page/entity batch and use idempotent upserts.
- Embedding failures set a retryable status and preserve the document.
- Search reports degraded capability when vector or embedding services are unavailable.
- Structured logs include crawl run ID, page URL, parser type, entity ID, and document ID, but never API keys or personal form data.

## Testing strategy

- Unit tests first for URL policy, page classification, price parsing, model normalization, specification aliases, document hashes, score fusion, and request validation.
- HTML fixture tests for catalog, model, technical-sheet, promotion, financing, service, used-vehicle, FAQ, and dealer-information parser contracts.
- Repository integration tests against PostgreSQL + pgvector for migrations, idempotent upserts, full-text search, vector ranking, and hybrid filtering.
- API tests for hard price/year/category constraints and provenance response shape.
- MCP tests that call tools through the server adapter and verify they delegate to the same search service contracts as REST.
- No live site or embedding API is required for the default test suite; live crawling is an explicit operator command.

## Acceptance criteria

1. A clean local setup can start PostgreSQL with pgvector and apply migrations.
2. A fixture-based ingestion run creates structured entities, source pages, documents, and provenance without an embedding key.
3. A second run with unchanged page hashes performs no unnecessary document regeneration.
4. A query with `maxPrice` and `modelYear` cannot return records outside those constraints.
5. A semantic query uses pgvector when embeddings exist and reports degraded status when they do not.
6. REST and MCP return the same search semantics and provenance fields.
7. Form/action URLs are excluded from the crawl policy.
8. Unit, integration, API, and MCP tests run through documented commands.
