#!/usr/bin/env python3
"""Validate lead-flow traces and score them serially with local Ragas/Ollama."""

import argparse
import asyncio
import json
import math
import os
import sys
from collections import Counter
from pathlib import Path
from typing import Any, Dict, List, Sequence


REQUIRED_FIELDS = {
    "flowId",
    "fixtureVersion",
    "model",
    "messages",
    "turns",
    "mcpCalls",
    "handoffCalls",
    "deterministicScore",
    "ragasInput",
    "complete",
    "errors",
    "elapsedMs",
    "promptTokens",
    "generatedTokens",
}


def _is_record(value: Any) -> bool:
    return isinstance(value, dict)


def validate_trace(value: Any) -> Dict[str, Any]:
    if not _is_record(value):
        raise ValueError("trace row must be a JSON object")
    missing = sorted(REQUIRED_FIELDS - set(value))
    if missing:
        raise ValueError("missing required fields: " + ", ".join(missing))
    if not isinstance(value["flowId"], str) or not value["flowId"].strip():
        raise ValueError("flowId must be a non-empty string")
    if value["fixtureVersion"] != 1:
        raise ValueError("fixtureVersion must be 1")
    if not isinstance(value["model"], str) or not value["model"].strip():
        raise ValueError("model must be a non-empty string")
    if not isinstance(value["messages"], list) or not value["messages"]:
        raise ValueError("messages must contain a transcript")
    if not all(_is_record(message) for message in value["messages"]):
        raise ValueError("messages must contain JSON objects")
    if not any(message.get("role") == "user" for message in value["messages"]):
        raise ValueError("messages must contain a user transcript")
    if value.get("complete") is True and not any(
        message.get("role") == "assistant" for message in value["messages"]
    ):
        raise ValueError("complete messages must contain an assistant transcript")
    for field in ("turns", "mcpCalls", "handoffCalls"):
        if not isinstance(value[field], list):
            raise ValueError(field + " must be an array")
    ragas_input = value["ragasInput"]
    if not _is_record(ragas_input):
        raise ValueError("ragasInput must be an object")
    reference = ragas_input.get("reference")
    if not isinstance(reference, str) or not reference.strip():
        raise ValueError("ragasInput.reference is required")
    expected_names = ragas_input.get("expectedToolNames")
    if not isinstance(expected_names, list) or not all(
        name == "handoff_to_specialist" for name in expected_names
    ):
        raise ValueError(
            "ragasInput.expectedToolNames must contain only handoff_to_specialist"
        )
    if len(expected_names) > 1:
        raise ValueError("ragasInput.expectedToolNames can contain at most one item")
    if ragas_input.get("expectedHandoff") not in ("required", "forbidden"):
        raise ValueError("ragasInput.expectedHandoff is invalid")
    if ragas_input.get("messages") != value["messages"]:
        raise ValueError("ragasInput.messages must match messages")
    if not isinstance(value["complete"], bool):
        raise ValueError("complete must be a boolean")
    score = value["deterministicScore"]
    if not _is_record(score) or not isinstance(score.get("passed"), bool):
        raise ValueError("deterministicScore must contain a boolean passed value")
    failures = score.get("failures")
    if not isinstance(failures, list) or not all(
        isinstance(item, str) and item.strip() for item in failures
    ):
        raise ValueError("deterministicScore.failures must be a string array")
    if score["passed"] == bool(failures):
        raise ValueError("deterministicScore passed and failures are inconsistent")
    if not isinstance(value["errors"], list) or not all(
        isinstance(item, str) for item in value["errors"]
    ):
        raise ValueError("errors must be a string array")
    if not value["complete"] and (not value["errors"] or score["passed"]):
        raise ValueError("incomplete trace must contain errors and a failed score")
    for field in ("elapsedMs", "promptTokens", "generatedTokens"):
        number = value[field]
        if (
            isinstance(number, bool)
            or not isinstance(number, (int, float))
            or not math.isfinite(number)
            or number < 0
        ):
            raise ValueError(field + " must be a non-negative number")
    return value


def load_trace_file(path: Any) -> List[Dict[str, Any]]:
    trace_path = Path(path)
    traces = []
    try:
        with trace_path.open("r", encoding="utf-8") as source:
            for line_number, line in enumerate(source, 1):
                if not line.strip():
                    continue
                try:
                    row = json.loads(line)
                    traces.append(validate_trace(row))
                except json.JSONDecodeError as error:
                    raise ValueError(
                        "line {}: invalid JSON: {}".format(line_number, error)
                    ) from error
                except ValueError as error:
                    raise ValueError("line {}: {}".format(line_number, error)) from error
    except OSError as error:
        raise ValueError("cannot read trace file {}: {}".format(trace_path, error)) from error
    if not traces:
        raise ValueError("trace file contains no JSONL rows")
    return traces


def summarize_traces(traces: Sequence[Dict[str, Any]]) -> Dict[str, int]:
    return {
        "traces": len(traces),
        "complete": sum(1 for trace in traces if trace["complete"]),
        "incomplete": sum(1 for trace in traces if not trace["complete"]),
        "expectedHandoffs": sum(
            len(trace["ragasInput"]["expectedToolNames"]) for trace in traces
        ),
    }


def tool_call_scores(
    expected_names: Sequence[str], actual_calls: Sequence[Dict[str, Any]]
) -> Dict[str, float]:
    expected = Counter(expected_names)
    actual = Counter("handoff_to_specialist" for _ in actual_calls)
    true_positives = sum(min(count, actual[name]) for name, count in expected.items())
    false_positives = sum(actual.values()) - true_positives
    false_negatives = sum(expected.values()) - true_positives
    precision = (
        true_positives / (true_positives + false_positives)
        if true_positives + false_positives
        else (1.0 if false_negatives == 0 else 0.0)
    )
    recall = (
        true_positives / (true_positives + false_negatives)
        if true_positives + false_negatives
        else 1.0
    )
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return {
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(f1, 4),
    }


def ragas_messages(messages: Sequence[Dict[str, Any]]) -> List[Any]:
    from ragas.messages import AIMessage, HumanMessage, ToolCall, ToolMessage

    converted = []
    for message in messages:
        role = message.get("role")
        content = message.get("content", "")
        if role == "user":
            converted.append(HumanMessage(content=str(content)))
        elif role == "assistant":
            calls = []
            for request in message.get("tool_calls", []):
                function = request.get("function", {})
                arguments = function.get("arguments", {})
                if isinstance(arguments, str):
                    arguments = json.loads(arguments)
                calls.append(
                    ToolCall(name=function.get("name", "unknown"), args=arguments)
                )
            converted.append(AIMessage(content=str(content), tool_calls=calls))
        elif role == "tool":
            converted.append(ToolMessage(content=str(content)))
    if not converted:
        raise ValueError("transcript has no Ragas-compatible messages")
    return converted


async def score_goal(trace: Dict[str, Any], metric: Any) -> float:
    result = await metric.ascore(
        user_input=ragas_messages(trace["messages"]),
        reference=trace["ragasInput"]["reference"],
    )
    value = getattr(result, "value", result)
    score = float(value)
    if not math.isfinite(score):
        raise ValueError("Ragas returned a non-finite score")
    return score


async def score_all(traces: Sequence[Dict[str, Any]], model: str, base_url: str):
    from openai import AsyncOpenAI
    from ragas.llms import llm_factory
    from ragas.metrics.collections import AgentGoalAccuracyWithReference

    client = AsyncOpenAI(api_key="ollama", base_url=base_url)
    evaluator = llm_factory(model, provider="openai", client=client)
    metric = AgentGoalAccuracyWithReference(llm=evaluator)
    results = []
    for trace in traces:
        result = {
            "flowId": trace["flowId"],
            "complete": trace["complete"],
            "deterministicScore": trace["deterministicScore"],
            "metrics": {
                "handoffToolPrecisionRecall": tool_call_scores(
                    trace["ragasInput"]["expectedToolNames"], trace["handoffCalls"]
                ),
                "agentGoalAccuracyWithReference": None,
            },
            "errors": [],
        }
        if trace["complete"]:
            try:
                result["metrics"]["agentGoalAccuracyWithReference"] = await score_goal(
                    trace, metric
                )
            except Exception as error:  # Keep one failed metric from stopping later flows.
                result["errors"].append("agentGoalAccuracyWithReference: " + str(error))
        else:
            result["errors"].append("incomplete_trace: goal metric skipped")
        results.append(result)
    await client.close()
    return results


def parse_args(argv: Sequence[str]):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("trace", help="JSONL trace file produced by eval:mcp:leads")
    parser.add_argument(
        "--dry-run", action="store_true", help="validate rows and report counts without Ollama"
    )
    return parser.parse_args(argv)


def evaluator_model_from_env(environ: Dict[str, str]) -> str:
    return environ.get("RAGAS_OLLAMA_MODEL", "gemma4:e4b")


def main(argv: Sequence[str] = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    try:
        traces = load_trace_file(args.trace)
    except ValueError as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr)
        return 2
    summary = summarize_traces(traces)
    if args.dry_run:
        print(json.dumps({"tracePath": str(Path(args.trace)), "dryRun": summary}))
        return 0
    model = evaluator_model_from_env(os.environ)
    base_url = os.environ.get(
        "RAGAS_OLLAMA_BASE_URL", "http://127.0.0.1:11434/v1"
    )
    try:
        results = asyncio.run(score_all(traces, model, base_url))
    except Exception as error:
        print(
            json.dumps(
                {
                    "tracePath": str(Path(args.trace)),
                    "evaluatorModel": model,
                    "summary": summary,
                    "error": str(error),
                }
            )
        )
        return 1
    output = {
        "tracePath": str(Path(args.trace)),
        "evaluatorModel": model,
        "summary": summary,
        "results": results,
    }
    print(json.dumps(output, ensure_ascii=False))
    return 1 if any(result["errors"] for result in results) else 0


if __name__ == "__main__":
    raise SystemExit(main())
