# Incremental HTTP Synchronization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with verification checkpoints.

**Goal:** Add a daily, incremental HTTP + Cheerio synchronization pipeline for new vehicles, Seminuevos, promotions, and per-version financing while preserving the existing PostgreSQL + pgvector and MCP architecture.

**Architecture:** A reusable HTTP fetcher replaces Playwright for scheduled SSR pages. A synchronization service records crawl runs, upserts changed pages and structured entities, marks changed documents pending, and runs the existing embedding worker. Financing keeps its current client/service boundary and gains cookie/session handling, stable version/plan/term identity, and incremental offer lifecycle updates. Playwright remains available for the existing manual crawl command as a fallback.

**Tech Stack:** TypeScript, Node.js 22, native `fetch`, Cheerio, PostgreSQL 16 + pgvector, Fastify, MCP SDK, Ollama BGE-M3, Vitest, `node-cron`.

## Global Constraints

- Use `America/Mexico_City` and `0 12 * * *` for the daily schedule.
- Use HTTP GET + realistic browser headers for scheduled SSR pages.
- Parse HTML with Cheerio and sanitize all extracted strings.
- Do not submit quote, contact, financing-application, appointment, or personal-data forms.
- Preserve raw pages, source URLs, crawl timestamps, and content hashes.
- Do not re-embed unchanged normalized document content.
- Keep deterministic SQL filters before keyword/vector retrieval.
- Use Google TypeScript Style and kebab-case filenames.
- Write failing tests before production code for every behavioral change.

---

### Task 1: Add shared normalization and HTTP transport

**Files:**
- Create: `src/crawl/text-normalization.ts`
- Create: `src/crawl/http-fetcher.ts`
- Test: `tests/unit/text-normalization.test.ts`
- Test: `tests/unit/http-fetcher.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces `sanitizeText(value: string | undefined): string | undefined`, `parseMoney(value: string | undefined): number | undefined`, and `parseMileageKm(value: string | undefined): number | undefined`.
- Produces `HttpPageFetcher.fetch(url: string, options?: HttpFetchOptions): Promise<FetchedHttpPage>`.

- [ ] Write tests for whitespace/non-breaking-space normalization, Mexican prices, mileage, missing values, browser headers, non-2xx rejection, and retrying one transient 503 before succeeding.
- [ ] Run `npm test -- --run tests/unit/text-normalization.test.ts tests/unit/http-fetcher.test.ts`; verify the new imports/functions fail because they do not exist.
- [ ] Implement the sanitizer and numeric parsers with no fabricated defaults.
- [ ] Implement fetch with timeout, response-size guard, `User-Agent`, `Accept`, `Accept-Language`, optional `Referer`, status validation, bounded retry, and a small cookie jar based on `set-cookie` response headers.
- [ ] Add `node-cron` only when the scheduler task needs it; keep this task dependency-free if native fetch and current packages suffice.
- [ ] Re-run the focused tests and then `npm run lint`.

### Task 2: Add typed SSR parsers for catalog, Seminuevos, and promotions

**Files:**
- Create: `src/parsers/used-vehicle-parser.ts`
- Modify: `src/parsers/catalog-parser.ts`
- Modify: `src/parsers/public-page-parser.ts`
- Modify: `src/domain/contracts.ts`
- Test: `tests/unit/used-vehicle-parser.test.ts`
- Modify: `tests/unit/parsers.test.ts`
- Modify: `fixtures/pages/used-vehicle.html`

**Interfaces:**
- Produces `NewVehicleRecord[]`, `UsedVehicleRecord[]`, and `PromotionRecord[]` parser outputs.
- Reuses `sanitizeText`, `parseMoney`, and `parseMileageKm`.

- [ ] Add fixture assertions for a catalog card with a price, a catalog card without a price, a Seminuevos card with title/price/mileage/transmission/images/detail URL, and a promotion with missing optional fields.
- [ ] Run the focused parser tests and verify they fail on missing parser behavior.
- [ ] Implement fallback selectors that prioritize Ford’s observed card shapes, resolve absolute image/detail URLs, extract inventory IDs from detail URLs or `AutoID`, map `Automática`/`Manual`, and emit warnings instead of throwing for incomplete cards.
- [ ] Update catalog and promotion parsers to use shared sanitization and preserve source URLs.
- [ ] Re-run parser tests and `npm run format && npm run lint`.

### Task 3: Persist Seminuevos inventory and synchronization runs

**Files:**
- Create: `db/migrations/009_incremental_sync.sql`
- Create: `src/storage/used-vehicle-repository.ts`
- Create: `src/storage/sync-run-repository.ts`
- Create: `src/domain/sync.ts`
- Modify: `src/domain/contracts.ts`
- Test: `tests/unit/sync.test.ts`
- Test: `tests/integration/used-vehicle-repository.test.ts`
- Test: `tests/integration/sync-run-repository.test.ts`

**Interfaces:**
- `ford.used_vehicles` stores `inventory_id`, title, price, mileage, transmission, detail URL, active state, first/last seen timestamps, source page, metadata, and content hash.
- `ford.sync_runs` stores run status, timestamps, counters, and error JSON.
- `UsedVehicleRepository.syncSnapshot(records, page): Promise<UsedVehicleSyncSummary>` upserts current inventory and deactivates records absent from the complete snapshot.
- `SyncRunRepository.start()`, `finish()`, and `fail()` persist run state.

- [ ] Write tests for idempotent used-vehicle upserts, changed content hashes, deactivation of missing inventory, and sync-run success/failure transitions.
- [ ] Run the focused integration tests against PostgreSQL and verify schema/repository failures before adding the migration or repository code.
- [ ] Add the migration with unique inventory identity, indexes for active/price/mileage/transmission, and non-destructive lifecycle columns.
- [ ] Implement transactional snapshot synchronization; never deactivate inventory when the source fetch is incomplete or failed.
- [ ] Add repository methods and typed summaries.
- [ ] Re-run the focused integration tests and migration checks.

### Task 4: Make page ingestion change-aware

**Files:**
- Modify: `src/crawl/ingestion.ts`
- Modify: `src/storage/page-repository.ts`
- Modify: `src/storage/document-repository.ts`
- Modify: `src/composition-root.ts`
- Test: `tests/integration/database.test.ts`
- Test: `tests/integration/ingestion-offers.test.ts`

**Interfaces:**
- `PageRepository.listChangedSince(runStartedAt?: Date): Promise<StoredPage[]>` returns only changed/new pages for a sync run.
- `ingestPage(page, dependencies): Promise<PageIngestionSummary>` parses one page and leaves unchanged documents untouched.
- Existing `ingestPages` remains available for manual replay and delegates to `ingestPage`.

- [ ] Add an integration test proving a second ingestion with identical page/document content leaves ready embedding rows ready and does not create new pending jobs.
- [ ] Run the test and verify the current implementation exposes the missing change-aware behavior.
- [ ] Implement page-level changed filtering and one-page ingestion while preserving existing parser/repository behavior.
- [ ] Ensure changed document content resets only that document’s embedding to pending; unchanged documents retain their ready vectors.
- [ ] Re-run all ingestion/database integration tests.

### Task 5: Strengthen financing identity and HTTP session behavior

**Files:**
- Modify: `src/finance/ford-finance-client.ts`
- Modify: `src/finance/financing-offers.ts`
- Modify: `src/finance/financing-sync.ts`
- Modify: `src/storage/offer-repository.ts`
- Modify: `db/migrations/009_incremental_sync.sql`
- Test: `tests/unit/ford-finance-client.test.ts`
- Test: `tests/unit/financing-offers.test.ts`
- Test: `tests/unit/financing-sync.test.ts`
- Test: `tests/integration/offer-repository.test.ts`

**Interfaces:**
- Financing requests retain the existing action sequence: `GetPlanesActivosPorClaveGen`, `GetPlanesActivosPorVersion`, and `GetPlanes`.
- `OfferCandidate.metadata` carries stable `vehicleKey`, `versionId`, `planId`, `termMonths`, source response, and calculated-payment provenance.
- Offer identity uses source page/dealer, model year, external version ID, plan ID, and term instead of title-only matching.

- [ ] Add failing tests for cookie propagation between financing bootstrap and action requests, exact request headers/body, two terms under one plan producing two offers, and same-title offers with different version/term IDs remaining distinct.
- [ ] Run the focused unit/integration tests and verify failures.
- [ ] Implement cookie persistence, header/referer handling, stable metadata identity, and repository upserts based on external identity.
- [ ] Preserve the existing monthly-payment calculation and explicitly label it as calculated.
- [ ] Re-run financing tests and confirm `search_offers` remains compatible.

### Task 6: Implement the scheduled synchronization service

**Files:**
- Create: `src/sync/site-synchronization.ts`
- Create: `src/sync/synchronization-targets.ts`
- Modify: `src/composition-root.ts`
- Modify: `src/cli.ts`
- Test: `tests/unit/site-synchronization.test.ts`
- Test: `tests/integration/site-synchronization.test.ts`

**Interfaces:**
- `SiteSynchronizationService.run(): Promise<SiteSynchronizationSummary>` performs the catalog, Seminuevos, promotions, financing, and embedding phases.
- `sync` is a manual CLI command with the same service used by the scheduler.
- The service acquires a PostgreSQL advisory lock before changing data and releases it in `finally`.

- [ ] Add tests proving failed fetches do not deactivate inventory, unchanged pages are skipped, changed documents become pending, and a successful run embeds pending documents.
- [ ] Run focused tests and verify the service is absent/failing.
- [ ] Implement target URL synchronization using HTTP fetch + Cheerio, page upserts, changed-page ingestion, Seminuevos snapshot persistence, financing sync, and embedding worker execution.
- [ ] Add `sync` to CLI output and ensure the application pool closes on every non-server command path.
- [ ] Re-run synchronization tests and the full unit suite.

### Task 7: Add the daily scheduler and operational configuration

**Files:**
- Modify: `src/config.ts`
- Create: `src/scheduler.ts`
- Modify: `src/cli.ts`
- Modify: `docker-compose.yml`
- Modify: `README.md`
- Modify: `docs/operations.md`
- Test: `tests/unit/config.test.ts`
- Test: `tests/unit/scheduler.test.ts`

**Interfaces:**
- Configuration defaults to `SYNC_SCHEDULE=0 12 * * *` and `SYNC_TIMEZONE=America/Mexico_City`.
- CLI command `npm run dev -- scheduler` starts the long-running scheduler; `npm run dev -- sync` runs one immediate synchronization.

- [ ] Add config tests for the timezone and schedule defaults and validation of invalid timezone/schedule values.
- [ ] Add scheduler tests with a fake callback and controlled clock that prove the configured timezone/schedule is passed to `node-cron` and failures are logged without killing the scheduler.
- [ ] Add `node-cron`, implement scheduler startup, and add a Docker Compose scheduler service sharing the application environment and database.
- [ ] Document manual sync, scheduler startup, run metrics, and safe recovery.
- [ ] Re-run scheduler/config tests and lint/build.

### Task 8: Full verification and live smoke test

**Files:**
- Modify: `README.md` only if commands or status output changed.
- Test: existing unit, integration, API, and MCP suites.

- [ ] Run `npm run format` and `npm run lint`.
- [ ] Run `npm run build`.
- [ ] Run all unit/API/MCP tests.
- [ ] Run integration tests against PostgreSQL after ensuring they use isolated fixture cleanup.
- [ ] Run one manual `sync` against the live site with HTTP transport and record fetched/changed/failed counts, Seminuevos count, financing count, and pending/embedded counts.
- [ ] Invoke MCP `get_catalog_status`, `search_vehicles`, and `search_offers` after synchronization to verify the scheduler output is searchable.
- [ ] Report any remaining live-site parser warnings separately from automated test failures.
