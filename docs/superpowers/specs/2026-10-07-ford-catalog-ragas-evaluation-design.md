# Ford Uruapan Catalog QA RAGAS Evaluation Design

## Goal

Evaluate whether a local Ollama model can answer realistic Spanish customer questions through the Ford Uruapan MCP using current catalog and offer data. Coverage must include every model-year currently represented by the synchronized Ford Uruapan catalog and at least 100 questions. Questions are synthetic customer-style examples, not transcripts from actual customers.

## Current baseline

The local database currently contains 30 normalized model names across 38 model years. It includes 2025, 2026, and 2027 records; the evaluation must cover the catalog inventory it reads, without silently limiting questions to the current model year. A coverage report will show every model-year and fail when any catalog entry has no associated question.

Ollama is reachable at `http://127.0.0.1:11434`. Installed completion-capable models include `qwen2.5:3b`, `llama3.1:8b`, and `gemma4:e4b`; `bge-m3:latest` is available for embeddings. Use `qwen2.5:3b` as the initial answer model and `gemma4:e4b` as the independent RAGAS judge. Both remain configurable so the same suite can compare other installed models.

## Ranger horsepower finding

The database contains a later `Motor` specification for Ranger 2026 and 2027 with both the 2.3L gasoline 270 hp and 2.0L diesel 168 hp descriptions. Vehicle lookup orders specifications by insertion ID and MCP compaction exposes only the first three, so the motor specification can be omitted. Exact vehicle lookup now returns every stored specification and feature, with source URL preserved per item, and orders powertrain/capacity facts before lower-priority details so answer models can find common customer facts quickly. It must not conflate gasoline and diesel figures or change source wording. If no year is specified, return every stored model-year for that exact model and validate each option's completeness. Keep the full exact variant name (`Híbrida`, `Raptor`, `Sport`, `Van`, or `Chasis`) through tool selection; a base-model lookup must not silently stand in for a variant. A regression test asserts the full Ranger detail payload and powertrain-first ordering.

## Dataset

Create a versioned vehicle-QA dataset separate from the lead-handoff fixtures. Include at least 100 questions, with coverage requirements:

- At least one direct fact question for each of the 38 model-year entries in the catalog baseline.
- Remaining questions cover discovery and trim matching, engines/power/torque, safety and comfort features, dimensions and capacity, vehicle comparisons, model-year ambiguity, prices, financing, promotions, source requests, and unavailable or underspecified questions.
- Preserve exact model names and variants in each case. Never treat a hybrid, Raptor, commercial body, or trim as interchangeable with a similarly named vehicle.
- Include `id`, natural Spanish `question`, expected MCP tool names, normalized model/year selectors when applicable, grounded `referenceAnswer`, source URL(s), and tags/category.
- Every reference answer must be supported by the Ford Uruapan catalog, offer data, or a source linked from those records. For unavailable facts, the reference requires a clear uncertainty response rather than an inferred answer.
- Include a checked-in coverage manifest for the catalog snapshot. At run time compare the current model-year inventory with the manifest and report new, missing, and untested entries rather than declaring full coverage against a stale snapshot.

## Evaluation runner

Add a dedicated serial QA runner, leaving the lead-handoff runner and its scorer unchanged. For each question it will:

1. Connect to the configured local MCP Streamable HTTP endpoint and enumerate tools.
2. Submit the question to the configured Ollama completion model with MCP tool definitions, execute requested tools, and retain tool arguments, results, retrieved context, answer, model, timings, and errors.
3. Append one validated JSONL trace per completed question so interrupted runs retain their completed evidence.
4. Score traces with the existing pinned RAGAS 0.4.3 dependency and local Ollama judge, using `AnswerRelevancy`, `Faithfulness` against retrieved context, and `AnswerCorrectness` against the reference. Use local `bge-m3:latest` embeddings for answer relevancy through Ollama's OpenAI-compatible `/v1` endpoint.
5. Emit an aggregate report with completion rate, per-metric averages, tool routing accuracy, unsupported-claim count, and coverage by model-year, category, and tool.

The runner supports model and question-range selection, and has a dry-run mode that validates dataset shape, MCP reachability, installed Ollama model names, and coverage without generating answers. It will not call hosted model APIs or send questions to a remote application. Secrets are loaded from environment variables and never copied into traces.

## Horsepower behavior

`get_vehicle` must return all specifications and features stored for the selected model-year, rather than slicing the arrays to a small prefix. Each item retains its source URL. The exact Ranger motor wording remains associated with its source; the MCP and QA reference must preserve both gasoline and diesel output figures and identify each engine. Put motor/power/torque and high-value capacity facts first, while retaining every other item. Named-model details must preserve the exact variant; when year is omitted, return and completeness-check every stored year. Broad search and comparison keep their existing concise response limits. The model answers only the requested fact, grounded in the complete data returned by MCP, so the dataset does not define a whitelist of facts it may answer.

## Verification

- Unit tests cover complete spec/feature output, Ranger horsepower visibility, dataset validation, coverage detection, trace validation, and report aggregation.
- A manual local run executes all questions through MCP using Ollama and writes a complete trace/report.
- Run the RAGAS scorer locally with the judge model and inspect the lowest-scoring and failed cases.
- Report catalog coverage explicitly; a successful run is not described as “all Ford models” if the current catalog inventory contains model-years absent from the dataset or MCP results.

## Scope boundaries

- This suite tests Ford Uruapan catalog-provider behavior, not specialist handoff behavior or emme-1 connectivity.
- It does not claim the sample questions came from actual customers.
- It does not invent missing prices, specs, stock, availability, or offer terms.
- Remote deployment and changes to Spring AI or another consuming application are out of scope.
