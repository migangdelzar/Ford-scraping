# Ford Uruapan Incremental HTTP Synchronization Design

## Goal

Replace the browser-first scheduled crawl with a fast, deterministic HTTP + Cheerio synchronization pipeline for Ford Uruapan's server-rendered public pages. Run it daily at 12:00 in `America/Mexico_City`, preserve provenance, update structured records incrementally, and re-embed only changed searchable documents.

## Scope

- Fetch the new-vehicle catalog with standard HTTP GET requests.
- Extract new vehicles: model, model year, starting price, category, and source URL.
- Extract Seminuevos inventory: stable inventory ID, title, price, mileage, transmission, image URLs, detail URL, and active state.
- Extract public promotion titles, details, validity text, model references, and source URLs.
- Synchronize financing per model/year/version/plan/term through the site's read-only AJAX endpoint.
- Sanitize extracted text and return strongly typed parser results.
- Add a daily scheduler and an operator-facing synchronization summary.
- Keep Playwright as an explicit fallback for pages that fail SSR completeness checks.

## Non-goals

- Submitting quote, contact, financing application, appointment, or personal-data forms.
- Replacing PostgreSQL + pgvector.
- Re-embedding unchanged content.
- Deleting historical inventory, prices, offers, or source pages.

## Site integration assumptions

Ford Uruapan currently exposes the main catalog and Seminuevos records in server-rendered HTML. Its financing page exposes model/year references and loads version and plan data through read-only POST actions to `/info/consultas.ashx`, authenticated by a short-lived page token and dealer identifier.

The implementation must treat selectors and endpoint response fields as an external contract: parsers use fallback selectors, validate required identifiers, preserve raw responses, and emit warnings when the contract changes.

## Architecture

```text
daily scheduler (America/Mexico_City)
              |
              v
       PostgreSQL advisory lock
              |
              v
      HTTP synchronization run
       |       |        |       |
       v       v        v       v
    catalog seminuevos offers financing
       |       |        |       |
       +-------+--------+-------+
                       |
                       v
             sanitize + normalize
                       |
                       v
             SQL upsert + provenance
                       |
              changed document hashes
                       |
                       v
                pending embeddings
                       |
                       v
                 local BGE-M3
                       |
                       v
                    pgvector
```

The scheduler invokes an idempotent synchronization command rather than embedding synchronization logic inside a long-running timer. A dedicated TypeScript scheduler container triggers the command. PostgreSQL advisory locking prevents overlapping runs and makes restarts safe.

## HTTP fetcher

Create a reusable HTTP page fetcher with:

- `User-Agent` identifying the application without impersonating a specific user.
- `Accept: text/html,application/xhtml+xml`.
- `Accept-Language: es-MX,es;q=0.9,en;q=0.8`.
- `Referer` for page navigation where applicable.
- Per-request timeout.
- Bounded retries for network errors and 429/5xx responses.
- Status validation before parsing.
- Response body size limit.
- Content hash computed from the raw response body.
- Optional `ETag` and `Last-Modified` support when the origin provides them.

The fetcher maintains cookies for the duration of a financing synchronization run so the ASP.NET session and financing token remain associated. It never follows links outside the configured host allowlist.

## Parsers and output types

All parser outputs are typed arrays of normalized records. Missing optional fields become `undefined`, not fabricated values.

```ts
interface NewVehicleRecord {
  modelName: string;
  modelYear: number;
  startingPrice?: number;
  currency: 'MXN';
  category?: string;
  detailUrl: string;
  sourceUrl: string;
}

interface UsedVehicleRecord {
  inventoryId: string;
  title: string;
  price?: number;
  currency: 'MXN';
  mileageKm?: number;
  transmission?: 'automatic' | 'manual' | 'other';
  imageUrls: string[];
  detailUrl?: string;
  sourceUrl: string;
}

interface PromotionRecord {
  title: string;
  detail: string;
  modelName?: string;
  modelYear?: number;
  validFrom?: string;
  validUntil?: string;
  sourceUrl: string;
}
```

Every string passes through one sanitizer that replaces non-breaking spaces, collapses whitespace, removes surrounding whitespace, and returns `undefined` for empty values. Prices normalize Mexican separators and tolerate missing price text. Image URLs resolve against the page URL and duplicates are removed.

## Incremental synchronization

Add a `crawl_runs` record with start/end timestamps, status, counters, and error summary. Each synchronized page continues to use its content hash:

1. Fetch the target URL.
2. Upsert the page and determine whether its hash changed.
3. Skip parsing unchanged pages.
4. Parse and upsert changed pages in an idempotent transaction.
5. Generate normalized searchable documents.
6. Mark only changed documents as `pending`.
7. Run the embedding worker over pending documents.
8. Mark previously seen Seminuevos inventory as inactive when it is absent from the current complete inventory snapshot.

Inventory and offer rows are never physically deleted. Current search filters use active/valid records, while provenance and historical state remain available for auditing.

## Financing synchronization

The financing client uses the following read-only sequence:

```text
GET /Financiamiento/
  -> token, dealer ID, model/year references
POST GetPlanesActivosPorClaveGen
  -> active vehicle keys
POST GetPlanesActivosPorVersion
  -> versions, external version IDs, list prices
POST GetPlanes
  -> plans, terms, rates, down-payment limits, insurance, messages
```

Each normalized financing offer is attached to a canonical `model_year` and, when matched, a `variant`. The stable identity includes the dealership/source, model-year, external version ID, plan ID, and term. Raw response JSON is retained in metadata for replay and auditing. Calculated monthly payments are labeled as calculated and are never confused with an amount explicitly returned by the source.

## Scheduling

The first scheduler deployment uses a dedicated TypeScript process with the IANA timezone `America/Mexico_City` and cron expression:

```text
0 12 * * *
```

The scheduler triggers one synchronization run, records its result, and exits or waits for the next schedule depending on the container mode. The command remains independently runnable for manual recovery. A failed run does not mark records inactive and can be retried safely.

## Error handling and observability

- HTTP errors are recorded per URL and do not abort unrelated targets.
- Parser warnings include the URL and missing selector/field.
- Invalid records are skipped with a warning rather than inserted with fabricated values.
- Financing action failures identify the action but never log tokens, cookies, or personal form data.
- Scheduler logs include run ID, duration, fetched/changed/failed pages, entities upserted, inactive inventory count, pending embeddings, and embedding failures.
- A synchronization status query reports the last successful run and stale pages.

## Testing

- Unit tests for whitespace sanitization, price/mileage parsing, transmission mapping, image URL resolution, fallback selectors, and missing fields.
- HTML fixtures for catalog, Seminuevos, promotions, and financing bootstrap pages.
- HTTP client tests for status validation, retries, headers, cookies, and financing action payloads.
- Integration tests for idempotent synchronization, changed-document pending state, inactive Seminuevos inventory, financing identity, and embedding count.
- Scheduler tests using a fake clock/timezone and advisory-lock behavior.
- One live smoke command remains optional and read-only; it is not required for the default test suite.

## Acceptance criteria

1. The daily job runs at 12:00 in `America/Mexico_City`.
2. Catalog, Seminuevos, and promotions are fetched with HTTP and parsed using Cheerio.
3. Missing optional fields do not crash synchronization.
4. Unchanged pages and documents do not trigger new embeddings.
5. Removed inventory becomes inactive instead of disappearing from history.
6. Financing plans are linked to model/year/version/term when source identifiers are present.
7. Every synchronized record retains source URL, crawl timestamp, and content hash.
8. Overlapping scheduler runs are prevented by PostgreSQL advisory locking.
9. The synchronization summary exposes failures and embedding backlog.
