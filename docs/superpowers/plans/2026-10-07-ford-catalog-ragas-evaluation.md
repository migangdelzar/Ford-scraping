# Ford Uruapan Catalog QA RAGAS Implementation Plan

> **For agentic workers:** Implement inline in the approved shared workspace. Follow each task in order using TDD.

**Goal:** Return complete stored vehicle details from named-model lookup and evaluate 100+ Spanish customer-style questions against every Ford Uruapan catalog model-year using local MCP, Ollama, and RAGAS.

**Architecture:** Keep MCP's broad search and comparison summaries concise, but make `get_vehicle` exhaustive for an exact model-year. Store versioned reference questions in the QA eval folder, run them serially through the already running/local Streamable HTTP MCP and a configurable Ollama model, append per-question JSONL traces, then score those traces with the repository's pinned RAGAS environment and a local judge model.

**Tech Stack:** TypeScript/Vitest, Node 22 `fetch`, MCP JSON-RPC Streamable HTTP, Ollama `/api/chat`, Python 3.9+ in the existing RAGAS virtual environment, RAGAS 0.4.3, and PostgreSQL catalog queries used only to create/check the source snapshot.

## Global Constraints

- Cover every model-year read from the current Ford Uruapan catalog; baseline is 30 model names and 38 model-years.
- Provide at least 100 synthetic Spanish customer-style questions; do not represent them as actual customer transcripts.
- Use `qwen2.5:3b` as the initial answer model and `gemma4:e4b` as the default RAGAS judge; allow installed completion models to be selected by environment/configuration.
- Keep all generation and judging local through Ollama at `http://127.0.0.1:11434`; never call hosted model APIs.
- Exact model detail lookup returns every stored specification and feature with source URLs. Comparison and broad-search responses keep existing limits.
- Preserve existing MCP tools, handoff evals, and user changes. Do not commit unrelated modified files.

---

## Files and responsibilities

- Modify `src/mcp/server.ts`: stop truncating specs/features for `get_vehicle` while preserving compact behavior for search and comparison.
- Modify `tests/mcp/server.test.ts`: assert exact vehicle lookup returns all details, including later Ranger motor/power details and all model-year options.
- Create `evals/catalog-qa/questions.jsonl`: versioned 100+ question/reference rows with source and expected tool metadata.
- Create `evals/catalog-qa/catalog-inventory.json`: baseline model-year inventory with exact stored specification/feature counts for completeness checks.
- Create `scripts/catalog-qa-evaluation.ts`: load/validate fixture rows, calculate catalog/model-year coverage, append traces, summarize model answers and tool use.
- Create `scripts/evaluate-mcp-catalog-qa.mjs`: connect to local Streamable HTTP MCP, call local Ollama chat with MCP-listed tools, execute tool calls, and record full results.
- Create `evals/catalog-qa/ragas/score_traces.py`: validate answer traces and score faithfulness, answer correctness, and answer relevance where supported with local Ollama.
- Create `evals/catalog-qa/ragas/test_score_traces.py`: tests for malformed/incomplete traces, deterministic scoring, summaries, and dry-run behavior.
- Modify `package.json`: add QA generation/run/scoring commands without changing existing eval commands.
- Modify `README.md` and create `docs/mcp-catalog-qa-evals.md`: setup, model configuration, commands, coverage meanings, and limitations.

## Task 1: Return all exact vehicle details

**Files:** `tests/mcp/server.test.ts`, `src/mcp/server.ts`

- [x] Add a failing test where a model-year has more than three specifications and features; call `get_vehicle({model: "RANGER", year: 2027})`; assert every input detail and source URL appears in the result, `specificationsOmitted` and `featuresOmitted` are zero, and `Motor` includes 270 hp gasoline and 168 hp diesel ratings.
- [x] Run `npm test -- --run tests/mcp/server.test.ts -t "returns all vehicle details"`; confirmed the failure was caused by omitted array items.
- [x] Change only exact `get_vehicle` compaction calls to include all details. Leave `compactVehicleResults` and `compactComparisonResults` limits unchanged. Make omitted counts zero when complete detail is returned.
- [x] Rerun the focused test, then `npm test -- --run tests/mcp/server.test.ts`; 31 tests passed.

## Task 2: Add and validate catalog-wide customer questions

**Files:** `evals/catalog-qa/questions.jsonl`, `scripts/catalog-qa-evaluation.ts`, `tests/unit/catalog-qa-evaluation.test.ts`

- [x] Add failing tests that load fixture rows and reject duplicate IDs, missing question/reference/source fields, fewer than 100 questions, unsupported MCP tool names, any baseline model-year with no question, and any detail lookup trace whose returned array lengths differ from the catalog counts.
- [x] Run `npm test -- --run tests/unit/catalog-qa-evaluation.test.ts`; confirm it fails because the fixture loader/validator is absent.
- [x] Add typed question records with fields `id`, `question`, `category`, `model`, `year`, `expectedTools`, `referenceAnswer`, and nonempty `sourceUrls`. Use a 38-row baseline manifest for every model-year and include its stored `specificationCount` and `featureCount`. Ensure at least one direct factual question for every pair and at least 62 further questions covering trim matching, common and less-obvious specs/features, engine/power/torque, safety, capacity, price, comparison, financing, promotions, provenance, ambiguity, and unavailable facts.
- [x] Write test rows with distinct phrasing and accurate references grounded in stored Ford Uruapan page/spec/offer data. Assert Ranger horsepower questions identify gasoline and diesel engines separately.
- [x] Implement JSONL parsing, schema validation, unique-ID checks, per-model-year/category/tool coverage summaries, detail-count completeness checks, and inventory-vs-fixture drift reporting. New or removed model-years must be reported and prevent a false full-coverage status.
- [x] Rerun `npm test -- --run tests/unit/catalog-qa-evaluation.test.ts`; all dataset contract tests pass.

## Task 3: Run questions through local MCP and Ollama

**Files:** `tests/unit/catalog-qa-runner.test.ts`, `scripts/catalog-qa-evaluation.ts`, `scripts/evaluate-mcp-catalog-qa.mjs`

- [x] Add failing tests for MCP envelope parsing, Ollama tool-call argument parsing, range selection, and tool routing metrics. Live run exercises sequential tool calls, missing responses, model/tool behavior, and JSONL traces.
- [x] Run `npm test -- --run tests/unit/catalog-qa-runner.test.ts`; the initial missing routing metric test failed before implementation.
- [x] Implement HTTP JSON-RPC initialize/tools-list/tools-call using local MCP endpoint and bearer auth.
- [x] Implement Ollama `/api/chat` tool definitions directly from `tools/list`; execute calls serially with a bounded loop; append tool results; record tool errors.
- [x] Store a per-question JSONL trace with returned contexts, answer, references, complete detail checks, elapsed time, completion, routing, and safe errors. Auth headers/tokens are excluded.
- [x] Implement `--start`, `--limit`, `--model`, and `--dry-run`; dry-run checks MCP, Ollama, fixture, and catalog coverage.
- [x] Rerun focused runner/evaluation tests; 17 TypeScript helper tests pass.

## Task 4: Score answer traces locally with RAGAS

**Files:** `evals/catalog-qa/ragas/score_traces.py`, `evals/catalog-qa/ragas/test_score_traces.py`, `package.json`

- [x] Add tests for schema validation, no-context faithfulness skips, reference correctness inputs, aggregate metrics, and incomplete trace reporting.
- [x] Run the scorer tests; all 6 tests pass.
- [x] Reuse RAGAS 0.4.3 with Ollama `/v1`, local Gemma judge, and local `bge-m3:latest` embeddings for correctness and relevance. No hosted API is configured.
- [x] Continue scoring after individual metric failures; preserve incomplete rows and emit aggregates by model, model-year, category, and tool.
- [x] Add `eval:mcp:catalog-qa` and `eval:mcp:catalog-qa:ragas`; existing eval commands remain.
- [x] Rerun the focused Python scorer tests and TypeScript eval tests.

## Task 5: Run and inspect the full local evaluation

**Files:** `docs/mcp-catalog-qa-evals.md`, `README.md`

- [x] Document environment variables and exact setup/run/score commands, including dry-run, full run, and scoring.
- [x] Run focused unit tests, lint, and build before connecting to the live local MCP. New QA source/test files pass focused lint; repository-wide lint also reports existing modified source files.
- [x] Run dry-run: MCP auth/reachability, 8 tools, Ollama answer/judge/embedding models, 191 questions and all 38 model-years are available with no catalog/count drift.
- [ ] Run all questions serially against local MCP with local Ollama; inspect trace completeness, exact spec/feature counts for every model-year, and model-year coverage.
- [ ] Run the RAGAS scorer with local Ollama; inspect lowest-scoring traces, every failed tool call, every missing catalog entry, and Ranger horsepower responses.
- [ ] Run the full unit test suite, lint, build, and `git diff --check`; report actual counts, metric coverage, incomplete rows, and any upstream data coverage gaps.

## Completion criteria

- `get_vehicle` returns all database specs/features for a selected model-year and source URLs without truncation.
- Dataset has at least 100 distinct customer-style Spanish questions, covers every baseline model-year, and identifies inventory drift.
- Full local run makes one complete trace per question or explicitly records failure for that question.
- RAGAS scoring uses local Ollama only and reports per-question and aggregate results without silently dropping incomplete rows.
- Ranger output preserves 270 hp gasoline and 168 hp diesel engine details with the Ford Uruapan source.
- Existing lead-handoff evaluations and behavior remain intact.
