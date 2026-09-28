import {describe, expect, it} from 'vitest';
import {parseEvaluationOptions} from '../../scripts/mcp-evaluation-options.js';

describe('parseEvaluationOptions', () => {
  it('defaults to 100 flows and concurrency 3', () => {
    expect(parseEvaluationOptions([])).toEqual({
      flows: 100,
      concurrency: 3,
      start: 0,
    });
  });

  it('accepts positive flow and concurrency values', () => {
    expect(parseEvaluationOptions(['--flows=12', '--concurrency=4'])).toEqual({
      flows: 12,
      concurrency: 4,
      start: 0,
    });
  });

  it('can select a later flow without changing the one-at-a-time count', () => {
    expect(parseEvaluationOptions(['--flows=1', '--start=9'])).toEqual({
      flows: 1,
      concurrency: 3,
      start: 9,
    });
  });

  it('rejects unknown and non-positive options', () => {
    expect(() => parseEvaluationOptions(['--flows=0'])).toThrow(
      '--flows must be a positive integer',
    );
    expect(() => parseEvaluationOptions(['--unexpected'])).toThrow(
      'Unknown evaluation option',
    );
    expect(() => parseEvaluationOptions(['--start=-1'])).toThrow(
      '--start must be a non-negative integer',
    );
  });
});
