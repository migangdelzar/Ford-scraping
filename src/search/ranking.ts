import type {
  DocumentHit,
  OfferSearchCandidate,
  RankedOffer,
  RankedVehicle,
  VehicleSearchCandidate,
} from '../domain/contracts.js';

export interface ScoreWeights {
  keyword: number;
  semantic: number;
}

function normalizedScoresBy(
  hits: DocumentHit[],
  keyOf: (hit: DocumentHit) => string | undefined,
): Map<string, number> {
  const max = Math.max(...hits.map(hit => hit.score), 0);
  const values = new Map<string, number>();
  for (const hit of hits) {
    const key = keyOf(hit);
    if (!key) continue;
    const normalized = max <= 0 ? 0 : Math.max(0, hit.score) / max;
    values.set(key, Math.max(values.get(key) ?? 0, normalized));
  }
  return values;
}

function normalizedScores(hits: DocumentHit[]): Map<string, number> {
  return normalizedScoresBy(hits, hit => hit.modelYearId);
}

export function fuseOfferScores(
  keywordHits: DocumentHit[],
  semanticHits: DocumentHit[],
  candidates: Map<string, OfferSearchCandidate>,
  weights: ScoreWeights,
): RankedOffer[] {
  const keywordScores = normalizedScoresBy(keywordHits, hit => hit.offerId);
  const semanticScores = normalizedScoresBy(semanticHits, hit => hit.offerId);
  const hitIds = new Set(
    [...keywordHits, ...semanticHits].flatMap(hit =>
      hit.offerId ? [hit.offerId] : [],
    ),
  );
  const orderedIds = hitIds.size > 0 ? [...hitIds] : [...candidates.keys()];

  return orderedIds
    .flatMap(offerId => {
      const candidate = candidates.get(offerId);
      if (!candidate) return [];
      const keywordScore = keywordScores.get(offerId) ?? 0;
      const semanticScore = semanticScores.get(offerId) ?? 0;
      const hasSemantic = semanticHits.length > 0;
      const hits = [...keywordHits, ...semanticHits].filter(
        hit => hit.offerId === offerId,
      );
      const ranked: RankedOffer = {
        ...candidate,
        finalScore: hasSemantic
          ? keywordScore * weights.keyword + semanticScore * weights.semantic
          : keywordScore,
        keywordScore,
        semanticScore,
        evidence: hits.map(hit => ({
          title: hit.title,
          content: hit.content,
          sourceUrl: hit.sourceUrl,
          crawledAt: hit.crawledAt,
        })),
      };
      return [ranked];
    })
    .sort(
      (left, right) =>
        right.finalScore - left.finalScore ||
        left.title.localeCompare(right.title),
    );
}

export function fuseScores(
  keywordHits: DocumentHit[],
  semanticHits: DocumentHit[],
  candidates: Map<string, VehicleSearchCandidate>,
  weights: ScoreWeights,
): RankedVehicle[] {
  const keywordScores = normalizedScores(keywordHits);
  const semanticScores = normalizedScores(semanticHits);
  const hitIds = new Set(
    [...keywordHits, ...semanticHits].map(hit => hit.modelYearId),
  );
  const orderedIds = hitIds.size > 0 ? [...hitIds] : [...candidates.keys()];

  return orderedIds
    .map(modelYearId => {
      const candidate = candidates.get(modelYearId)!;
      const keywordScore = keywordScores.get(modelYearId) ?? 0;
      const semanticScore = semanticScores.get(modelYearId) ?? 0;
      const hasSemantic = semanticHits.length > 0;
      const finalScore = hasSemantic
        ? keywordScore * weights.keyword + semanticScore * weights.semantic
        : keywordScore;
      const hits = [...keywordHits, ...semanticHits].filter(
        hit => hit.modelYearId === modelYearId,
      );
      return {
        ...candidate,
        finalScore,
        keywordScore,
        semanticScore,
        matchedSections: [...new Set(hits.map(hit => hit.documentType))],
        evidence: hits.map(hit => ({
          title: hit.title,
          content: hit.content,
          sourceUrl: hit.sourceUrl,
          crawledAt: hit.crawledAt,
        })),
      };
    })
    .sort(
      (left, right) =>
        right.finalScore - left.finalScore ||
        left.modelName.localeCompare(right.modelName),
    );
}
