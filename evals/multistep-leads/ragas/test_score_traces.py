import json
import tempfile
import unittest
from pathlib import Path

from score_traces import (
    evaluator_model_from_env,
    load_trace_file,
    summarize_traces,
    tool_call_scores,
)


def trace(**changes):
    value = {
        "flowId": "flow-a",
        "fixtureVersion": 1,
        "model": "qwen2.5:3b",
        "messages": [
            {"role": "user", "content": "Quiero opciones."},
            {"role": "assistant", "content": "Claro."},
        ],
        "turns": [
            {
                "userTurnIndex": 0,
                "userMessage": "Quiero opciones.",
                "assistantAnswers": ["Claro."],
            }
        ],
        "mcpCalls": [],
        "handoffCalls": [],
        "deterministicScore": {"passed": True, "failures": []},
        "ragasInput": {
            "reference": "Responder la solicitud.",
            "expectedToolNames": [],
            "expectedHandoff": "forbidden",
            "messages": [
                {"role": "user", "content": "Quiero opciones."},
                {"role": "assistant", "content": "Claro."},
            ],
        },
        "complete": True,
        "errors": [],
        "elapsedMs": 120,
        "promptTokens": 30,
        "generatedTokens": 5,
    }
    value.update(changes)
    return value


class TraceParsingTests(unittest.TestCase):
    def test_evaluator_defaults_independently_from_generation_model(self):
        self.assertEqual("gemma4:e4b", evaluator_model_from_env({"OLLAMA_MODEL": "qwen2.5:3b"}))
        self.assertEqual("custom:latest", evaluator_model_from_env({"RAGAS_OLLAMA_MODEL": "custom:latest"}))

    def test_loads_valid_jsonl_trace(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "trace.jsonl"
            path.write_text(json.dumps(trace()) + "\n", encoding="utf-8")

            traces = load_trace_file(path)

        self.assertEqual(["flow-a"], [item["flowId"] for item in traces])

    def test_rejects_missing_required_transcript_field_with_line_number(self):
        value = trace()
        del value["messages"]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "trace.jsonl"
            path.write_text(json.dumps(value) + "\n", encoding="utf-8")

            with self.assertRaisesRegex(ValueError, r"line 1.*messages"):
                load_trace_file(path)

    def test_rejects_missing_reference(self):
        value = trace()
        value["ragasInput"]["reference"] = " "
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "trace.jsonl"
            path.write_text(json.dumps(value) + "\n", encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "reference"):
                load_trace_file(path)

    def test_rejects_complete_trace_without_assistant_response(self):
        value = trace(
            messages=[{"role": "user", "content": "Quiero opciones."}],
        )
        value["ragasInput"]["messages"] = value["messages"]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "trace.jsonl"
            path.write_text(json.dumps(value) + "\n", encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "assistant transcript"):
                load_trace_file(path)

    def test_rejects_malformed_json_with_line_number(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "trace.jsonl"
            path.write_text("{not json}\n", encoding="utf-8")

            with self.assertRaisesRegex(ValueError, r"line 1.*invalid JSON"):
                load_trace_file(path)

    def test_dry_run_counts_complete_incomplete_and_expected_handoffs(self):
        complete = trace()
        incomplete = trace(
            flowId="flow-b",
            complete=False,
            errors=["ollama: unavailable"],
            deterministicScore={"passed": False, "failures": ["incomplete_flow"]},
        )

        summary = summarize_traces([complete, incomplete])

        self.assertEqual(
            {"traces": 2, "complete": 1, "incomplete": 1, "expectedHandoffs": 0},
            summary,
        )

    def test_tool_scores_use_only_harness_handoff_calls(self):
        scores = tool_call_scores(
            ["handoff_to_specialist"],
            [
                {"status": "simulated_success", "arguments": {"reason": "consulta"}},
                {"status": "simulated_failure", "arguments": {"reason": "extra"}},
            ],
        )

        self.assertEqual(
            {"precision": 0.5, "recall": 1.0, "f1": 0.6667}, scores
        )


if __name__ == "__main__":
    unittest.main()
