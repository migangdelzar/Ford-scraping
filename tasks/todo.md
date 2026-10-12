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

## Structured vehicle facts and direct visual citations (2026-10-08)

- [x] Fix model name extraction to use the model page route rather than site-wide headings; take the year from the route.
- [x] Extract and persist model trim names and Ford version IDs from the model selector.
- [x] Resolve promotion model/year from each promotion card's vehicle URL; parse spelled-out financing term/rate values.
- [x] Return direct model page, technical sheet, promotion, trim, comparison, and image URLs in MCP records.
- [x] Remove model-year rows created by the bad privacy-heading extraction; reingest stored pages.
- [x] Build and manually inspect Expedition 2027 and promotion outputs.

Acceptance criteria:

- Model name/year match the vehicle route and title, never site-wide privacy headings.
- Expedition 2027 has nine normalized trim rows with source page and Ford trim code.
- Promotion rows for Edge Híbrida 2027 and Maverick Híbrida 2026 link to matching model-year records.
- Vehicle and offer responses include URLs users can open directly; image URLs remain direct assets.
- No new scrape required to repair already-stored pages.

Working constraint: do not add or run tests unless the user asks; run build and deterministic local DB checks.

Results: `npm run build` passed. Migration 015 removed the privacy-heading model row; 157 stored pages reingested with 0 failures, then 56 and 54 pending docs were embedded across the refreshes with 0 failures. Expedition 2027 now has 9 trims with Ford version IDs, 52 specs, 22 images, the model and technical-sheet URLs, and all 9 exact Ford comparison routes. Promotion MCP output now returns the promotion source URL and a direct model page URL; Edge Híbrida 2027 and Maverick Híbrida 2026 are linked to the correct model-years, and Maverick financing terms parse as 60 months at 14.68%. Verified through direct MCP handler calls and SQL against the `colima-ford-scraping` database. No full scrape was needed.

Live route audit: Firecrawl map returned 39 current model detail routes. All 38 DB rows with `page_type=model` matched a live route (accent and trailing-slash differences normalized); all 10 promotion model URLs also matched. Territory 2026 has only a `/Todos/` catalog source in the DB; Firecrawl confirmed its old `/TERRITORY/26/` URL redirects to 2027. `get_vehicle` now returns `modelPageUrl: null` for that year so it does not send buyers to a different model year.

## Promotion, comparison, and semantic evidence improvements (2026-10-09)

- [x] Crawl and parse published `/Comparativo/` pages with only color selector query parameters allowed.
- [x] Store Ford-versus-competitor identity, paired specs, source page, and page images as URL metadata.
- [x] Link Ford-side comparison specs and prices to exact variants; preserve raw competitor terms.
- [x] Normalize promotion legal conditions and explicit insurance/deferred-payment benefits.
- [x] Add MCP tools for trim comparisons, year-over-year comparisons, and Ford-versus-brand pages.
- [x] Separate semantic embedding text from full searchable evidence; exclude image URLs and price-only chunks from vector input.
- [x] Rebuild affected semantic embeddings and manually inspect MCP results.

Results: migrations 016-018 applied; backup `backups/ford-pre-comparison-20261009.dump` verified. Crawled 110 Comparativo routes and ingested 267 pages with 0 failures. Stored 110 comparison rows, 2,447 competitor attributes, 2,447 trim-linked facts, and prices for 110 trims. All 10 promotions have structured terms; three have explicit benefit entries, including Bronco Sport insurance and 90-day payment delay. Added `compare_trims`, `compare_model_years`, and `get_variant_comparisons`. Semantic-only content excludes image URLs and price-only chunks; 885 vectors ready, 0 pending/failed. `npm run build` passed; tests not run per constraint. Manual MCP checks passed for Expedition 2027 trims, 2025–2027 model years, the Chevrolet Tahoe page, and Bronco Sport promotion.

## Ford retrieval and direct-link quality loop (2026-10-09)

- [x] Resolve model pages from variant provenance while preserving separate price-source URLs; no schema migration needed.
- [x] Return direct model and trim-comparison URLs from detail, search, promotion, offer, and comparison tools.
- [x] Build and embed factual vehicle profiles from technical-sheet facts; keep competitor comparison documents in the dedicated comparison path.
- [x] Refresh 38 stored technical-sheet pages and embed all resulting profiles.
- [x] Verify real DB/MCP outputs for Expedition 2027, Territory 2027, Bronco Sport 2026, Maverick Híbrida 2026, and semantic search; build project.
- [x] Update operations and MCP docs.

Results: all 38 vehicle profiles embedded; 0 pending and 0 failures. Expedition returns its direct model page plus nine exact trim comparison URLs. Search, year comparison, promotion, and financing outputs now include direct model links and preserve price/promotion/finance source URLs separately. General semantic and keyword vehicle search excludes `vehicle_comparison` documents; the Expedition vs Chevrolet page remains available through `get_variant_comparisons`. `npm run build` passed. Manual MCP and DB checks passed. Tests not run per constraint. `npm run lint` reports 226 repository-wide errors, mostly formatting plus an existing `URL` global issue in the semantic evaluator; not autoformatted to avoid rewriting unrelated pre-existing changes.

Plan: `docs/superpowers/plans/2026-10-09-retrieval-links-quality.md`.

## MCP routing clarity and structured finance inputs (2026-10-09)

- [x] Define a distinct intent boundary for discovery, lookup, each comparison lane, promotions, financing, and diagnostics.
- [x] Tighten MCP descriptions and document the routing contract without renaming/removing existing tools.
- [x] Extend local LLM scenarios with lifestyle, trim, model-year, and competitor comparison requests.
- [x] Score conflicting tool calls as routing failures.
- [x] Promote existing Ford finance-feed tax, commission, max-down-payment, and insurance inputs to nullable columns; retain raw metadata.
- [x] Run focused/full checks and apply additive migration 019 after backup.

Acceptance criteria:

- One comparison tool matches each comparison intent; overlapping comparison calls fail the routing evaluation.
- The combined search is used only for a request asking for both vehicle options and financing.
- Dealer promotion listing and financing search have explicit separate responsibilities.
- New finance columns are nullable and source-backed; missing values remain NULL.
- No generic finance calculator, CAT, credit eligibility, or leasing assumptions are added.
- Every buyer-facing finance result includes the Ford source URL and available structured plan fields.

Results: Migration 019 applied after the verified app-database backup `backups/ford-20261009T071553.438Z.dump`; 727/727 Ford Credit plans now expose four structured finance inputs, with unknown source values left NULL. Focused MCP/read/evaluation tests passed (42); full unit suite passed (251); TypeScript build and evaluator syntax checks passed. Qwen 3.5 comparison routing eval passed 3/3 for trim, model-year, and competitor-page intents; all selected the distinct expected tool, and the competitor response included its exact Ford visual comparison URL. Increased evaluator output budget from 320 to 512 tokens after the first run cut off two answers; rerun completed all three answers.

The deterministic MCP harness was updated for the current tool schemas, source fields, and explicit financing-only filter. Final run: all 100 flows passed across vehicle search, exact vehicle lookup, financing search, promotion listing, and catalog status (500 MCP calls total). The harness no longer calls the diagnostic provenance tool for normal citations or incorrectly tries ID-based vehicle comparison; comparison routing is measured in the dedicated local-LLM scenarios.

Semantic retrieval benchmark on the live catalog: 1,026 ready BGE-M3 vectors; hit@5 1.00, precision@5 0.28, recall@5 0.933, MRR 0.533, nDCG 0.616, answer fact coverage 0.767 across 10 reviewed cases. Current blend and RRF tied on the three ranking-comparison cases; retain the blend and BGE-M3 pending a larger reviewed query set.

Evaluation limit: the 100-flow harness verifies deterministic tool responses and disclosures, while the local-LLM tool-routing check covers three comparison intents. Ranking blend versus RRF has only three direct comparison cases; expand the reviewed query set before treating that ranking choice as settled.

- Pending focused tests, migration, and MCP live-output checks.

## Cross-layer assistant reliability repair (2026-10-11)

Goal: make exact 2025-2027 model/trim questions resolve from source-backed MCP facts, prevent malformed model output from becoming a confusing silent fallback, and retain useful context across follow-ups.

Acceptance criteria:

- `get_vehicle` can request one exact trim and returns only that trim's source-backed facts, exact price if present, and official model/technical/comparison links.
- A missing trim or missing trim fact is explicit; no combined model-level value is presented as a trim fact.
- Greeting requests receive a short deterministic response without an LLM call; ordinary catalog questions keep a catalog tool route.
- Invalid/blank model output is classified safely and logged with provider, attempt, and failure category; no raw prompt or credentials are logged.
- Follow-up regression proves recent vehicle/year context remains available; no conversation rows are reset or deleted.
- Focused MCP and Ford-service tests pass; live read-only MCP replay confirms exact Ranger trim facts and links.

Plan:

- [x] Add failing MCP read-service and tool-contract tests for exact variant lookup.
- [x] Implement exact variant lookup from `ford.variants`, variant-scoped specifications/features, and Comparativo provenance.
- [x] Return structured available-year options and direct page links when an exact model-year lookup has no row.
- [x] Correct the deterministic flow evaluator so out-of-budget alternatives are not described as the requested model and unmatched-year offers are not quoted as current.
- [x] Add failing Ford-service tests for malformed structured responses, deterministic greeting, relevant follow-up context, and catalog-wide discovery routing.
- [x] Implement bounded, safe response handling and routing changes with non-sensitive diagnostics.
- [x] Run focused/full unit tests and project builds; record the stale local DB and deployment verification gap.
- [x] Run a read-only exact-trim replay against a restored test DB with migrations 012-021 applied.
- [ ] Deploy the test branch only after the user explicitly says production testing is ready.

Results: Fixed two root causes in `ford-service`: afternoon greetings were sent through the model and malformed structured output caused a generic fallback; now greetings use a short deterministic response and malformed model output gets an honest retry message. Follow-up “La última 2027” now routes with the existing vehicle/year memory. “¿Qué modelos manejas?” now routes to vehicle discovery; promotion/finance intent keeps higher priority. Multi-field follow-up questions remain allowed only when they refer to one detail. Added an exact `get_vehicle(trim=...)` MCP path that returns variant-scoped facts and its source URL; unknown trims return no price/specs and include known trim/comparison links. No conversation rows were reset or deleted.

Verification: MCP and server tests passed (316 tests) and `npm run build` passed. New helper tests and targeted MCP handler tests pass; Ford-service focused reliability suite passed. A restored backup was loaded into a new disposable `ford_eval_20261011` database; only this isolated DB received migrations 020-021, then it was removed. The 100-flow deterministic eval passed all 500 MCP calls across search, exact lookup, finance offers, promotions, and catalog status. The initial run exposed evaluator issues; after fixing them, no tool or answer checks failed. Exact lookups returned Lobo 2026 Lariat and Expedition 2027 King Ranch Max with their matching trim facts and Comparativo links. Trim comparison returned Territory Trend/Titanium differences, year comparison returned Expedition 2025-2027 with no missing years, and competitor comparison returned Expedition King Ranch Max vs Chevrolet Tahoe with its Ford source link. The catalog has five Lobo 2026 trims: King Ranch, Lariat, Platinum, Platinum Plus Híbrida, and Tremor High.

Environment gap: the developer's original local `ford` DB remains untouched and stale. The new MCP image was subsequently deployed to emme-2 as `ghcr.io/migangdelzar/ford-mcp:mcp-929bca6-wt3-20261011` (digest `sha256:45a7f01fb88cb1ebf8c5b14a8d6570f2b85eb251aa82290cac3670716184bf65`). Public initialize, tools/list, and semantic-search smoke checks passed. Read-only live calls confirmed exact Lobo 2026 Lariat with 19 specifications and source links, correct missing-year status for Territory Híbrida 2026, Territory Trend/Titanium trim comparison, Expedition 2025-2027 year comparison, and Expedition King Ranch Max vs Tahoe with its Comparativo link. Existing emme-2 catalog schema and records were preserved; no dump restore or schema import ran. emme-1 Ford-service was not redeployed, so its independent tool allowlist/runtime behavior and an authenticated 3925 chat replay remain to verify. Sanitized earlier server logs identify the `Lobo 202` failure as an accepted 16-character truncated model response after successful MCP results, with a separate false Lariat attribution from assistant history.

## Live conversation reliability follow-up (2026-10-11)

- [x] Reject replies truncated inside a model year (for example, `Ford Lobo 202`).
- [x] Reject claims that the customer mentioned/selected a trim when only the assistant introduced it.
- [x] Route elliptical comparison, financing, and model-year follow-ups using known vehicle context.
- [x] Fail closed when classification has no evidence/tool family; do not expose every MCP read tool.
- [x] Add up to three clean official Ford Uruapan source links to answers when MCP results contain them.
- [x] Run full Ford-service and MCP unit suites and builds.
- [ ] Replay the complete synthetic flow through an authenticated test endpoint; MCP is deployed, Ford-service is unchanged.
- [ ] Verify the observed 3925 conversation against a current-schema MCP test DB and inspect its bounded log trace.

Results: the 3925 thread confirms the customer mentioned Ford Lobo but not Lariat; the assistant later attributed Lariat to the customer. Sanitized server logs show the catalog tools returned, then the model produced a 16-character answer that the old quality check accepted. Another no-evidence classification exposed all nine read-only tools. Added response guards for partial model years and falsely attributed trims, contextual routes for comparison/finance/year follow-ups, and fail-closed tool selection when classification has no evidence/family. Tool-returned links now reach customers even when the model omits them; only clean HTTPS Ford Uruapan page URLs are included, with query strings and image assets rejected. The catalog snapshot contains Ford Lobo 2026, five trims (King Ranch, Lariat, Platinum, Platinum Plus Híbrida, Tremor High), and direct model/spec-sheet URLs; it contains no Comparativo route for Lobo, so no competitor-comparison URL should be fabricated. Ford-service full suite passed: 572 tests, 0 failures/errors/skips. MCP unit suite passed: 265 tests; TypeScript build passed. `git diff --check` passed. Authenticated operator API returned HTTP 401; sanitized logs were read through the deployment channel without message text. No deployment, commit, or push was performed.

## Wire comparison tools through Ford-service (2026-10-11)

- [x] Expose trim, model-year, and official competitor comparison tools to catalog decisions.
- [x] Enable current comparison/page-link tools in MCP defaults and environment examples.
- [x] Add tool-specific routing guidance to the active Ford prompt.
- [x] Reject new MCP tool names in customer-facing responses.
- [x] Rerun MCP tests, Ford-service tests, and package build.

Results: comparison requests could not reach `compare_trims`, `compare_model_years`, or `get_variant_comparisons` because Ford-service's MCP tool list and `DecisionPolicy` only allowed the older catalog tools. Added those tools plus `get_page_links` to the read-only configuration and vehicle decision family, documented when to use each in the prompt, and included them in internal-tool response detection and failure diagnostics. The new regression tests failed before the fix and pass after it. MCP unit/server tests: 316 passed; Ford-service tests: 574 passed, 0 failures/errors/skips; `bootJar` and MCP TypeScript build passed. Production remains unchanged under the earlier test-only instruction; emme-2 still needs the newer MCP image before these new tool names become available there. Authenticated 3925 replay remains blocked by the chat API's HTTP 401.

## Remove Comparativo selector values from stored URLs (2026-10-09)

- [x] Normalize `exterior`/`interior` out of Comparativo route identity URLs.
- [x] Normalize selector query values in extracted link hrefs and MCP citations.
- [x] Add migration to clean existing page and link URL columns after collision checks.
- [x] Back up DB, apply migrations, and verify no DB text/JSONB columns retain these selectors.
- [x] Rebuild/restart local MCP and verify clean links from live tools.

Results: backup `backups/ford-20261009T101630.207Z.dump`; migrations 020 and 021 applied. DB audit found zero selector URLs across Ford text/JSONB columns. MCP lookup, model-year comparison, and competitor comparison returned clean Comparativo routes. Focused tests passed (59); TypeScript build passed.
