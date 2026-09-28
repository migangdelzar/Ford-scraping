# Multistep Lead and Advisor Handoff Evaluation Implementation Plan

**Status:** Tasks 1–6 complete, with post-batch policy, trace, and prompt fixes applied. See `.superpowers/sdd/task-7-report.md` for the follow-up findings and verification.

**Goal:** Evaluate ten scripted, multi-turn lead conversations using serial local inference, a harness-only handoff simulation, deterministic policy checks, saved JSONL traces, and local Ragas goal scoring.

**Architecture:** The Node runner preserves full conversation histories and calls the existing read-only MCP tools. It adds `handoff_to_specialist` only to the Ollama tool list and intercepts it locally. Each flow is scored deterministically and appended to a validated JSONL trace before the next flow starts. The Python scorer consumes those traces separately; deterministic policy checks remain the hard gate.

**Constraints:** Use synthetic fixture data; process one flow/model request at a time; never register a production handoff tool or contact an advisor, CRM, or customer; do not claim real-world transfer from a simulated result; keep deterministic and Ragas results distinct. This workspace has no Git metadata.

## File map

- `evals/multistep-leads/flows.json` — ten versioned scripted scenarios.
- `scripts/mcp-lead-flow-fixtures.ts` — fixture loading, validation, and range selection.
- `scripts/mcp-lead-handoff-scoring.ts` — deterministic handoff, consent, payload, grounding, and truthfulness rules.
- `scripts/mcp-lead-handoff-tool.ts` — strict-schema harness mock and simulated result.
- `scripts/evaluate-mcp-multistep-leads.mjs` — serial MCP/Ollama runner and per-flow trace integration.
- `scripts/mcp-lead-traces.ts` — trace contract validation and JSONL append.
- `tests/unit/mcp-lead-flow-fixtures.test.ts`, `tests/unit/mcp-lead-handoff-scoring.test.ts`, `tests/unit/mcp-lead-handoff-tool.test.ts`, `tests/unit/mcp-lead-traces.test.ts` — focused coverage.
- `evals/multistep-leads/ragas/` — pinned isolated Python scorer and its standard-library tests.
- `.gitignore` — excludes generated evaluation results and the Python virtual environment.

## Completed implementation

### Task 1: Define the ten shared scripted cases — complete

The version 1 fixture contains ten unique Spanish conversations, expected handoff/consent behavior, resolution-attempt limits, and expected payload fields. The loader validates the fixture shape and supports selecting a bounded ordered range. Scenarios use synthetic details only and contain no customer contact data.

### Task 2: Add deterministic handoff policy scoring — complete

`scoreLeadHandoff` checks expected handoff behavior, consent order, declines, uncertainty-resolution attempts, payload presence and grounding, completion claims, and identity claims. Stable failures include `missed_required_handoff`, `unexpected_handoff`, `consent_not_requested`, `handoff_without_consent`, `handoff_after_decline`, `too_many_resolution_attempts`, `missing_handoff_context`, `invented_handoff_context`, `false_handoff_success_claim`, and `identity_misrepresentation`.

The scorer uses event ordering and only evidence available before the handoff request. Mock arguments reject null optional values and unknown keys. Its lexical grounding checks are deterministic approximations: they can miss implied fabrications or flag valid paraphrases.

### Task 3: Build the serial evaluator and local mock — complete

`npm run eval:mcp:leads -- --start=<index> --flows=<count>` runs selected flows in order; defaults use `qwen2.5:3b` and the local Ollama chat endpoint. It preserves prior user, assistant, and tool messages; executes MCP and mock results serially; records event indices, observations, token counts, and elapsed time. `handoff_to_specialist` is added to the model's tool list only by the harness, and the runner fails if the production MCP lists that name.

One-flow smoke runs have passed after the prompt and fixture were adjusted to preserve required known context. A 3B model remains variable. Historical diagnostics showed it can infer an unmentioned vehicle category or omit required payload context; a passing run is evidence for that run, not a model consistency guarantee.

### Task 4: Save structured traces and apply hard-gate scoring — complete

`scripts/mcp-lead-traces.ts` exports `createLeadFlowTrace`, `validateLeadFlowTrace`, `appendLeadFlowTrace`, and a fixture-reference builder. Each row contains `flowId`, `fixtureVersion`, `model`, `messages`, `turns`, `mcpCalls`, `handoffCalls`, `deterministicScore`, `ragasInput`, `complete`, `errors`, `elapsedMs`, `promptTokens`, and `generatedTokens`. Validation checks transcript/turn alignment, expected references, score consistency, partial-run failures, and nonnegative measurements. The append helper creates parent directories and adds one JSON line per flow.

The runner writes to `eval-results/multistep-leads/<UTC timestamp>.jsonl` after each flow, including completed flows that fail policy scoring and partial flows that stop before an assistant answer. Incomplete flows are marked failed with `incomplete_flow`; runtime errors use `evaluation_error`; trace validation/write failures use `trace_write_failed`. Expected Ragas tool names describe only the harness handoff action, not observed MCP calls. `.gitignore` excludes `eval-results/` and `evals/multistep-leads/ragas/.venv/`.

**Task 4 verification recorded in `.superpowers/sdd/task-4-report.md`:** focused suites passed (75/75 across three files); build and targeted lint passed; one-flow evaluator exited 0 with one pass, zero failures, four model calls, one MCP call, and one simulated handoff. The report validated a one-row JSONL trace with all required fields. This was a smoke run, not the ten-flow batch or Ragas scoring.

**Post-batch fixes:** The runner now rejects unauthorized handoff calls before returning simulated success, treats a direct affirmative specialist request as authorization, strips invalid optional null/zero filters and schema-shaped hallucinations at the MCP boundary while retaining requested arguments in traces, and explicitly describes simulation-only results. The scorer rejects real connection/callback/scheduling claims even after simulated success and recognizes explicit simulation wording. Incomplete model turns remain in trace rows and are marked incomplete instead of causing a trace-write failure. The evaluator defaults to `gemma4:e4b`, independent from the conversation model, because the initial `qwen2.5:3b` Ragas goal scores were all zero.

## Completed work

### Task 5: Add an isolated local Ragas scorer

**Files:** create `evals/multistep-leads/ragas/requirements.txt`, `score_traces.py`, and `test_score_traces.py`.

- [x] Check official Ragas APIs for multi-turn samples, tool/goal metrics, and local Ollama; pin Ragas 0.4.3, OpenAI 2.14.0, and compatible LangChain dependencies.
- [x] Create the isolated `.venv` and install the pinned requirements.
- [x] Implement trace JSONL parsing and schema validation with clear missing-transcript/reference errors.
- [x] Add standard-library tests for valid traces, malformed rows, missing references, incomplete cases, and dry-run counts.
- [x] Add dry-run validation that does not load a model.
- [x] Implement serial scoring. Preserve per-flow metric errors rather than converting errors into scores.
- [x] Run the scorer on a one-flow trace without hosted API credentials and report the result.

**Expected:** machine-readable per-flow metric values, evaluator model, and explicit metric errors; scorer output remains separate from deterministic pass/fail.

### Task 6: Wire commands, run ten flows, and document interpretation

**Files:** modify `package.json`; create `docs/mcp-multistep-lead-evals.md`.

- [x] Add `eval:mcp:leads:ragas` while retaining `eval:mcp:leads`.
- [x] Document prerequisites, Ollama configuration, run commands, trace paths, score interpretation, and simulation limits.
- [x] Run all ten conversations serially and retain the JSONL artifact.
- [x] Run Ragas serially on that artifact.
- [x] Review every deterministic failure and scorer error. The four failures reflect model behavior already covered by the prompt and hard gates; no code defect was identified that justified weakening a rule. Preserve and report them.
- [x] Report pass/fail counts, model calls, runtime, policy failures, and Ragas results separately.

**Expected:** a reproducible ten-flow diagnostic run with trace path and distinct deterministic/Ragas summaries. This is a small diagnostic batch, not a statistical release benchmark.

## Completion record

Tasks 1–6 are complete. The first full batch after fixes produced nine deterministic passes and one incomplete flow (`unavailable-offer-validity`); the incomplete row is now retained by the trace contract. This remaining failure reflects local model variability, not a waived policy gate. The local goal metric returned 0.0 for every flow under the initial evaluator model, so it remains diagnostic rather than authoritative. See `.superpowers/sdd/task-1-report.md` through `task-7-report.md` for implementation and verification evidence. No Git metadata exists in the workspace.
