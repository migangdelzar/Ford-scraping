#!/usr/bin/env python3
"""Validate and score Ford catalog QA traces with local Ollama-backed RAGAS."""
import argparse
import asyncio
import json
import math
import os
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Sequence

REQUIRED = {'datasetVersion', 'questionId', 'model', 'year', 'category', 'question', 'expectedTools', 'toolRouting', 'toolCalls', 'retrievedContexts', 'answer', 'referenceAnswer', 'sourceUrls', 'detailCompleteness', 'complete', 'errors', 'elapsedMs'}


def positive_env_int(name: str, default: int) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except ValueError:
        return default
    return value if value > 0 else default


JUDGE_MAX_TOKENS = positive_env_int('RAGAS_JUDGE_MAX_TOKENS', 512)
METRIC_TIMEOUT_SECONDS = positive_env_int('RAGAS_METRIC_TIMEOUT_SECONDS', 60)


def build_judge_llm(factory: Any, model: str, client: Any):
    return factory(
        model,
        provider='openai',
        client=client,
        max_tokens=JUDGE_MAX_TOKENS,
    )


def validate_trace(row: Any) -> Dict[str, Any]:
    if not isinstance(row, dict):
        raise ValueError('trace row must be a JSON object')
    missing = sorted(REQUIRED - set(row))
    if missing:
        raise ValueError('missing required fields: ' + ', '.join(missing))
    if row['datasetVersion'] != 1:
        raise ValueError('datasetVersion must be 1')
    if not isinstance(row['questionId'], str) or not row['questionId'].strip():
        raise ValueError('questionId must be non-empty')
    for field in ('category', 'question', 'answer', 'referenceAnswer'):
        if not isinstance(row[field], str):
            raise ValueError(field + ' must be a string')
    if row['model'] is not None and not isinstance(row['model'], str):
        raise ValueError('model must be a string or null')
    if row['year'] is not None and (isinstance(row['year'], bool) or not isinstance(row['year'], int)):
        raise ValueError('year must be an integer or null')
    for field in ('expectedTools', 'toolCalls', 'retrievedContexts', 'sourceUrls', 'errors'):
        if not isinstance(row[field], list):
            raise ValueError(field + ' must be an array')
    if not all(isinstance(value, str) for value in row['retrievedContexts']):
        raise ValueError('retrievedContexts must contain strings')
    if not all(isinstance(value, str) and value.startswith('https://') for value in row['sourceUrls']):
        raise ValueError('sourceUrls must contain HTTPS URLs')
    if not isinstance(row['complete'], bool):
        raise ValueError('complete must be a boolean')
    if not row['complete'] and (not row['errors'] or row['answer']):
        raise ValueError('incomplete traces must contain errors and no answer')
    if isinstance(row['elapsedMs'], bool) or not isinstance(row['elapsedMs'], (int, float)) or row['elapsedMs'] < 0:
        raise ValueError('elapsedMs must be a non-negative number')
    return row


def load_traces(path: Any) -> List[Dict[str, Any]]:
    traces = []
    try:
        with Path(path).open(encoding='utf-8') as source:
            for number, line in enumerate(source, 1):
                if not line.strip():
                    continue
                try:
                    traces.append(validate_trace(json.loads(line)))
                except (json.JSONDecodeError, ValueError) as error:
                    raise ValueError(f'line {number}: {error}') from error
    except OSError as error:
        raise ValueError(f'cannot read trace file: {error}') from error
    if not traces:
        raise ValueError('trace file contains no JSONL rows')
    return traces


def metric_inputs(row: Dict[str, Any]) -> Dict[str, Any]:
    answer = row['answer'].strip()
    return {
        'correctness': {'user_input': row['question'], 'response': answer, 'reference': row['referenceAnswer']}
        if answer else None,
        'faithfulness': {'user_input': row['question'], 'response': answer, 'retrieved_contexts': row['retrievedContexts']}
        if answer and row['retrievedContexts'] else None,
        'relevance': {'user_input': row['question'], 'response': answer} if answer else None,
    }


async def score_metric(metric: Any, metric_input: Dict[str, Any], timeout_seconds: int):
    try:
        value = await asyncio.wait_for(
            metric.ascore(**metric_input), timeout=timeout_seconds
        )
        number = float(getattr(value, 'value', value))
        if not math.isfinite(number):
            raise ValueError('RAGAS returned a non-finite score')
        return number, None
    except asyncio.TimeoutError:
        return None, f'timed out after {timeout_seconds}s'
    except Exception as error:
        return None, str(error)


def summarize(rows: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    summary: Dict[str, Any] = {'traces': len(rows), 'complete': sum(row['complete'] for row in rows), 'incomplete': sum(not row['complete'] for row in rows), 'detailComplete': sum(isinstance(row['detailCompleteness'], dict) and row['detailCompleteness'].get('complete') is True for row in rows), 'byCategory': {}}
    groups: Dict[str, list] = defaultdict(list)
    for row in rows:
        groups[row['category']].append(row)
    for category, values in sorted(groups.items()):
        summary['byCategory'][category] = {'traces': len(values), 'complete': sum(row['complete'] for row in values), 'incomplete': sum(not row['complete'] for row in values)}
    return summary


async def score_all(rows: Sequence[Dict[str, Any]], model: str, base_url: str, embedding_model: str):
    from openai import AsyncOpenAI
    from ragas.embeddings import OpenAIEmbeddings
    from ragas.llms import llm_factory
    from ragas.metrics.collections import AnswerCorrectness, AnswerRelevancy, Faithfulness
    client = AsyncOpenAI(api_key='ollama', base_url=base_url)
    llm = build_judge_llm(llm_factory, model, client)
    embeddings_client = AsyncOpenAI(api_key='ollama', base_url=base_url)
    embeddings = OpenAIEmbeddings(client=embeddings_client, model=embedding_model)
    metrics = {'correctness': AnswerCorrectness(llm=llm, embeddings=embeddings), 'faithfulness': Faithfulness(llm=llm), 'relevance': AnswerRelevancy(llm=llm, embeddings=embeddings)}
    results = []
    for index, row in enumerate(rows, 1):
        result = {'questionId': row['questionId'], 'model': row['model'], 'year': row['year'], 'modelYear': f"{row['model']} {row['year']}", 'category': row['category'], 'toolCalls': row['toolCalls'], 'complete': row['complete'], 'detailCompleteness': row['detailCompleteness'], 'toolRouting': row['toolRouting'], 'metrics': {}, 'errors': list(row['errors'])}
        inputs = metric_inputs(row)
        for name, metric in metrics.items():
            if inputs[name] is None:
                result['metrics'][name] = None
                result['errors'].append(name + ': skipped; answer or retrieved context is missing')
                continue
            value, error = await score_metric(
                metric, inputs[name], METRIC_TIMEOUT_SECONDS
            )
            result['metrics'][name] = value
            if error:
                result['errors'].append(name + ': ' + error)
            status = 'error: ' + error if error else f'score={value:.3f}'
            print(
                f'[{index}/{len(rows)}] {row["questionId"]} {name}: {status}',
                flush=True,
            )
        results.append(result)
    await client.close()
    await embeddings_client.close()
    return results


def aggregate(results: Sequence[Dict[str, Any]], key: str):
    groups: Dict[str, list] = defaultdict(list)
    for row in results:
        if key == 'tool':
            value = sorted({call.get('name') for call in row.get('toolCalls', []) if isinstance(call, dict) and isinstance(call.get('name'), str)})
        else:
            value = row.get(key)
        if isinstance(value, list):
            value = ','.join(value) or '(none)'
        groups[str(value)].append(row)
    output = {}
    for name, rows in sorted(groups.items()):
        metrics = {}
        for metric in ('correctness', 'faithfulness', 'relevance'):
            values = [row['metrics'][metric] for row in rows if row['metrics'].get(metric) is not None]
            metrics[metric] = {'average': sum(values) / len(values) if values else None, 'scored': len(values), 'skipped': len(rows) - len(values)}
        output[name] = {'traces': len(rows), 'complete': sum(row['complete'] for row in rows), 'incomplete': sum(not row['complete'] for row in rows), 'metrics': metrics}
    return output


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('trace', help='JSONL trace file produced by eval:mcp:catalog-qa')
    parser.add_argument('--dry-run', action='store_true', help='validate trace rows without contacting Ollama')
    args = parser.parse_args(sys.argv[1:] if argv is None else argv)
    try:
        rows = load_traces(args.trace)
    except ValueError as error:
        print(json.dumps({'error': str(error)}), file=sys.stderr)
        return 2
    if args.dry_run:
        print(json.dumps({'tracePath': str(Path(args.trace)), 'dryRun': summarize(rows)}, ensure_ascii=False))
        return 0
    model = os.environ.get('RAGAS_OLLAMA_MODEL', 'gemma4:e4b')
    base_url = os.environ.get('RAGAS_OLLAMA_BASE_URL', 'http://127.0.0.1:11434/v1')
    embedding_model = os.environ.get('RAGAS_OLLAMA_EMBEDDING_MODEL', 'bge-m3:latest')
    if not ('127.0.0.1' in base_url or 'localhost' in base_url or '[::1]' in base_url):
        print(json.dumps({'error': 'RAGAS_OLLAMA_BASE_URL must point to loopback; scoring is local-only'}), file=sys.stderr)
        return 2
    try:
        results = asyncio.run(score_all(rows, model, base_url, embedding_model))
    except Exception as error:
        print(json.dumps({'tracePath': str(Path(args.trace)), 'evaluatorModel': model, 'error': str(error)}, ensure_ascii=False))
        return 1
    report = {'tracePath': str(Path(args.trace)), 'evaluatorModel': model, 'embeddingModel': embedding_model, 'summary': summarize(rows), 'aggregates': {key: aggregate(results, key) for key in ('model', 'modelYear', 'category', 'tool')}, 'results': results}
    output = Path(args.trace).with_suffix('.ragas.json')
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'reportPath': str(output), 'evaluatorModel': model, 'summary': report['summary'], 'aggregateGroups': {key: len(value) for key, value in report['aggregates'].items()}, 'metricErrors': sum(bool(row['errors']) for row in results)}, ensure_ascii=False))
    return 0 if all(not row['errors'] for row in results) else 1


if __name__ == '__main__':
    raise SystemExit(main())
