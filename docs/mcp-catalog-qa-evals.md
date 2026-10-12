# Ford Catalog QA evaluations

This evaluation checks whether the local Ford MCP can answer customer questions from the complete stored catalog, including details that were not preselected as FAQs. The dataset has 198 synthetic Spanish customer-style questions across all 39 model-years in the local catalog snapshot. They are authored evaluation cases, not real customer transcripts. Territory 2026 is included as an explicit missing-detail case because the local catalog currently has no specs or equipment for it.

For a named model and year, `get_vehicle` returns every stored specification and feature with source URLs. The model sees those records and answers the particular question. The evaluator separately checks that no stored details were truncated. Broad vehicle searches and comparisons retain their concise result limits.

## Requirements

- Node 22+, npm dependencies installed.
- Local PostgreSQL catalog running and `DATABASE_URL` set in `.env`.
- Local MCP HTTP server at `http://127.0.0.1:3001/mcp` and its bearer token set as `MCP_HTTP_BEARER_TOKEN` when enabled.
- Ollama at `http://127.0.0.1:11434` with `qwen3.5:4b` pulled locally.
- Existing RAGAS virtual environment at `evals/multistep-leads/ragas/.venv`.

## Commands

```bash
npm run build
npm test -- --run tests/mcp/server.test.ts tests/unit/catalog-qa-evaluation.test.ts tests/unit/catalog-qa-runner.test.ts
npm run eval:mcp:catalog-qa -- --dry-run
npm run eval:mcp:catalog-qa
npm run eval:mcp:catalog-qa:ragas -- eval-results/catalog-qa/<trace-file>.jsonl --dry-run
npm run eval:mcp:catalog-qa:ragas -- eval-results/catalog-qa/<trace-file>.jsonl
```

The runner is local-only and refuses non-loopback MCP/Ollama hosts. It compares the database inventory and each model-year's spec/feature counts with `catalog-inventory.json` before generating answers. Dataset drift stops the run so the new or changed model-year can be reviewed and covered first.

Use `--start N --limit N` for a zero-based slice, or `--model qwen3.5:4b` to select another locally installed answer model. `MCP_QA_MODEL` sets the default answer model. `OLLAMA_BASE_URL` and `MCP_QA_URL` can change local ports while remaining on loopback. This MCP QA evaluation uses Qwen3.5 for answer generation and deterministic routing/detail checks; it does not require a separate LLM judge. RAGAS is an optional, separate evaluator and is not part of the Qwen3.5 run.

Each completed or failed question is appended to `eval-results/catalog-qa/<timestamp>-<model>.jsonl`. Traces contain question/reference/source, selected MCP tools, returned contexts, final answer, exact detail-count checks, duration, and safe errors. They do not contain authorization headers or tokens. RAGAS writes a sibling `.ragas.json` report with per-question faithfulness, answer correctness, answer relevance, and aggregate scores. Missing answers/contexts are marked skipped and remain counted as incomplete; they are not silently removed from the report.

## How to read results

- Tool routing precision/recall/exactness checks whether the expected information source was called. A correct answer from the wrong tool still flags routing.
- `detailCompleteness.complete` is deterministic and true only when all DB specs/features reached the trace without omissions.
- RAGAS answer correctness compares the answer with the authored reference; faithfulness compares claims with actual MCP result context; answer relevance checks the answer against the customer question.
- RAGAS is a model-based signal, not a source of truth. Review low scores and the saved context. Catalog gaps remain data-ingestion problems even when an answer is phrased confidently.

The inventory manifest is a dated baseline, not a statement that every real-world Ford trim or physical vehicle is stocked. A model-year question without a year has not been confused with physical inventory availability.

## Semantic retrieval benchmark

This separate benchmark checks whether paraphrased Spanish questions retrieve labeled vector documents. It embeds queries with the configured local Ollama embedding model (currently BGE-M3), searches local pgvector, and reports Hit@5, Precision@5, Recall@5, MRR, nDCG@5, and literal expected-fact coverage in the retrieved text. The authored gold set is in `evals/semantic-retrieval/cases.jsonl`.

```bash
npm run eval:semantic-retrieval
```

It is local-only: both `DATABASE_URL` and `EMBEDDING_API_URL` must resolve to loopback. The evaluator issues read-only SQL against Postgres and writes its report to `eval-results/semantic-retrieval/`. It does not run an answer model or an LLM judge, and literal fact coverage is not a measure of generated-answer correctness. Vehicle queries are restricted to non-offer documents; the report also counts how many offer documents would have appeared in the top five without that scope filter. Review the ranked documents and their source content alongside aggregate metrics, especially where similar source records conflict.
