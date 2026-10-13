import {describe, expect, it} from 'vitest';
import {
  calculateRetrievalMetrics,
  calculateFactCoverage,
} from '../../scripts/semantic-retrieval-evaluation.js';

describe('semantic retrieval evaluation metrics', () => {
  it('scores ranked relevant documents with hit, precision, recall, MRR and nDCG', () => {
    expect(
      calculateRetrievalMetrics(
        ['unrelated', 'relevant-a', 'relevant-b', 'other'],
        ['relevant-a', 'relevant-b'],
        5,
      ),
    ).toEqual({
      hitAtK: 1,
      precisionAtK: 0.4,
      recallAtK: 1,
      mrr: 0.5,
      ndcgAtK: expect.closeTo(0.693426, 5),
    });
  });

  it('scores an empty relevant ranking as zero without dividing by zero', () => {
    expect(calculateRetrievalMetrics(['a', 'b'], ['c'], 5)).toEqual({
      hitAtK: 0,
      precisionAtK: 0,
      recallAtK: 0,
      mrr: 0,
      ndcgAtK: 0,
    });
  });

  it('finds authored facts in retrieved text independent of case and accents', () => {
    expect(
      calculateFactCoverage(
        ['Ford BRONCO 2026. Precio desde: $998,500 MXN.'],
        ['Bronco 2026', '$998,500 MXN', 'motor 2.3L'],
      ),
    ).toEqual({
      matched: ['Bronco 2026', '$998,500 MXN'],
      missing: ['motor 2.3L'],
      coverage: 2 / 3,
    });
  });
});
