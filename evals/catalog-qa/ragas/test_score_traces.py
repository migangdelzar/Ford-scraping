import importlib.util
import asyncio
import json
import tempfile
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).with_name('score_traces.py')
SPEC = importlib.util.spec_from_file_location('catalog_qa_score_traces', MODULE_PATH)
score = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(score)


def trace(**overrides):
    value = {
        'datasetVersion': 1,
        'questionId': 'ranger-power',
        'model': 'RANGER',
        'year': 2027,
        'category': 'engine-power',
        'question': '¿Cuántos caballos tiene?',
        'expectedTools': ['get_vehicle'],
        'toolRouting': {'precision': 1, 'recall': 1, 'f1': 1, 'exact': True},
        'toolCalls': [{'name': 'get_vehicle', 'arguments': {}, 'result': {'model': 'RANGER'}}],
        'retrievedContexts': ['RANGER 2027 Motor: 270 hp gasolina y 168 hp diésel'],
        'answer': 'Tiene opciones de 270 hp gasolina y 168 hp diésel.',
        'referenceAnswer': 'La ficha indica 270 hp gasolina y 168 hp diésel.',
        'sourceUrls': ['https://www.forduruapan.mx/RANGER/27/Ficha-Tecnica/'],
        'detailCompleteness': {'complete': True},
        'complete': True,
        'errors': [],
        'elapsedMs': 100,
    }
    value.update(overrides)
    return value


class CatalogQaTraceTests(unittest.TestCase):
    def test_judge_llm_uses_a_bounded_output_budget(self):
        received = {}

        def factory(model, **kwargs):
            received['model'] = model
            received.update(kwargs)
            return 'judge'

        self.assertEqual(score.build_judge_llm(factory, 'gemma4:e4b', 'client'), 'judge')
        self.assertEqual(received['max_tokens'], 512)
        self.assertEqual(received['client'], 'client')

    def test_metric_timeout_is_reported_as_a_metric_error(self):
        class SlowMetric:
            async def ascore(self, **_kwargs):
                await asyncio.sleep(0.05)
                return 1.0

        value, error = asyncio.run(
            score.score_metric(
                SlowMetric(), {'user_input': 'question'}, timeout_seconds=0.001
            )
        )
        self.assertIsNone(value)
        self.assertIn('timed out', error)

    def test_validates_required_fields_and_question_id(self):
        self.assertEqual(score.validate_trace(trace())['questionId'], 'ranger-power')
        self.assertIsNone(score.validate_trace(trace(model=None, year=None))['year'])
        with self.assertRaisesRegex(ValueError, 'questionId'):
            score.validate_trace({'datasetVersion': 1})

    def test_skips_faithfulness_when_no_retrieved_context_exists(self):
        row = score.validate_trace(trace(retrievedContexts=[]))
        self.assertIsNone(score.metric_inputs(row)['faithfulness'])

    def test_correctness_inputs_use_the_reference_answer(self):
        row = score.validate_trace(trace())
        self.assertEqual(score.metric_inputs(row)['correctness']['reference'], row['referenceAnswer'])

    def test_summaries_keep_incomplete_traces_and_group_by_category(self):
        rows = [score.validate_trace(trace()), score.validate_trace(trace(questionId='failed', complete=False, errors=['no answer'], answer='', retrievedContexts=[]))]
        summary = score.summarize(rows)
        self.assertEqual(summary['traces'], 2)
        self.assertEqual(summary['incomplete'], 1)
        self.assertEqual(summary['byCategory']['engine-power']['traces'], 2)

    def test_aggregates_keep_unscored_rows_and_group_by_tool(self):
        rows = [
            {'model': 'RANGER', 'year': 2027, 'category': 'engine-power', 'toolCalls': [{'name': 'get_vehicle'}], 'complete': True, 'metrics': {'correctness': 0.8, 'faithfulness': None, 'relevance': 0.9}},
            {'model': 'RANGER', 'year': 2027, 'category': 'engine-power', 'toolCalls': [], 'complete': False, 'metrics': {'correctness': None, 'faithfulness': None, 'relevance': None}},
        ]
        grouped = score.aggregate(rows, 'tool')
        self.assertEqual(grouped['get_vehicle']['traces'], 1)
        self.assertEqual(grouped['(none)']['incomplete'], 1)
        self.assertEqual(grouped['get_vehicle']['metrics']['faithfulness']['skipped'], 1)

    def test_loads_jsonl_and_reports_invalid_rows(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'traces.jsonl'
            path.write_text(json.dumps(trace()) + '\n', encoding='utf-8')
            self.assertEqual(len(score.load_traces(path)), 1)
            path.write_text('{bad json}\n', encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'line 1'):
                score.load_traces(path)


if __name__ == '__main__':
    unittest.main()
