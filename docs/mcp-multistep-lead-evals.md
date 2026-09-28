# Multistep lead handoff evaluation

The lead evaluation replays ten synthetic, scripted customer conversations against the local MCP server and Ollama. It runs serially. The `handoff_to_specialist` action is a harness-only simulation: it does not contact an advisor, create a CRM lead, or schedule an appointment.

## Prerequisites

- Node.js 22 or newer and the project dependencies installed.
- Ollama running locally with the conversation model and evaluator model available. Defaults are `qwen2.5:3b` and `gemma4:e4b`, respectively.
- Python 3.9 or newer and `uv` for setting up the isolated Ragas environment.

Start Ollama and fetch the default model if needed:

```sh
ollama serve
ollama pull qwen2.5:3b
ollama pull gemma4:e4b
```

Set `OLLAMA_MODEL` to use another model. The conversation runner defaults to `http://127.0.0.1:11434/api/chat`; override it with `OLLAMA_CHAT_URL`.

## Run scripted conversations

Run all ten flows serially:

```sh
npm run eval:mcp:leads
```

Select a range with zero-based `--start` and positive `--flows` options:

```sh
npm run eval:mcp:leads -- --start=0 --flows=1
```

The command prints a terminal summary and writes one JSONL row after each flow to `eval-results/multistep-leads/<UTC timestamp>.jsonl`. A completed but policy-failing flow is retained. Incomplete runs and runtime errors receive explicit failure codes. The trace is ignored by Git because it can contain complete conversation transcripts; current fixture content is synthetic.

## Set up and run Ragas scoring

Create the ignored local virtual environment and install the pinned requirements:

```sh
uv venv --python 3.13 evals/multistep-leads/ragas/.venv
uv pip install --python evals/multistep-leads/ragas/.venv/bin/python \
  --requirements evals/multistep-leads/ragas/requirements.txt
```

Validate a trace without loading Ragas or contacting Ollama:

```sh
npm run eval:mcp:leads:ragas -- --dry-run eval-results/multistep-leads/<trace>.jsonl
```

Score goal completion using the local Ollama OpenAI-compatible endpoint:

```sh
npm run eval:mcp:leads:ragas -- eval-results/multistep-leads/<trace>.jsonl
```

The evaluator defaults independently to `gemma4:e4b` and `http://127.0.0.1:11434/v1`. Set `RAGAS_OLLAMA_MODEL` or `RAGAS_OLLAMA_BASE_URL` to override those defaults; the conversation model setting does not change the evaluator. Scoring is serial. Per-flow metric errors are preserved and do not prevent attempts on later complete flows.

## Read the results

- `deterministicScore` is the hard gate for handoff triggers, consent, declines, payload grounding, and success-claim timing. A Ragas result never overrides it.
- `handoffToolPrecisionRecall` compares expected and observed harness handoff action names only. It reports precision, recall, and F1. It excludes MCP calls because fixture references intentionally do not define expected MCP tool sequences or exact payload arguments.
- `agentGoalAccuracyWithReference` is the Ragas `AgentGoalAccuracyWithReference` score over the multi-turn transcript and scenario reference. It is a diagnostic local-model judgment.
- Incomplete traces retain the name-based handoff counts, but skip goal scoring and report `incomplete_trace`.
- An error is not a numeric score. Review `errors` and the deterministic failure list alongside metric values.

The trace stores all assistant wording, including wording after a simulated success. The harness performs no real contact action; the runner prompt requires the assistant to state that the simulation contacted no one. Review deterministic `false_handoff_success_claim` failures for any real connection, callback, or scheduling promise.

## First ten-flow diagnostic result

The first serial batch is stored at `eval-results/multistep-leads/2026-09-28T02-54-36-440Z.jsonl`. It exposed consent-order violations, unsupported follow-up promises after the local simulation, weak payload grounding, and null/zero optional filters. The runner now enforces authorization before returning simulated success, removes invalid optional nulls, unsupported zero price filters, and schema-shaped argument hallucinations at the MCP boundary while retaining requested values in traces. It also states explicitly that the handoff is only a local simulation. A later full run passed nine flows and retained `unavailable-offer-validity` as incomplete when the local model stopped before answering. Ragas uses `gemma4:e4b` by default because the earlier `qwen2.5:3b` evaluator returned 0.0 for every flow, including known passes. See `.superpowers/sdd/task-7-report.md` for detailed verification.

Ragas API choices follow the official [multi-turn sample documentation](https://docs.ragas.io/en/stable/concepts/components/eval_sample/), [agent metrics documentation](https://docs.ragas.io/en/v0.4.1/concepts/metrics/available_metrics/agents/), and [Ollama-compatible LLM adapter guidance](https://docs.ragas.io/en/stable/howtos/llm-adapters/). Ten flows form a small diagnostic batch, not a statistical benchmark.
