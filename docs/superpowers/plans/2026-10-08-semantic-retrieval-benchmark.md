# Semantic Retrieval Benchmark Implementation Plan

> Inline execution in this session. Do not use subagents. Keep the local database read-only during evaluation.

**Goal:** Isolate vehicle retrieval from offer text and measure local semantic retrieval against labeled Ford document keys.

**Architecture:** Keep search scoping in `SearchRepository`. Add a small JSONL gold set and a local evaluator that calls the existing Ollama embedding provider, runs read-only pgvector nearest-neighbor queries, and computes deterministic ranking and answer-evidence metrics. Do not load an LLM judge.

**Tech Stack:** TypeScript/Node 24, existing `pg` and Ollama BGE-M3 provider, PostgreSQL 16 with pgvector, Vitest.

## Global Constraints

- Use only the local `colima-ford-scraping` PostgreSQL and loopback Ollama endpoints.
- Do not delete, overwrite, or reclassify the three stored test fixture documents.
- Preserve user modifications already present in the working tree.
- Do not run the Gemma 4 judge.

---

### Task 1: Keep offer documents out of vehicle search

**Files:** `tests/integration/search-repository.test.ts`, `src/storage/search-repository.ts`

- [x] Add an offer-linked document with content matching the vehicle query to the dedicated `ford_test` integration database fixture.
- [x] Add an assertion that vehicle `matchedSections` and `evidence` contain no offer document.
- [x] Run the focused integration test and confirm it fails because the offer document appears.
- [x] Add `AND d.offer_id IS NULL` to vehicle `searchKeyword` and `searchSemantic` only.
- [x] Run the focused integration test and confirm it passes; verify offer search tests remain scoped to `offer_id`.

### Task 2: Add deterministic retrieval metrics

**Files:** `scripts/semantic-retrieval-evaluation.ts`, `tests/unit/semantic-retrieval-evaluation.test.ts`

- [x] Test Hit@k, Precision@k, Recall@k, reciprocal rank, and nDCG using one ranked list with a relevant key at rank 2 and one with no hits.
- [x] Confirm the new tests fail before implementing the pure metric functions.
- [x] Implement metric functions with deterministic handling for empty relevant sets and short result lists.
- [x] Run the focused unit test and confirm it passes.

### Task 3: Add labeled local retrieval cases and read-only runner

**Files:** `evals/semantic-retrieval/cases.jsonl`, `scripts/evaluate-semantic-retrieval.mjs`, `docs/mcp-catalog-qa-evals.md`

- [x] Author paraphrases grounded in actual `overview`, `pricing`, and offer documents; record exact relevant `document_key` values and answer facts.
- [x] Make the runner validate loopback DB/Ollama hosts, load BGE-M3 through the existing config/provider, retrieve vehicle and offer cases in their own domains, and write JSON results under `eval-results/semantic-retrieval/`.
- [x] Report per-case ranked keys, Hit@5, Precision@5, Recall@5, MRR, nDCG@5, answer-fact evidence, source/type, embedding-model mix, and aggregate means.
- [x] Document the command and explain that this is deterministic retrieval scoring, not an LLM answer-quality score.
- [x] Run the complete local benchmark and review whether test fixtures or wrong-domain documents appear.

## Final verification

- [x] Run `npx vitest run tests/integration/search-repository.test.ts tests/integration/offer-search.test.ts tests/unit/semantic-retrieval-evaluation.test.ts` against the dedicated `ford_test` database (6 tests passed).
- [x] Run `npx tsx scripts/evaluate-semantic-retrieval.mjs` with local BGE-M3 and `colima-ford-scraping` Postgres.
- [x] Confirm evaluation is read-only through its SQL queries and report metadata (`databaseWrites: 0`).
