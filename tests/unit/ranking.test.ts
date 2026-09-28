import {describe, expect, it} from 'vitest';
import {fuseScores} from '../../src/search/ranking.js';
import type {
  DocumentHit,
  VehicleSearchCandidate,
} from '../../src/domain/contracts.js';

const candidate: VehicleSearchCandidate = {
  modelId: 'model-1',
  modelYearId: 'year-1',
  modelName: 'Territory',
  modelYear: 2026,
  price: 559900,
};

function hit(score: number, type: string): DocumentHit {
  return {
    documentId: `${type}-1`,
    modelYearId: 'year-1',
    documentType: type,
    title: `Territory ${type}`,
    content: 'contenido',
    score,
  };
}

describe('hybrid score fusion', () => {
  it('normalizes keyword and semantic scores and returns matched sections', () => {
    const ranked = fuseScores(
      [{...hit(0.5, 'technology')}],
      [{...hit(0.9, 'safety')}],
      new Map([['year-1', candidate]]),
      {keyword: 0.3, semantic: 0.7},
    );

    expect(ranked[0]).toMatchObject({
      modelYearId: 'year-1',
      semanticScore: 1,
      keywordScore: 1,
    });
    expect(ranked[0].matchedSections).toEqual(['technology', 'safety']);
  });

  it('uses keyword-only scores when semantic hits are absent', () => {
    const ranked = fuseScores(
      [{...hit(0.7, 'overview')}],
      [],
      new Map([['year-1', candidate]]),
      {keyword: 0.3, semantic: 0.7},
    );
    expect(ranked[0].finalScore).toBe(1);
    expect(ranked[0].semanticScore).toBe(0);
  });

  it('returns deterministic candidates when no textual or semantic hit exists', () => {
    const secondCandidate = {
      ...candidate,
      modelYearId: 'year-2',
      modelName: 'Bronco Sport',
    };
    const ranked = fuseScores(
      [],
      [],
      new Map([
        ['year-1', candidate],
        ['year-2', secondCandidate],
      ]),
      {keyword: 0.3, semantic: 0.7},
    );

    expect(ranked.map(item => item.modelYearId)).toEqual(['year-2', 'year-1']);
    expect(ranked.every(item => item.finalScore === 0)).toBe(true);
  });
});
