import {describe, expect, it} from 'vitest';
import {
  NoopSearchObservability,
  type SearchObservation,
} from '../../src/observability/search-observability.js';

const observation: SearchObservation = {
  operation: 'search.vehicles',
  query: 'SUV familiar',
  filters: {modelYear: 2026},
  latencyMs: 12,
  candidateCount: 3,
  resultCount: 2,
  semanticSearch: 'ready',
  topResultId: 'vehicle-1',
  topScore: 0.8,
};

describe('NoopSearchObservability', () => {
  it('returns the search result without changing behavior', async () => {
    const observability = new NoopSearchObservability();

    const result = await observability.record(observation);

    expect(result).toBeUndefined();
  });

  it('does not throw when recording an observation', async () => {
    const observability = new NoopSearchObservability();

    await expect(observability.record(observation)).resolves.toBeUndefined();
  });
});
