import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {
  parseCatalogQaQuestions,
  checkVehicleDetailCompleteness,
  checkVehicleModelYearOptionsCompleteness,
  validateCatalogQaQuestions,
  type CatalogQaQuestion,
  type CatalogModelYear,
} from '../../scripts/catalog-qa-evaluation.js';

const manifest = (
  JSON.parse(
    readFileSync('evals/catalog-qa/catalog-inventory.json', 'utf8'),
  ) as {
    modelYears: CatalogModelYear[];
  }
).modelYears;

function question(index: number, overrides: Partial<CatalogQaQuestion> = {}) {
  return {
    datasetVersion: 1,
    id: `question-${index}`,
    question: `¿Qué indica la ficha del modelo ${index}?`,
    category: 'specifications',
    model: 'RANGER',
    year: 2027,
    expectedTools: ['get_vehicle'],
    referenceAnswer: `La ficha indica el dato ${index}.`,
    sourceUrls: ['https://www.forduruapan.mx/RANGER/27/Ficha-Tecnica/'],
    ...overrides,
  } satisfies CatalogQaQuestion;
}

describe('catalog QA evaluation dataset', () => {
  it('contains at least 100 distinct questions covering every catalog model-year', () => {
    const questions = parseCatalogQaQuestions(
      readFileSync('evals/catalog-qa/questions.jsonl', 'utf8'),
    ) as CatalogQaQuestion[];
    const report = validateCatalogQaQuestions(questions, manifest, manifest);

    expect(questions.length).toBeGreaterThanOrEqual(100);
    expect(new Set(questions.map(item => item.id)).size).toBe(questions.length);
    expect(report.baselineModelYearCount).toBe(manifest.length);
    expect(report.coveredBaselineModelYears).toBe(manifest.length);
    expect(report.untestedModelYears).toEqual([]);
    expect(report.catalogDrift).toEqual({added: [], removed: []});
    expect(report.detailCountDrift).toEqual([]);
  });

  it('rejects malformed JSONL with its line number', () => {
    expect(() => parseCatalogQaQuestions('{bad json}\n')).toThrow(
      'line 1 is not valid JSON',
    );
  });

  it('rejects duplicate question IDs', () => {
    expect(() =>
      validateCatalogQaQuestions(
        [question(1), question(1)],
        manifest,
        manifest,
      ),
    ).toThrow('duplicate question id: question-1');
  });

  it('rejects questions without grounded references and sources', () => {
    expect(() =>
      validateCatalogQaQuestions(
        [question(1, {referenceAnswer: '', sourceUrls: []})],
        manifest,
        manifest,
      ),
    ).toThrow(
      'question-1 requires a reference answer and at least one source URL',
    );
  });

  it('rejects tool names outside the Ford MCP contract', () => {
    expect(() =>
      validateCatalogQaQuestions(
        [question(1, {expectedTools: ['submit_lead']})],
        manifest,
        manifest,
      ),
    ).toThrow('question-1 has unsupported MCP tool: submit_lead');
  });

  it('rejects fewer than 100 questions', () => {
    expect(() =>
      validateCatalogQaQuestions([question(1)], manifest, manifest),
    ).toThrow('catalog QA dataset needs at least 100 questions');
  });

  it('reports untested and changed model-year inventory instead of claiming full coverage', () => {
    const baseline = [
      {model: 'RANGER', year: 2027, specificationCount: 1, featureCount: 1},
      {model: 'RANGER', year: 2026, specificationCount: 1, featureCount: 1},
    ];
    const questions = Array.from({length: 100}, (_, index) =>
      question(index, {model: 'RANGER', year: index === 0 ? 2027 : 2026}),
    );

    const report = validateCatalogQaQuestions(questions, baseline, [
      {model: 'RANGER', year: 2027, specificationCount: 2, featureCount: 1},
      {model: 'MUSTANG', year: 2026, specificationCount: 1, featureCount: 1},
    ]);

    expect(report.untestedModelYears).toEqual(['MUSTANG 2026']);
    expect(report.catalogDrift).toEqual({
      added: ['MUSTANG 2026'],
      removed: ['RANGER 2026'],
    });
    expect(report.detailCountDrift).toEqual([
      {
        model: 'RANGER',
        year: 2027,
        baselineSpecifications: 1,
        currentSpecifications: 2,
        baselineFeatures: 1,
        currentFeatures: 1,
      },
    ]);
    expect(report.fullCatalogCoverage).toBe(false);
  });

  it('accepts a vehicle detail response only when every catalog detail was returned', () => {
    const expected: CatalogModelYear = {
      model: 'RANGER',
      year: 2027,
      specificationCount: 2,
      featureCount: 1,
    };
    const actual = {
      model: 'RANGER',
      year: 2027,
      specificationCount: 2,
      specificationsOmitted: 0,
      specifications: [
        {
          name: 'Motor',
          value: '270 hp',
          sourceUrl: 'https://ford.example/spec',
        },
        {
          name: 'Torque',
          value: '310 lb-pie',
          sourceUrl: 'https://ford.example/spec',
        },
      ],
      featureCount: 1,
      featuresOmitted: 0,
      features: [{name: 'Feature', sourceUrl: 'https://ford.example/spec'}],
    };

    expect(checkVehicleDetailCompleteness(actual, expected)).toMatchObject({
      complete: true,
      expectedSpecifications: 2,
      returnedSpecifications: 2,
      expectedFeatures: 1,
      returnedFeatures: 1,
      errors: [],
    });
  });

  it('flags a response that truncates specs or features even if it reports a larger count', () => {
    const completeness = checkVehicleDetailCompleteness(
      {
        specificationCount: 3,
        specificationsOmitted: 1,
        specifications: [{name: 'Motor', value: '270 hp'}],
        featureCount: 2,
        featuresOmitted: 0,
        features: [{name: 'Air bags'}, {name: 'Camera'}],
      },
      {model: 'RANGER', year: 2027, specificationCount: 3, featureCount: 2},
    );

    expect(completeness.complete).toBe(false);
    expect(completeness.errors).toContain(
      'returned 1 specifications; catalog contains 3',
    );
  });

  it('checks every stored model-year when the buyer does not specify a year', () => {
    const expected = [
      {model: 'RANGER', year: 2027, specificationCount: 1, featureCount: 1},
      {model: 'RANGER', year: 2026, specificationCount: 2, featureCount: 1},
    ];
    const response = {
      status: 'available_model_year_options',
      options: expected.map(vehicle => ({
        ...vehicle,
        specificationCount: vehicle.specificationCount,
        specificationsOmitted: 0,
        specifications: Array.from(
          {length: vehicle.specificationCount},
          () => ({}),
        ),
        featureCount: vehicle.featureCount,
        featuresOmitted: 0,
        features: [{}],
      })),
    };

    expect(
      checkVehicleModelYearOptionsCompleteness(response, expected),
    ).toMatchObject({
      complete: true,
      expectedModelYears: 2,
      returnedModelYears: 2,
      errors: [],
    });
    expect(
      checkVehicleModelYearOptionsCompleteness(
        {...response, options: [response.options[0]]},
        expected,
      ).complete,
    ).toBe(false);
  });
});
