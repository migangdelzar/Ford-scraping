# Ford Offers and Financing Hybrid Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing Ford PostgreSQL + pgvector + MCP system so it can ingest, filter, semantically rank, and explain vehicle promotions and financing offers without using embeddings as the source of truth for financial terms.

**Architecture:** Extend the existing `promotions` concept into one `ford.offers` table, preserving structured offer terms and provenance. Reuse `ford.documents` and `ford.document_embeddings` by linking offer documents through `offer_id`. A shared hybrid-search service will apply SQL eligibility filters first, then PostgreSQL full-text search and pgvector ranking; MCP will expose focused `search_offers` and existing `search_vehicles` tools over the same service.

**Tech Stack:** Node.js 22+, TypeScript, PostgreSQL + pgvector, `pg`, Zod, Vitest, Docker Compose, Ollama BGE-M3 embeddings, official MCP TypeScript SDK.

## Global Constraints

- Keep PostgreSQL + pgvector as the only persistence and vector-search system.
- Use the existing `ford` schema and existing 1024-dimensional BGE-M3 vectors.
- Keep price, validity, interest, term, down payment, CAT, and eligibility conditions in typed SQL columns; embeddings never decide financial eligibility.
- Keep the existing `documents` and `document_embeddings` tables; add `offer_id` rather than creating a second vector store.
- Use parameterized SQL and Zod-validated MCP inputs.
- Preserve raw pages, source URLs, crawl timestamps, page hashes, offer hashes, and document provenance.
- Keep the crawler read-only and exclude quote, contact, appointment, and form-submission flows.
- Write a failing test before production code for every behavior change.
- Preserve the existing `search_vehicles`, `list_promotions`, vehicle lookup, provenance, and catalog-status behavior unless a compatibility test proves the replacement is safe.
- The current workspace is not a Git repository; do not claim commits or pushes until a repository is initialized or provided.

## Research Decisions

- Keep the existing HNSW cosine index. pgvector documents filtered approximate search, partial indexes, and iterative scans as later tuning options; the first implementation will reduce candidates with SQL before vector ranking because the catalog is small.
- Reuse the official MCP TypeScript SDK already installed in the project; MCP tools remain thin adapters over application services.
- Do not introduce a reranker, a queue, a read replica, or a separate vector database in this phase. Add those only after evaluation or measured load requires them.

References:

- [pgvector README: filtering, HNSW, and hybrid search](https://github.com/pgvector/pgvector/blob/master/README.md)
- [MCP TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/v2/)

## Current File Map and Planned Changes

Create:

- `db/migrations/008_offers.sql` — extend the existing promotions table into the canonical offers table and link documents to offers.
- `src/domain/offers.ts` — offer types, normalization, active-date rules, and offer document construction.
- `src/storage/offer-repository.ts` — offer upserts and deterministic offer reads.
- `src/search/offer-search-service.ts` — isolated hybrid offer retrieval and reranking.
- `tests/unit/offers.test.ts` — offer normalization, validity, and document tests.
- `tests/integration/offer-repository.test.ts` — offer persistence and SQL-filter tests.
- `tests/integration/offer-search.test.ts` — hybrid offer-search behavior.

Modify:

- `src/domain/contracts.ts` — offer and offer-search contracts.
- `src/domain/documents.ts` — allow offer-linked document candidates.
- `src/storage/document-repository.ts` — upsert stable offer document keys and embeddings.
- `src/storage/search-repository.ts` — deterministic offer candidates plus keyword/vector offer retrieval.
- `src/search/search-service.ts` — preserve the existing vehicle-only search contract.
- `src/storage/read-services.ts` — replace promotion-only reads with an offer service while preserving compatibility.
- `src/parsers/public-page-parser.ts` — parse conservative structured offer candidates from public promotion/financing pages.
- `src/crawl/ingestion.ts` — persist parsed offers and generate offer documents.
- `src/mcp/server.ts` — add `search_offers` while preserving the existing vehicle tool contract.
- `src/composition-root.ts` — wire the offer repository/service.
- `tests/mcp/server.test.ts` — tool contracts and delegation.
- `tests/integration/search-repository.test.ts` — ensure vehicle search remains constrained and regression-free.
- `docs/operations.md` — ingestion, expiry, embedding, and search behavior.
- `README.md` — commands and example MCP requests.

---

### Task 1: Add the canonical offers schema and indexes

**Files:**
- Create: `db/migrations/008_offers.sql`
- Test: `tests/integration/offer-repository.test.ts`
- Modify: `tests/integration/search-repository.test.ts`

**Interfaces:**
- Existing `ford.promotions` becomes the canonical `ford.offers` table through a versioned migration.
- Existing `ford.documents` receives nullable `offer_id`.
- Existing `ford.document_embeddings` and its HNSW index remain unchanged at `VECTOR(1024)`.

- [ ] **Step 1: Write the failing migration/integration assertions**

Add assertions that the migrated database contains `ford.offers`, `offer_type`, `provider`, `term_months`, `months_without_interest`, `annual_interest_rate`, `cat_percent`, `down_payment_amount`, `monthly_payment`, `valid_from`, `valid_until`, `content_hash`, and `ford.documents.offer_id`.

```ts
it('stores financing fields and links offer documents', async () => {
  const columns = await pool.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'ford' AND table_name = 'offers'`
  );
  expect(columns.rows.map(row => row.column_name)).toEqual(expect.arrayContaining([
    'offer_type', 'provider', 'months_without_interest',
    'annual_interest_rate', 'content_hash', 'valid_until'
  ]));

  const documentColumns = await pool.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'ford' AND table_name = 'documents'`
  );
  expect(documentColumns.rows.map(row => row.column_name)).toContain('offer_id');
});
```

- [ ] **Step 2: Run the focused integration test to verify it fails**

Run: `docker compose up -d postgres && npm run migrate && npm test -- --run tests/integration/offer-repository.test.ts`

Expected: FAIL because migration `008_offers.sql` and the new columns do not exist.

- [ ] **Step 3: Implement the versioned migration**

Rename the existing table, add fields, backfill legacy rows, and add constraints/indexes:

```sql
ALTER TABLE ford.promotions RENAME TO offers;

ALTER TABLE ford.offers
  ADD COLUMN IF NOT EXISTS offer_type TEXT NOT NULL DEFAULT 'promotion',
  ADD COLUMN IF NOT EXISTS provider TEXT,
  ADD COLUMN IF NOT EXISTS variant_id UUID REFERENCES ford.variants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cash_price NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS discount_percent NUMERIC(7,2),
  ADD COLUMN IF NOT EXISTS down_payment_amount NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS down_payment_percent NUMERIC(7,2),
  ADD COLUMN IF NOT EXISTS monthly_payment NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS term_months INTEGER,
  ADD COLUMN IF NOT EXISTS months_without_interest INTEGER,
  ADD COLUMN IF NOT EXISTS annual_interest_rate NUMERIC(7,4),
  ADD COLUMN IF NOT EXISTS cat_percent NUMERIC(7,4),
  ADD COLUMN IF NOT EXISTS currency CHAR(3) NOT NULL DEFAULT 'MXN',
  ADD COLUMN IF NOT EXISTS requires_credit_approval BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS conditions TEXT,
  ADD COLUMN IF NOT EXISTS content_hash TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE ford.offers
SET content_hash = encode(digest(
  coalesce(title, '') || '|' || coalesce(description, '') || '|' ||
  coalesce(valid_from::text, '') || '|' || coalesce(valid_until::text, ''),
  'sha256'
), 'hex')
WHERE content_hash IS NULL;

ALTER TABLE ford.offers
  ALTER COLUMN content_hash SET NOT NULL;

ALTER TABLE ford.offers
  ADD CONSTRAINT offers_type_check CHECK (
    offer_type IN ('promotion', 'discount', 'financing', 'months_without_interest',
                   'cashback', 'lease', 'trade_in', 'other')
  ),
  ADD CONSTRAINT offers_months_check CHECK (
    months_without_interest IS NULL OR months_without_interest >= 0
  ),
  ADD CONSTRAINT offers_term_check CHECK (term_months IS NULL OR term_months > 0),
  ADD CONSTRAINT offers_rate_check CHECK (
    annual_interest_rate IS NULL OR annual_interest_rate >= 0
  ),
  ADD CONSTRAINT offers_dates_check CHECK (
    valid_until IS NULL OR valid_from IS NULL OR valid_until >= valid_from
  );

ALTER TABLE ford.documents
  ADD COLUMN IF NOT EXISTS offer_id UUID REFERENCES ford.offers(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS offers_model_year_idx ON ford.offers(model_year_id);
CREATE INDEX IF NOT EXISTS offers_variant_idx ON ford.offers(variant_id);
CREATE INDEX IF NOT EXISTS offers_type_idx ON ford.offers(offer_type);
CREATE INDEX IF NOT EXISTS offers_validity_idx ON ford.offers(valid_from, valid_until);
CREATE INDEX IF NOT EXISTS offers_msi_idx ON ford.offers(months_without_interest);
CREATE INDEX IF NOT EXISTS offers_content_hash_idx ON ford.offers(content_hash);
CREATE INDEX IF NOT EXISTS documents_offer_id_idx ON ford.documents(offer_id);
```

The migration must use the project migration ledger and must not drop existing vectors or documents.

- [ ] **Step 4: Run migrations and existing database tests**

Run: `npm run migrate && npm test -- --run tests/integration/database.test.ts tests/integration/search-repository.test.ts`

Expected: PASS with the existing vehicle/search behavior unchanged.

---

### Task 2: Define offer contracts and deterministic rules

**Files:**
- Create: `src/domain/offers.ts`
- Modify: `src/domain/contracts.ts`
- Create: `tests/unit/offers.test.ts`

**Interfaces:**

```ts
export type OfferType =
  | 'promotion' | 'discount' | 'financing' | 'months_without_interest'
  | 'cashback' | 'lease' | 'trade_in' | 'other';

export interface OfferCandidate {
  modelName?: string;
  modelYear?: number;
  title: string;
  description?: string;
  offerType: OfferType;
  provider?: string;
  cashPrice?: number;
  discountAmount?: number;
  discountPercent?: number;
  downPaymentAmount?: number;
  downPaymentPercent?: number;
  monthlyPayment?: number;
  termMonths?: number;
  monthsWithoutInterest?: number;
  annualInterestRate?: number;
  catPercent?: number;
  currency: string;
  validFrom?: string;
  validUntil?: string;
  requiresCreditApproval: boolean;
  conditions?: string;
  sourceUrl: string;
  metadata: Record<string, unknown>;
}

export interface OfferFilters {
  offerType?: OfferType;
  provider?: string;
  model?: string;
  modelYear?: number;
  maxCashPrice?: number;
  maxMonthlyPayment?: number;
  maxDownPayment?: number;
  minimumMonthsWithoutInterest?: number;
  asOf?: string;
  activeOnly?: boolean;
}

export interface OfferSearchRequest {
  query: string;
  filters?: OfferFilters;
  limit?: number;
}

export interface OfferSearchResponse {
  query: string;
  results: RankedOffer[];
  semanticSearch: 'ready' | 'unavailable';
}

export interface RankedOffer {
  offerId: string;
  title: string;
  offerType: OfferType;
  provider?: string;
  modelName?: string;
  modelYear?: number;
  finalScore: number;
  keywordScore: number;
  semanticScore: number;
  evidence: Array<Pick<DocumentHit, 'title' | 'content' | 'sourceUrl' | 'crawledAt'>>;
}
```

- [ ] **Step 1: Write failing unit tests**

```ts
it('recognizes MSI as a financing offer type', () => {
  expect(normalizeOfferType('12 meses sin intereses')).toBe('months_without_interest');
});

it('treats an offer as active on its end date', () => {
  expect(isOfferActive({ validFrom: '2026-09-01', validUntil: '2026-09-30' }, '2026-09-30')).toBe(true);
  expect(isOfferActive({ validFrom: '2026-09-01', validUntil: '2026-09-30' }, '2026-10-01')).toBe(false);
});

it('does not invent missing financing terms', () => {
  const result = normalizeOfferCandidate({ title: 'Oferta', offerType: 'financing', currency: 'MXN', sourceUrl: '/oferta' });
  expect(result.monthlyPayment).toBeUndefined();
  expect(result.annualInterestRate).toBeUndefined();
});
```

- [ ] **Step 2: Run the unit tests and verify the expected failures**

Run: `npm test -- --run tests/unit/offers.test.ts`

Expected: FAIL because offer helpers and contracts are missing.

- [ ] **Step 3: Implement normalization and validity helpers**

Normalize Spanish labels for `MSI`, `meses sin intereses`, `enganche`, `mensualidad`, `tasa`, and `CAT`. Parse only explicit numeric values. Treat `valid_from` and `valid_until` as inclusive dates. Do not calculate a monthly payment unless the source explicitly provides enough terms and the feature is later approved.

- [ ] **Step 4: Build offer semantic documents**

Implement `buildOfferDocument(offer, vehicleContext?)` so its content includes title, vehicle, provider, term, rate, down payment, monthly payment, validity, and conditions. Include a stable metadata object with `offerId` only after persistence assigns the ID; the repository will use a stable logical key independent of the content hash.

- [ ] **Step 5: Run focused tests**

Run: `npm test -- --run tests/unit/offers.test.ts`

Expected: PASS.

---

### Task 3: Persist offers and generate offer documents

**Files:**
- Create: `src/storage/offer-repository.ts`
- Modify: `src/storage/document-repository.ts`, `src/domain/documents.ts`
- Modify: `src/parsers/public-page-parser.ts`, `src/crawl/ingestion.ts`
- Create: `tests/integration/offer-repository.test.ts`
- Modify: `tests/unit/parsers.test.ts`, `tests/unit/documents.test.ts`

**Interfaces:**

```ts
export interface OfferRef {
  offerId: string;
  modelYearId?: string;
  variantId?: string;
}

export interface OfferRepositoryPort {
  upsertOffer(candidate: OfferCandidate, page: StoredPage): Promise<OfferRef>;
  list(filters: OfferFilters): Promise<unknown[]>;
}
```

- [ ] **Step 1: Add a promotion/financing fixture and failing parser assertions**

Extend `fixtures/pages/promotion.html` and `fixtures/pages/financing.html` with explicit title, vehicle link, provider, price, term, MSI, validity, and conditions. Assert that missing values remain undefined and that actual links are retained.

- [ ] **Step 2: Run parser tests to verify the new assertions fail**

Run: `npm test -- --run tests/unit/parsers.test.ts`

Expected: FAIL because `PublicPageCandidate` does not expose structured offers.

- [ ] **Step 3: Implement conservative public-page offer parsing**

Add `offers: OfferCandidate[]` to `PublicPageCandidate`. Parse explicit cards/tables and known labels only. Keep the generic public-page document even when no structured offer is confidently extracted. If the page contains only prose, create no typed financial fields and emit a warning rather than guessing.

- [ ] **Step 4: Write failing offer upsert tests**

```ts
it('upserts an offer by source identity and changes its embedding job only when content changes', async () => {
  const first = await offers.upsertOffer(sampleOffer, samplePage);
  const second = await offers.upsertOffer(sampleOffer, samplePage);
  expect(second.offerId).toBe(first.offerId);

  const count = await pool.query('SELECT count(*)::int AS count FROM ford.offers');
  expect(count.rows[0].count).toBe(1);
});
```

- [ ] **Step 5: Run the integration test to verify it fails**

Run: `npm test -- --run tests/integration/offer-repository.test.ts`

Expected: FAIL because `OfferRepository` and offer document persistence are missing.

- [ ] **Step 6: Implement offer upsert and document persistence**

Use a stable offer identity based on source page, normalized title, target vehicle, provider, and offer type. Upsert the offer, resolve the model year/variant when the source link matches a known vehicle, and create a document key in this form:

```text
offer:{offerId}:offer:0
```

Extend `DocumentCandidate` with `offerId?: string` and update document inserts/updates to set `offer_id`. Changed content must reset only that document's embedding to `pending`; unchanged content must preserve a ready vector.

- [ ] **Step 7: Wire ingestion**

For promotion and financing pages:

1. Parse the generic public document.
2. Upsert every confident typed offer.
3. Build and upsert one document per offer.
4. Keep the page-level document for unstructured context and provenance.

- [ ] **Step 8: Run parser, document, and integration tests**

Run: `npm test -- --run tests/unit/parsers.test.ts tests/unit/documents.test.ts tests/integration/offer-repository.test.ts`

Expected: PASS.

---

### Task 4: Add deterministic and hybrid offer retrieval

**Files:**
- Modify: `src/storage/search-repository.ts`
- Create: `src/search/offer-search-service.ts`
- Modify: `src/search/ranking.ts` only if a small offer-ID variant is needed; keep vehicle ranking behavior unchanged.
- Create: `tests/integration/offer-search.test.ts`
- Modify: `tests/integration/search-repository.test.ts`

**Interfaces:**

```ts
export interface RankedOffer {
  offerId: string;
  modelName?: string;
  modelYear?: number;
  title: string;
  offerType: OfferType;
  provider?: string;
  monthlyPayment?: number;
  monthsWithoutInterest?: number;
  annualInterestRate?: number;
  validUntil?: string;
  finalScore: number;
  keywordScore: number;
  semanticScore: number;
  evidence: Array<Pick<DocumentHit, 'title' | 'content' | 'sourceUrl' | 'crawledAt'>>;
}
```

Extend `DocumentHit` with `offerId?: string`. Extend `SearchResponse` with an optional offer summary on each ranked vehicle when `includeOffers` is requested. Vehicle ranking continues to use `modelYearId`; offer ranking uses `offerId`.

```ts
interface OfferSearchServicePort {
  searchOffers(request: OfferSearchRequest): Promise<OfferSearchResponse>;
}
```

- [ ] **Step 1: Write failing integration tests for hard offer constraints**

Seed three offers: one active 12-MSI offer under the price limit, one expired offer, and one active offer above the price limit. Assert only the eligible offer is returned even if the excluded offer has the best semantic vector.

```ts
it('applies offer validity and financing filters before semantic ranking', async () => {
  const response = await service.searchOffers({
    query: 'SUV familiar con buena promoción',
    filters: {
      modelYear: 2026,
      maxCashPrice: 800000,
      minimumMonthsWithoutInterest: 12,
      asOf: '2026-09-24',
      activeOnly: true
    }
  });

  expect(response.results.map(result => result.title)).toEqual(['12 meses sin intereses']);
  expect(response.semanticSearch).toBe('ready');
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm test -- --run tests/integration/offer-search.test.ts`

Expected: FAIL because offer candidate and retrieval methods do not exist.

- [ ] **Step 3: Implement SQL candidate filtering**

Add a parameterized `findOfferCandidates(filters, asOf)` query joining `offers`, `model_years`, and `models`. Enforce:

```sql
o.valid_from IS NULL OR o.valid_from <= $as_of
o.valid_until IS NULL OR o.valid_until >= $as_of
o.months_without_interest >= $minimum_msi
my.starting_price <= $max_cash_price
```

Use `CURRENT_DATE` only when the request does not provide `asOf`, making tests deterministic.

- [ ] **Step 4: Implement keyword and vector offer retrieval**

Restrict both `searchKeyword` and `searchSemantic` to `d.offer_id = ANY($offer_ids::uuid[])`. Reuse the existing HNSW vector index and document mapping. Return offer IDs in `DocumentHit` so ranking does not collapse different offers into the same vehicle.

- [ ] **Step 5: Implement offer-level score fusion**

Reuse normalized keyword/semantic score fusion with offer IDs. Keep the existing vehicle fusion unchanged. If embeddings are unavailable, return keyword/deterministic results with `semanticSearch: 'unavailable'`.

- [ ] **Step 6: Run hybrid and regression tests**

Run: `npm test -- --run tests/integration/offer-search.test.ts tests/integration/search-repository.test.ts`

Expected: PASS; expired, over-budget, and insufficient-MSI offers never appear.

---

### Task 5: Add the offer MCP tool without changing vehicle search

**Files:**
- Modify: `src/mcp/server.ts`, `src/composition-root.ts`, `src/storage/read-services.ts`
- Modify: `src/domain/contracts.ts`
- Modify: `tests/mcp/server.test.ts`, `tests/api/routes.test.ts`

**Interfaces:**

Add the MCP tool:

```ts
search_offers({
  query: string,
  filters?: OfferFilters,
  limit?: number
})
```

Keep `list_promotions` as a compatibility alias that calls the offer service with `offerType: 'promotion'`.

- [ ] **Step 1: Write failing MCP contract tests**

```ts
it('exposes search_offers and delegates to the shared search service', async () => {
  const deps = services();
  deps.search.searchOffers = vi.fn().mockResolvedValue({
    query: '12 MSI', results: [], semanticSearch: 'unavailable'
  });
  const tools = registerMcpTools(new McpServer({ name: 'ford', version: '0.1.0' }), deps);

  await (tools.search_offers.handler as any)({
    query: '12 MSI',
    filters: { minimumMonthsWithoutInterest: 12, activeOnly: true }
  }, {});

  expect(deps.search.searchOffers).toHaveBeenCalledWith({
    query: '12 MSI',
    filters: { minimumMonthsWithoutInterest: 12, activeOnly: true }
  });
});
```

- [ ] **Step 2: Run MCP tests and verify they fail**

Run: `npm test -- --run tests/mcp/server.test.ts`

Expected: FAIL because the new service method, schema, and tool are missing.

- [ ] **Step 3: Implement typed MCP schemas and composition-root wiring**

Use Zod for `offerType`, provider, model/year, price, monthly payment, down payment, MSI, date, and limit validation. Do not accept arbitrary filter records for new tools. Wire `OfferRepository`, offer service, and shared search service in `createApplication`.

- [ ] **Step 4: Add optional offers to vehicle results**

When `includeOffers` is true, retrieve active offers only after vehicle candidates are determined. Attach offers to each vehicle result without changing vehicle ranking. When false or omitted, preserve the current response shape.

- [ ] **Step 5: Preserve the legacy promotion tool**

`list_promotions` must still accept its existing input and return promotion-shaped rows, but source them from `ford.offers` with `offer_type = 'promotion'` and validity filtering.

- [ ] **Step 6: Run MCP/API tests**

Run: `npm test -- --run tests/mcp/server.test.ts tests/api/routes.test.ts`

Expected: PASS, including existing tool-name and delegation assertions.

---

### Task 6: Add operational freshness, evaluation, and performance checks

**Files:**
- Modify: `src/storage/read-services.ts`, `src/search/search-service.ts`, `src/cli.ts`
- Create: `tests/unit/search-evaluation.test.ts`
- Modify: `docs/operations.md`, `README.md`

- [ ] **Step 1: Add deterministic evaluation fixtures**

Create cases for:

```text
"Ford 2026 con 12 meses sin intereses"
"SUV familiar con buena promoción por menos de 800 mil"
"¿Qué Ford tiene la mensualidad más baja?"
"¿Hay una promoción vigente para Territory?"
```

Assert hard constraints, active validity, source URL presence, and semantic status. Do not assert exact vector scores; assert inclusion/exclusion and rank order for controlled fixtures.

- [ ] **Step 2: Add timing and result-count instrumentation**

Record candidate count, keyword-hit count, semantic-hit count, embedding duration, SQL duration, total duration, and degraded-search status. Never log query secrets, embedding values, API keys, or form data.

- [ ] **Step 3: Add freshness to catalog status**

Expose active offers, expired offers, pending offer embeddings, failed embeddings, and oldest offer crawl time from `get_catalog_status`.

- [ ] **Step 4: Document operator workflow**

Document:

```bash
npm run migrate
npm run crawl -- --max-pages=100
npm run ingest -- --limit=100
npm run embed -- --limit=100
npm run lint
npm test -- --run
```

Explain that offer changes reset only changed offer documents to `pending`; expired offers remain historically stored but are excluded by active filters.

- [ ] **Step 5: Run complete verification**

Run:

```bash
npm run lint
npm test -- --run
npm run build
```

Expected: TypeScript compilation succeeds, all tests pass, and no skipped tests are introduced.

---

## Future Phases After This Plan

These are intentionally not part of the first implementation:

1. **Vehicle/offers composition:** optionally add `includeOffers` to `search_vehicles`, using deterministic offer hydration without changing vehicle ranking.
2. **Search quality:** replace fixed weighted fusion with Reciprocal Rank Fusion, then add a reranker only if the evaluation set shows a measurable gain.
2. **Offer plans:** add `ford.offer_terms` only when one offer contains multiple plans that cannot be represented safely by the first table.
3. **Historical snapshots:** version offers instead of overwriting them when the same promotion changes terms.
4. **Performance:** add query/embedding caches, connection-pool tuning, and materialized active-candidate views after measuring traffic.
5. **Scale:** enable pgvector iterative scans or partial HNSW indexes for repeated high-selectivity filters; consider a read replica before a separate vector database.
6. **MCP hardening:** add authentication, rate limiting, pagination, audit logs, and a remote transport only when an external consumer requires it.

## Dependency Graph

```text
Task 1 schema
    ↓
Task 2 domain contracts
    ↓
Task 3 ingestion + documents
    ↓
Task 4 deterministic + vector offer search
    ↓
Task 5 MCP/API integration
    ↓
Task 6 evaluation + operations
```

## Definition of Done

- [ ] Active, expired, over-budget, and financing-term filters are deterministic.
- [ ] Offer documents are linked to `ford.offers` and receive BGE-M3 embeddings through the existing worker.
- [ ] `search_offers` performs SQL + full-text + pgvector hybrid search.
- [ ] `search_vehicles` can include active offers without changing vehicle filtering semantics.
- [ ] `list_promotions` remains backward compatible.
- [ ] Every result includes source URL and crawl timestamp when available.
- [ ] Unchanged offer content preserves its ready embedding.
- [ ] Changed offer content becomes pending and is re-embedded.
- [ ] Existing vehicle tests remain green.
- [ ] Full test suite, lint, and build pass.
- [ ] Operations and MCP usage are documented.
