# Colima default migration and MCP verification

- [x] Back up the `emme` PostgreSQL database.
- [x] Start the `default` Colima profile with at least 4 GiB.
- [x] Start PostgreSQL on `default`.
- [x] Restore and verify the catalog, pgvector embeddings, and HNSW index.
- [x] Use the existing local BGE-M3 Ollama service for MCP embedding queries.
- [x] Delete the obsolete `emme` Colima profile after migration verification.
- [x] Test MCP with catalog status, deterministic filters, semantic queries, and vehicle lookup.
- [x] Run lint, tests, and build.

## Acceptance criteria

- Default Colima profile has at least 4 GiB and is the active Docker endpoint.
- PostgreSQL has 79 documents, 79 ready embeddings, 0 pending embeddings, and 1024-dim vectors.
- The HNSW cosine index exists on the embedding column.
- MCP answers multiple deterministic and semantic questions with `semanticSearch: ready`.
- The obsolete `emme` profile is removed only after the restore is verified.

## Results

- `default` is running with 6 GiB, 4 CPUs, and Docker context `colima`.
- Native Ollama `bge-m3:latest` is serving 1024-dimensional embeddings on port 11434.
- Docker Ollama image pull was stopped because the uncached image exhausted local disk during unpack; MCP remains fully operational through the existing local Ollama service.
- MCP live checks passed for status, filtered search, semantic search, vehicle details, comparison, provenance, and promotions.
- Unit/API/MCP tests: 43 passed. Lint and build: passed.

## Ford MCP data-quality improvements (2026-09-27)

- [x] Trace five findings to code and stored records.
- [x] Correct financing classification and flag label/term conflicts, including existing records.
- [x] Mark missing offer validity dates as unknown in MCP results and search evidence.
- [x] Discover catalog detail pages; persist specs and features with per-field sources.
- [x] Include specs/features in vehicle comparisons.
- [x] Report latest crawl time in catalog status.
- [x] Verify unit suite, build, lint, migration dry-run, and live MCP behavior.

Acceptance criteria:

- Finance API plans are not exposed as generic promotions; MSI offers keep their MSI type.
- Conflicting plan label and structured term are explicitly returned and searchable.
- Offers without validity dates are labeled unknown; they are never presented as confirmed active.
- Catalog crawl reaches model and technical-sheet URLs; extracted specs/features persist with provenance.
- Compare returns price and available specs/features; catalog status includes the latest crawl timestamp.
- Existing financing rows/documents are backfilled and their embeddings queued for refresh.

Results:

- Migration `011_financing_quality_backfill.sql` reclassified the 747 finance API rows, annotated 594 conflicting plan labels, refreshed their offer documents, and queued changed embeddings.
- Ford crawl fetched 40 technical-sheet pages (all HTTP 200); ingest stored 1,730 specifications and 1,269 equipment features across 40 vehicle years.
- Embedding worker switched to batches of 16; retry embedded all 867 pending records with zero failures.
- Live MCP simulation: 100 flows, 100 calls per tool, 700 total calls, all tool and flow checks passed.
- Unit tests: 92 passed. Lint and TypeScript build passed.
- Ford's promotions page currently has no rendered offer cards, so `list_promotions` correctly returns an empty list instead of relabeling finance plans as promotions.
- [x] Persist the 100-flow MCP evaluation as `npm run eval:mcp`, with configurable flow count/concurrency and tested argument validation.
- [x] Document the evaluator's local-only, read-only behavior and its deterministic reply-template limitation.

Follow-up evaluation result:

- `npm run eval:mcp -- --flows=100 --concurrency=3`: 100 flows, 700/700 MCP tool calls passed, 0 flow errors, ~8.9 seconds.
- Unit tests: 95 passed. Lint and TypeScript build passed.
- Remaining observed data issues: all sampled finance offers have unknown validity dates; many buyer budgets exclude the requested model; 15 sampled selected offers had term-conflict warnings. The template labels these cases. The page exposes promotions through an AJAX endpoint but the fetched page had no `#htkn` token value, so no promotion records were invented or ingested.

## Local LLM-to-MCP evaluation (2026-09-27)

- [x] Add `npm run eval:mcp:llm` using local Ollama Qwen2.5:3b and the live stdio MCP tool schemas.
- [x] Add deterministic scoring for expected tool use, financing-result discussion, budget disclosure, unknown validity, and term conflicts.
- [x] Improve the `search_offers` schema descriptions with exact enum/filter guidance and smaller recommended result limits.
- [x] Run one real buyer flow and one 100-flow batch.

Results:

- One-flow run completed with 0/1 passing: the model called `search_vehicles` correctly, then told the buyer it needed another search for financing instead of calling `search_offers`.
- The full local 100-flow batch completed with 6/100 passing. Ollama became unavailable during the run; 86 flows had model-call failures. Of the returned answers, common issues included skipped expected tools, ignored financing results, and malformed IDs passed to `compare_vehicles`.
- Local evaluation needs no API key. A 3B model is lightweight but not yet reliable enough for the lead flow; improve the orchestration/tool-call guidance and re-evaluate before using it for real leads.

## Local LLM MCP flows 11-20 (2026-09-27)

- [x] Flow 11: route promotions and financing to their distinct tools; keep answer concise and disclose validity/term conflicts.
- [x] Flow 12: treat null optional offer filters as omitted before calling the offer service.
- [x] Flow 14: avoid claiming populated specifications are missing; cap specification recap to a concise subset.
- [x] Flow 15: reliably disclose unknown offer validity and avoid suggesting dealer follow-up for omitted search results.
- [x] Add focused regression tests before each implementation change.
- [x] Rerun repaired flows 11, 12, 14, and 15 sequentially.
- [x] Run flows 15-20 sequentially and capture pass/fail evidence.
- [x] Run focused tests, lint, and build.

Working notes: Flows 11, 12, 14, and 15 failed on 2026-09-27; Flow 13 passed. Keep model runs serial due workstation memory limits. This checkout has no git repository metadata.

Results: repaired Flows 11, 12, 14, and 15 passed on rerun. Flows 16, 17, 18, 19, and 20 passed sequentially. Flow 15 passed after the combined tool required distinct vehicle and offer prices plus monthly payment; Flow 19 passed after routing financing-only requests to `search_offers`.

## Local LLM MCP flows 21-30 (2026-09-27)

- [x] Run Flows 21-30 serially.
- [x] Fix null offer query handling and composite routing for budgeted vehicle-plus-financing requests.
- [x] Reject unrelated vehicle search results in the composite response.
- [x] Correct empty-offer scoring so a clear negative answer is not flagged as an availability claim.

Results: initial run passed 8/10. Flows 22 and 26 were repaired and rerun successfully; the complete 21-30 cycle is now 10/10 passed. The MCP accepts `query: null` as omitted, composite results only retain the requested model/year, and the evaluator distinguishes “no offers” from unsupported availability claims.

## Local LLM MCP flows 31-40 (2026-09-27)

- [x] Run Flows 31-40 serially.
- [x] Bound comparison responses to exact prices and two specifications per vehicle.
- [x] Bound vehicle detail responses to a short specification subset.
- [x] Avoid requiring a source link when the MCP has no source record.

Results: initial run passed 6/10. Flows 31, 35, 37, and 38 were repaired and rerun successfully; the complete 31-40 cycle is now 10/10 passed. Comparison output no longer exposes omission counts or feature arrays that caused local-model truncation.

## Local LLM MCP flows 41-50 (2026-09-27)

- [x] Run Flows 41-50 serially.
- [x] Handle malformed singular comparison calls without throwing or fabricating a comparison.
- [x] Rerun the affected flow and verify the full cycle.

Results: initial run passed 9/10. Flow 45 was repaired and rerun successfully; the complete 41-50 cycle is now 10/10 passed. A singular `compare_vehicles` payload now returns an empty comparison result, allowing the model to report that two comparison inputs are needed instead of leaking a tool error.

## Local LLM MCP flows 51-60 (2026-09-27)

- [x] Run Flows 51-60 serially.
- [x] Bound `get_vehicle` details and missing-name output for source/equipment requests.
- [x] Add a copy-friendly source URL alias for local-model responses.
- [x] Rerun affected flows and verify the full cycle.

Results: initial run passed 8/10. Flows 51 and 58 were repaired and rerun successfully; the complete 51-60 cycle is now 10/10 passed. Vehicle detail responses now expose at most three specifications and three missing names, reducing truncation while preserving source provenance.

## Local LLM MCP flows 61-70 (2026-09-27)

- [x] Run Flows 61-70 serially.
- [x] Require explicit over-budget wording when offers exceed a buyer budget.
- [x] Rerun the affected flow and verify the full cycle.

Results: initial run passed 9/10. Flow 68 was repaired and rerun successfully; the complete 61-70 cycle is now 10/10 passed.

## Local LLM MCP flows 71-80 (2026-09-27)

- [x] Run Flows 71-80 serially.
- [x] Rerun each flow in the latter half serially after the initial evaluator process ended before its summary.
- [x] Confirm no regressions or new failures in this cycle.

Results: all ten flows passed. Flows 71-74 passed in the initial serial run; 75-80 each passed in individual serial runs to capture evidence after the evaluator process ended before printing its aggregate report.

## Local LLM MCP flows 81-90 (2026-09-27)

- [x] Run Flows 81-90 serially.
- [x] Fix false-positive scoring of negative offer availability claims.
- [x] Normalize top-level financing filters and enforce exact offer model/year matching.
- [x] Rerun affected flows and verify the cycle.

Results: Flow 85 passed after the scorer learned to separate negative statements from positive availability claims. Flow 89 revealed top-level model/year filters being discarded, which allowed unrelated F-150 financing results for a RANGER RAPTOR query. The MCP now accepts both nested and top-level common financing filters and removes results that do not exactly match the requested model/year. Flow 89 rerun passed with matching RANGER offers and its term conflict disclosed. All ten flows passed.

## Local LLM MCP flows 91-100 (2026-09-27)

- [x] Run Flows 91-100 serially.
- [x] Prevent financing offers from being mislabeled as promotions when the promotion result is empty.
- [x] Prevent duplicate category searches after both requested tools have returned.
- [x] Rerun Flow 95 and verify the full cycle.

Results: initial run passed 9/10. Flow 95 was rerun successfully after explicitly requiring one call each to promotions and financing searches, and requiring the final answer to keep the categories separate. The complete 91-100 cycle is now 10/10 passed.
