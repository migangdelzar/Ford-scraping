# Multistep Lead and Advisor Handoff Evaluation Design

Date: 2026-09-27

Status: Implemented through the first ten-flow diagnostic batch and local Ragas scoring (Tasks 1–6), with follow-up policy and trace fixes recorded in `.superpowers/sdd/task-7-report.md`.

## Goal

Evaluate realistic, multi-turn Ford Uruapan lead conversations, including whether the assistant offers or initiates a specialist handoff, respects consent, and passes relevant context. Begin with ten synthetic scripted conversations, executed serially to fit local inference resources.

## Customer-facing behavior

- An explicit request to speak with a specialist authorizes a handoff; do not ask for the same permission again.
- For clear buying intent, appointment/test-drive interest, or unresolved/missing/conflicting MCP data, first ask whether the customer wants specialist help. Proceed only after an affirmative answer.
- For uncertain MCP data, make one reasonable attempt to clarify or resolve it with available data before offering a handoff.
- Pass relevant context already collected (vehicle, needs, and unresolved question). Do not require name or contact details for every handoff. Ask for contact details only when a real callback action requires them.
- Respect a declined offer and do not hand off.
- Use natural customer-facing language to offer or connect the customer with a Ford specialist. Do not proactively label the assistant as a bot, claim to be human, or claim a transfer completed unless the action succeeded. Answer truthfully if directly asked about identity.

## Evaluation architecture

```text
10 scripted conversations, run serially
             |
             v
 Existing Node/Ollama runner <---- production MCP tools (read-only)
             |
             +---- harness-only handoff_to_specialist mock
             |
             v
      JSONL conversation traces
          |                 |
          v                 v
 deterministic checks    Python Ragas scorer
                         using local Ollama
```

The production MCP server remains read-only and does not expose a transfer tool. The Node runner adds `handoff_to_specialist` to the model's available tools and intercepts its calls locally. The mock validates a strict schema and consent authorization, records arguments and event ordering, then returns a simulated success or failure. The runner rejects handoff attempts without explicit authorization. It does not contact an advisor, create a CRM lead, or schedule an appointment. Assistant wording after mock success must state that only a local simulation was recorded and no one was contacted.

The runner preserves all prior user, assistant, and tool turns. Calls and results are processed serially and attached to the conversation. It records transcripts, tool calls/results, simulated handoff payloads/results, model usage, and expected outcomes as local JSONL traces under `eval-results/multistep-leads/<UTC timestamp>.jsonl`. The fixtures contain synthetic details only.

The trace contract in `scripts/mcp-lead-traces.ts` includes `flowId`, `fixtureVersion`, `model`, `messages`, turn-aligned answers, `mcpCalls`, `handoffCalls`, `deterministicScore`, `ragasInput`, `complete`, `errors`, elapsed time, and token counts. Validation rejects malformed transcripts, turn mismatches, invalid or inconsistent scores, missing references, and invalid measurements. Each flow is appended immediately, so completed evidence survives an interrupted later flow. Partial traces cannot be marked passing.

Deterministic checks are authoritative for handoff triggers, consent, decline handling, payload requirements and grounding, and success-claim timing. The separate serial scorer calculates handoff action name precision/recall from fixture references, then uses Ragas `AgentGoalAccuracyWithReference` over Ragas multi-turn messages. The fixture stores expected tool names but no reference argument values, so name-level precision/recall is reported as a transparent harness diagnostic rather than mislabeled as Ragas argument scoring. Production MCP calls are not treated as expected references. Scorer output never overrides deterministic hard gates. See Ragas [multi-turn samples](https://docs.ragas.io/en/stable/concepts/components/eval_sample/), [agent metrics](https://docs.ragas.io/en/v0.4.1/concepts/metrics/available_metrics/agents/), and [Ollama-compatible LLM adapter guidance](https://docs.ragas.io/en/stable/howtos/llm-adapters/).

## Initial batch: ten cases

1. Explicit specialist request with useful conversation context; proceed without redundant consent.
2. Explicit specialist request with sparse context and no contact details; do not block on optional fields.
3. Clear buying intent; ask permission, then simulate handoff after consent.
4. Appointment/test-drive interest without an explicit transfer request; ask permission before handoff.
5. Conflicting offer terms remain unresolved after one data check; explain the issue and ask permission.
6. Offer validity is unavailable after one resolution attempt; explain the uncertainty and ask permission.
7. Uncertainty is resolved by the attempt; answer from MCP and do not hand off.
8. A routine vehicle/specification question is answerable; do not offer or initiate handoff.
9. A browsing-stage question with no unresolved issue; do not hand off solely due to weak buying intent.
10. Customer declines specialist help; do not initiate handoff and continue helpfully where possible.

These cases are defined in `evals/multistep-leads/flows.json` and checked against fixture structure by the TypeScript loader. The Node evaluator accepts `--start=<zero-based-index>` and `--flows=<count>`; its default model and endpoint are `qwen2.5:3b` and `http://127.0.0.1:11434/api/chat`.

## Scoring and acceptance criteria

For each case, report pass/fail and evidence for each check. A passing batch requires:

- Correct handoff decision for trigger and control cases.
- Consent requested and honored according to the rules above.
- At most one reasonable MCP resolution attempt before offering help for unresolved data.
- Handoff payload includes relevant known context, omits invented facts, and does not demand optional contact details.
- Customer-facing answers are grounded in MCP results and do not overstate validity or other uncertain data.
- No claim of a successful connection when the simulated handoff failed or was never called.
- Deterministic and Ragas results reported separately, with disagreements visible.
- All conversations and scoring stages run serially, with model calls, elapsed time, and errors summarized.

## Implementation status and evidence

Tasks 1–6 are implemented: ten fixtures, deterministic scoring, serial runner with local mock, validated per-flow JSONL traces, isolated Ragas scorer, run command, and operator guide. The first ten-flow run completed all cases: 6 deterministic passes and 4 failures. Post-batch fixes added runtime authorization, argument sanitation, stricter success-claim checks, and valid partial traces. The latest full run passed nine flows and retained the validity flow as incomplete. Details and verification are in `.superpowers/sdd/task-6-report.md` and `task-7-report.md`.

## Known limitations

- Small local models vary across runs. Historical runs alternately omitted known payload fields or inferred an unmentioned vehicle category; a successful one-flow smoke does not establish consistency.
- In the first ten-flow run, four scenarios skipped the consent offer before handoff. Two unresolved-offer payloads also failed grounding checks. In one scenario, the model emitted null and zero optional search filters that the MCP schema rejected. The deterministic gate correctly failed these results and the raw evidence is retained.
- Deterministic lexical grounding checks are approximations. They can miss implied fabrication and reject valid paraphrase.
- The first ten-flow Ragas run returned 0.0 for `AgentGoalAccuracyWithReference` on all cases, including deterministic passes, with no runtime errors. This local evaluator result did not distinguish outcomes and should be treated as noisy. Handoff action name precision/recall was 1.0 for each case; this checks the harness action name only and not consent or payload quality.
- The mock verifies model behavior and payload shape, not a future real transfer integration.
- Local model output remains variable; one post-fix full run stopped before answering the unresolved-validity turn. Partial traces now preserve that incomplete result for review.
- The deterministic scorer rejects claims of real connection, callback, contact, or scheduling even after `simulated_success`; explicit wording that identifies the action as a local simulation is allowed.
- A small local Ragas batch is diagnostic rather than a statistically reliable benchmark. Preserve raw traces and treat Ragas as a signal, not truth for business handoff rules.

## Out of scope

- Connecting to a real advisor, CRM, appointment system, or customer-contact service.
- Collecting or persisting real customer personal information.
- Running concurrent model evaluations or treating ten cases as a release-quality statistical benchmark.
- Replacing deterministic MCP evaluation or the existing search-quality evaluation.
