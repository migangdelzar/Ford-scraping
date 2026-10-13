export interface RetrievalMetrics {
  hitAtK: number;
  precisionAtK: number;
  recallAtK: number;
  mrr: number;
  ndcgAtK: number;
}

export interface FactCoverage {
  matched: string[];
  missing: string[];
  coverage: number;
}

export function calculateRetrievalMetrics(
  rankedKeys: readonly string[],
  relevantKeys: readonly string[],
  k: number,
): RetrievalMetrics {
  if (!Number.isInteger(k) || k < 1) {
    throw new Error('k must be a positive integer');
  }
  if (relevantKeys.length === 0) {
    throw new Error('relevantKeys must not be empty');
  }

  const relevant = new Set(relevantKeys);
  const top = rankedKeys.slice(0, k);
  const hits = top.filter(key => relevant.has(key));
  const firstRelevantRank = top.findIndex(key => relevant.has(key)) + 1;
  const dcg = top.reduce(
    (sum, key, index) =>
      sum + (relevant.has(key) ? 1 / Math.log2(index + 2) : 0),
    0,
  );
  const idealCount = Math.min(k, relevant.size);
  const idealDcg = Array.from(
    {length: idealCount},
    (_, index) => 1 / Math.log2(index + 2),
  ).reduce((sum, gain) => sum + gain, 0);

  return {
    hitAtK: hits.length > 0 ? 1 : 0,
    precisionAtK: hits.length / k,
    recallAtK: hits.length / relevant.size,
    mrr: firstRelevantRank === 0 ? 0 : 1 / firstRelevantRank,
    ndcgAtK: idealDcg === 0 ? 0 : dcg / idealDcg,
  };
}

function normalizeEvidence(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export function calculateFactCoverage(
  contexts: readonly string[],
  expectedFacts: readonly string[],
): FactCoverage {
  const evidence = normalizeEvidence(contexts.join('\n'));
  const matched = expectedFacts.filter(fact =>
    evidence.includes(normalizeEvidence(fact)),
  );
  const missing = expectedFacts.filter(fact => !matched.includes(fact));
  return {
    matched,
    missing,
    coverage:
      expectedFacts.length === 0 ? 1 : matched.length / expectedFacts.length,
  };
}
