import {describe, expect, it, vi} from 'vitest';
import {
  CatalogStatusService,
  ComparisonService,
  PageLinkService,
  PromotionService,
  VehicleQueryService,
} from '../../src/storage/read-services.js';

describe('CatalogStatusService', () => {
  it('reports the latest crawl time', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          pages: 18,
          vehicles: 40,
          documents: 842,
          embedded: 842,
          pending: 0,
          latest_crawled_at: '2026-09-27T12:00:00.000Z',
        },
      ],
    });
    const service = new CatalogStatusService({query} as never);

    await expect(service.status()).resolves.toMatchObject({
      latest_crawled_at: '2026-09-27T12:00:00.000Z',
    });
  });
});

describe('PromotionService', () => {
  it('excludes year-linked promotions outside model years 2025 through 2027', async () => {
    const query = vi.fn().mockResolvedValue({rows: []});
    const service = new PromotionService({query} as never);

    await service.list({});

    expect(query.mock.calls[0][0]).toContain(
      '(o.model_year_id IS NULL OR my.model_year BETWEEN $5 AND $6)',
    );
    expect(query.mock.calls[0][1].slice(-2)).toEqual([2025, 2027]);
  });

  it('marks undated promotions as unknown and surfaces term conflicts', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: 'offer-1',
          valid_from: null,
          valid_until: null,
          metadata: {termConflict: {labelMonths: 24, structuredMonths: 72}},
        },
      ],
    });
    const service = new PromotionService({query} as never);

    await expect(service.list({asOf: '2026-09-27'})).resolves.toEqual([
      expect.objectContaining({
        validityStatus: 'unknown',
        dataQualityWarnings: [
          'El nombre del plan indica 24 meses, pero el plazo estructurado es 72 meses. Confirmar con el distribuidor.',
        ],
      }),
    ]);
  });
});

describe('VehicleQueryService', () => {
  it('returns only source-backed facts for the exact requested trim', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM ford.model_years my')) {
        return {
          rowCount: 1,
          rows: [
            {
              model_id: 'model-1',
              model: 'RANGER',
              model_year_id: 'year-1',
              year: 2027,
              price: 775_000,
              currency: 'MXN',
              model_page_url: 'https://ford.example/RANGER/27',
              source_url: 'https://ford.example/RANGER/27',
              source_page_type: 'model',
            },
          ],
        };
      }
      if (
        sql.includes('FROM ford.variants v') &&
        sql.includes('normalized_name = ANY')
      ) {
        return {
          rowCount: 1,
          rows: [
            {
              id: 'trim-1',
              name: 'XL Gasolina 4x2',
              trim_name: 'XL Gasolina 4x2',
              price: 775_000,
              currency: 'MXN',
              source_url:
                'https://ford.example/RANGER/27/Comparativo/XL-GASOLINA-4X2/',
            },
          ],
        };
      }
      if (
        sql.includes('FROM ford.specifications s') &&
        sql.includes('s.variant_id = $2')
      ) {
        return {
          rows: [
            {
              name: 'Motor',
              value_text: '2.3L Gasolina',
              source_url:
                'https://ford.example/RANGER/27/Comparativo/XL-GASOLINA-4X2/',
            },
          ],
        };
      }
      if (sql.includes('FROM ford.specifications s')) {
        return {rows: [{url: 'https://ford.example/RANGER/27/Ficha-Tecnica/'}]};
      }
      if (sql.includes('FROM ford.features f')) return {rows: []};
      if (sql.includes('FROM ford.images i')) return {rows: []};
      if (sql.includes('FROM ford.variants v')) {
        return {
          rows: [
            {
              id: 'trim-1',
              name: 'XL Gasolina 4x2',
              trim_name: 'XL Gasolina 4x2',
              source_url: 'https://ford.example/RANGER/27',
            },
          ],
        };
      }
      if (sql.includes('FROM ford.comparisons c')) {
        return {
          rows: [
            {
              trim_name: 'XL Gasolina 4x2',
              target_url:
                'https://ford.example/RANGER/27/Comparativo/XL-GASOLINA-4X2/',
            },
          ],
        };
      }
      return {rows: []};
    });
    const service = new VehicleQueryService({query} as never);

    const vehicle = (await service.getByModelYear(
      'Ranger',
      2027,
      'XL Gasolina 4x2',
    )) as {
      trim_status: string;
      trim_name: string;
      price: number;
      technical_sheet_url: string;
      specifications: Array<{
        name: string;
        value_text: string;
        source_url: string;
      }>;
      comparison_urls: Array<{url: string}>;
    };

    expect(vehicle).toMatchObject({
      trim_status: 'found',
      trim_name: 'XL Gasolina 4x2',
      price: 775_000,
      technical_sheet_url: 'https://ford.example/RANGER/27/Ficha-Tecnica/',
      specifications: [{name: 'Motor', value_text: '2.3L Gasolina'}],
      comparison_urls: [
        {url: 'https://ford.example/RANGER/27/Comparativo/XL-GASOLINA-4X2/'},
      ],
    });
    expect(
      query.mock.calls.some(([sql]) => sql.includes('s.variant_id = $2')),
    ).toBe(true);
  });

  it('does not leak model-level price or grouped specifications when the trim is missing', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM ford.model_years my')) {
        return {
          rowCount: 1,
          rows: [
            {
              model_id: 'model-1',
              model: 'RANGER',
              model_year_id: 'year-1',
              year: 2027,
              price: 775_000,
              currency: 'MXN',
              model_page_url: 'https://ford.example/RANGER/27',
              source_url: 'https://ford.example/RANGER/27',
              source_page_type: 'model',
            },
          ],
        };
      }
      if (sql.includes('normalized_name = ANY')) return {rows: []};
      if (sql.includes('FROM ford.variants v'))
        return {rows: [{name: 'XL Gasolina 4x2'}]};
      if (sql.includes('FROM ford.comparisons c')) {
        return {
          rows: [
            {
              trim_name: 'XL Gasolina 4x2',
              target_url:
                'https://ford.example/RANGER/27/Comparativo/XL-GASOLINA-4X2/',
            },
          ],
        };
      }
      if (sql.includes('FROM ford.specifications s')) {
        return {rows: [{url: 'https://ford.example/RANGER/27/Ficha-Tecnica/'}]};
      }
      return {rows: []};
    });
    const service = new VehicleQueryService({query} as never);

    const vehicle = (await service.getByModelYear(
      'Ranger',
      2027,
      'Limited',
    )) as {
      trim_status: string;
      price: number | null;
      specifications: unknown[];
      comparison_urls: Array<{url: string}>;
    };

    expect(vehicle).toMatchObject({
      trim_status: 'not_found',
      price: null,
      specifications: [],
      comparison_urls: [
        {url: 'https://ford.example/RANGER/27/Comparativo/XL-GASOLINA-4X2/'},
      ],
    });
  });

  it('limits exact lookup and available model years to 2025 through 2027', async () => {
    const query = vi.fn().mockResolvedValue({rows: []});
    const service = new VehicleQueryService({query} as never);

    await service.getAvailableModelYears('Ranger');
    expect(query.mock.calls[0][0]).toContain('my.model_year BETWEEN $2 AND $3');
    expect(query.mock.calls[0][1]).toEqual(['ranger', 2025, 2027]);

    await expect(service.getByModelYear('Ranger', 2024)).resolves.toBeNull();
    expect(query.mock.calls[1][0]).toContain('my.model_year BETWEEN $3 AND $4');
    expect(query.mock.calls[1][1]).toEqual(['ranger', 2024, 2025, 2027]);
  });

  it('limits trim, year, and competitor comparisons to 2025 through 2027', async () => {
    const query = vi.fn().mockResolvedValue({rows: [], rowCount: 0});
    const service = new ComparisonService({query} as never);

    await service.compareTrims('Ranger', 2024, ['XL', 'XLT']);
    expect(query.mock.calls[0][0]).toContain('my.model_year BETWEEN $4 AND $5');
    expect(query.mock.calls[0][1].slice(-2)).toEqual([2025, 2027]);

    await service.compareModelYears('Ranger', [2024, 2026]);
    expect(query.mock.calls[1][0]).toContain('my.model_year BETWEEN $3 AND $4');
    expect(query.mock.calls[1][1].slice(-2)).toEqual([2025, 2027]);

    await service.getVariantComparisons('Expedition', 2028);
    expect(query.mock.calls[2][0]).toContain('my.model_year BETWEEN $3 AND $4');
    expect(query.mock.calls[2][1].slice(-2)).toEqual([2025, 2027]);
    expect(query.mock.calls[3][0]).toContain('my.model_year BETWEEN $4 AND $5');
    expect(query.mock.calls[3][1].slice(-2)).toEqual([2025, 2027]);
  });

  it('returns model years already stored for the exact normalized model', async () => {
    const query = vi
      .fn()
      .mockResolvedValue({rows: [{model_year: 2027}, {model_year: 2026}]});
    const service = new VehicleQueryService({query} as never);

    await expect(
      service.getAvailableModelYears('F-150 Híbrida'),
    ).resolves.toEqual([2027, 2026]);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('FROM ford.model_years'),
      ['f150hibrida', 2025, 2027],
    );
  });

  it('compares structured specifications and features when available', async () => {
    const query = vi.fn().mockResolvedValue({rows: []});
    const service = new VehicleQueryService({query} as never);

    await service.compare(['year-1', 'year-2']);

    expect(query.mock.calls[0][0]).toContain('ford.specifications');
    expect(query.mock.calls[0][0]).toContain('ford.features');
  });

  it('does not report placeholders or grouped trim values as year changes', async () => {
    const specifications = [
      {
        name: 'Defensa',
        normalizedName: 'defensa',
        value: '- | Cromada',
        sourceUrl: 'old',
      },
      {
        name: 'Altura',
        normalizedName: 'altura',
        value: '1985 | 1981',
        sourceUrl: 'old',
      },
      {
        name: 'Potencia',
        normalizedName: 'potencia',
        value: '400 HP',
        sourceUrl: 'old',
      },
    ];
    const query = vi.fn().mockResolvedValueOnce({
      rows: [
        {
          model: 'EXPEDITION',
          year: 2026,
          price: 100,
          price_source_url: 'price-old',
          specifications,
        },
        {
          model: 'EXPEDITION',
          year: 2027,
          price: 120,
          price_source_url: 'price-new',
          specifications: [
            {
              name: 'Defensa',
              normalizedName: 'defensa',
              value: '-',
              sourceUrl: 'new',
            },
            {
              name: 'Altura',
              normalizedName: 'altura',
              value: '1985 | 1981 | 1979',
              sourceUrl: 'new',
            },
            {
              name: 'Potencia',
              normalizedName: 'potencia',
              value: '440 HP',
              sourceUrl: 'new',
            },
          ],
        },
      ],
    });
    const service = new ComparisonService({query} as never);

    const comparison = (await service.compareModelYears(
      'EXPEDITION',
      [2026, 2027],
    )) as {
      yearPairs: Array<{changedFacts: Array<{normalizedName: string}>}>;
    };

    expect(
      comparison.yearPairs[0].changedFacts.map(fact => fact.normalizedName),
    ).toEqual(['potencia']);
  });

  it('compares shared trim specifications when model-year facts are stored per variant', async () => {
    const query = vi.fn().mockResolvedValueOnce({
      rows: [
        {
          model: 'EXPEDITION',
          year: 2025,
          price: 100,
          currency: 'MXN',
          specifications: [],
          active_promotions: [],
          variants: [
            {
              trim: 'Platinum',
              normalizedTrim: 'platinum',
              price: 100,
              sourceUrl: 'old-trim',
              specifications: [
                {
                  name: 'Potencia',
                  normalizedName: 'potencia',
                  value: '400 HP',
                  sourceUrl: 'old-spec',
                },
                {
                  name: 'Rines',
                  normalizedName: 'rines',
                  value: '20 pulgadas',
                  sourceUrl: 'old-spec',
                },
              ],
            },
            {
              trim: 'Legacy',
              normalizedTrim: 'legacy',
              price: 90,
              specifications: [],
            },
          ],
        },
        {
          model: 'EXPEDITION',
          year: 2026,
          price: 110,
          currency: 'MXN',
          specifications: [],
          active_promotions: [],
          variants: [
            {
              trim: 'Platinum',
              normalizedTrim: 'platinum',
              price: 110,
              sourceUrl: 'new-trim',
              specifications: [
                {
                  name: 'Potencia',
                  normalizedName: 'potencia',
                  value: '440 HP',
                  sourceUrl: 'new-spec',
                },
                {
                  name: 'Rines',
                  normalizedName: 'rines',
                  value: '20 pulgadas',
                  sourceUrl: 'new-spec',
                },
              ],
            },
            {
              trim: 'Ultimate',
              normalizedTrim: 'ultimate',
              price: 120,
              specifications: [],
            },
          ],
        },
      ],
    });
    const service = new ComparisonService({query} as never);

    const comparison = (await service.compareModelYears(
      'EXPEDITION',
      [2025, 2026],
    )) as {
      yearPairs: Array<{
        changedFacts: unknown[];
        trimChanges: Array<{
          trim: string;
          changedFacts: Array<{normalizedName: string}>;
          sourceUrls: {from: string; to: string};
        }>;
        unmatchedTrims: {from: string[]; to: string[]};
      }>;
    };

    expect(comparison.yearPairs[0].changedFacts).toEqual([]);
    expect(comparison.yearPairs[0].trimChanges).toEqual([
      expect.objectContaining({
        trim: 'Platinum',
        changedFacts: [expect.objectContaining({normalizedName: 'potencia'})],
        sourceUrls: {from: 'old-trim', to: 'new-trim'},
      }),
    ]);
    expect(comparison.yearPairs[0].unmatchedTrims).toEqual({
      from: ['Legacy'],
      to: ['Ultimate'],
    });
    expect(query.mock.calls[0][0]).toContain('variant_specs');
  });

  it('excludes asset links from the default page-link list and supports opting in', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{source_page_id: 'page-1', source_url: 'ford.example'}],
        rowCount: 1,
      })
      .mockResolvedValueOnce({rows: [], rowCount: 0})
      .mockResolvedValueOnce({rows: [{count: '4'}]});
    const service = new PageLinkService({query} as never);

    const result = await service.getPageLinks('ford.example');

    expect(query.mock.calls[1][0]).toContain('$4::boolean');
    expect(query.mock.calls[1][0]).toContain('DISTINCT ON (target_url)');
    expect(query.mock.calls[1][0]).toContain("target_url ~* '/Comparativo/'");
    expect(query.mock.calls[1][0]).toContain('ford.comparisons');
    expect(query.mock.calls[1][1]).toEqual(['page-1', 0, 100, false]);
    expect(query.mock.calls[2][0]).toContain('count(DISTINCT candidate_url)');
    expect(query.mock.calls[2][0]).toContain('ford.comparisons');
    expect(query.mock.calls[2][1]).toEqual(['page-1', false]);
    expect(result).toMatchObject({totalLinks: 4});
  });

  it('marks mismatched competitor source values as excluded from paired facts', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          model: 'EXPEDITION',
          year: 2027,
          ford_trim: 'King Ranch Max',
          competitor_make: 'Chevrolet',
          competitor_model: 'Tahoe',
          comparison_url: 'https://ford.example/compare',
          model_page_url: 'https://ford.example/EXPEDITION/27/',
          technical_sheet_url:
            'https://ford.example/EXPEDITION/27/Ficha-Tecnica/',
          raw_data: {
            rows: [
              {name: 'Sensor', fordValue: 'Si', competitorValue: 'No'},
              {
                name: 'Rendimiento de combustible',
                fordValue: 'Si',
                competitorValue: '11.6',
              },
            ],
          },
        },
      ],
      rowCount: 1,
    });
    const service = new ComparisonService({query} as never);

    const result = (await service.getVariantComparisons(
      'EXPEDITION',
      2027,
      'King Ranch Max',
    )) as {
      modelPageUrl: string;
      technicalSheetUrl: string;
      comparisons: Array<{
        paired_facts: Array<{name: string}>;
        excluded_source_rows: Array<{name: string; excludedReason: string}>;
        raw_data: {rows: Array<{name: string}>};
        comparison_url: string;
      }>;
    };

    expect(result.comparisons[0]).toMatchObject({
      paired_facts: [{name: 'Sensor'}],
      excluded_source_rows: [{name: 'Rendimiento de combustible'}],
      raw_data: {rows: [{name: 'Sensor'}]},
      comparison_url: 'https://ford.example/compare',
    });
    expect(result.modelPageUrl).toBe('https://ford.example/EXPEDITION/27/');
    expect(result.technicalSheetUrl).toBe(
      'https://ford.example/EXPEDITION/27/Ficha-Tecnica/',
    );
    expect(
      result.comparisons[0].excluded_source_rows[0].excludedReason,
    ).toContain('different value types');
  });

  it('keeps malformed yes/no quantitative trim values out of the comparison', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          trim: 'Active',
          price: 100,
          price_source_url: 'active-price',
          specifications: [
            {
              name: 'Precio',
              normalizedName: 'precio',
              value: '$100',
              sourceUrl: 'active',
            },
            {
              name: 'Sensor',
              normalizedName: 'sensor',
              value: 'Si',
              sourceUrl: 'active',
            },
            {
              name: 'Rendimiento de combustible',
              normalizedName: 'rendimiento_combustible',
              value: 'Si',
              sourceUrl: 'active',
            },
          ],
        },
        {
          trim: 'King Ranch Max',
          price: 200,
          price_source_url: 'king-price',
          specifications: [
            {
              name: 'Precio',
              normalizedName: 'precio',
              value: '$200',
              sourceUrl: 'king',
            },
            {
              name: 'Sensor',
              normalizedName: 'sensor',
              value: 'No',
              sourceUrl: 'king',
            },
            {
              name: 'Rendimiento de combustible',
              normalizedName: 'rendimiento_combustible',
              value: '9.1',
              sourceUrl: 'king',
            },
          ],
        },
      ],
    });
    const service = new ComparisonService({query} as never);

    const result = (await service.compareTrims('EXPEDITION', 2027, [
      'Active',
      'King Ranch Max',
    ])) as {
      foundTrims: Array<{
        trim: string;
        specifications: Array<{normalizedName: string}>;
        excluded_source_facts: Array<{name: string}>;
      }>;
      trimPairs: Array<{
        sharedFactDifferences: Array<{normalizedName: string}>;
      }>;
    };

    expect(
      result.foundTrims[0].specifications.map(fact => fact.normalizedName),
    ).toEqual(['precio', 'sensor']);
    expect(result.foundTrims[0].excluded_source_facts).toEqual([
      expect.objectContaining({name: 'Rendimiento de combustible'}),
    ]);
    expect(
      result.trimPairs[0].sharedFactDifferences.map(
        fact => fact.normalizedName,
      ),
    ).toEqual(['sensor']);
  });

  it('returns the model page alongside exact trim comparison sources', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          trim: 'Active',
          model_page_url: 'https://ford.example/EXPEDITION/27/',
          technical_sheet_url:
            'https://ford.example/EXPEDITION/27/Ficha-Tecnica/',
          comparison_url:
            'https://ford.example/EXPEDITION/27/Comparativo/ACTIVE/',
          specifications: [],
        },
        {
          trim: 'King Ranch Max',
          model_page_url: 'https://ford.example/EXPEDITION/27/',
          technical_sheet_url:
            'https://ford.example/EXPEDITION/27/Ficha-Tecnica/',
          comparison_url:
            'https://ford.example/EXPEDITION/27/Comparativo/KING-RANCH-MAX/',
          specifications: [],
        },
      ],
    });
    const service = new ComparisonService({query} as never);

    const result = (await service.compareTrims('EXPEDITION', 2027, [
      'Active',
      'King Ranch Max',
    ])) as {
      modelPageUrl: string;
      technicalSheetUrl: string;
      foundTrims: Array<{comparison_url: string}>;
    };

    expect(result.modelPageUrl).toBe('https://ford.example/EXPEDITION/27/');
    expect(result.technicalSheetUrl).toBe(
      'https://ford.example/EXPEDITION/27/Ficha-Tecnica/',
    );
    expect(result.foundTrims.map(trim => trim.comparison_url)).toEqual([
      'https://ford.example/EXPEDITION/27/Comparativo/ACTIVE/',
      'https://ford.example/EXPEDITION/27/Comparativo/KING-RANCH-MAX/',
    ]);
    expect(query.mock.calls[0][0]).toContain('model_page_url');
  });

  it('accepts trim selectors prefixed with the requested model name', async () => {
    const query = vi.fn().mockResolvedValue({rows: []});
    const service = new ComparisonService({query} as never);

    await service.compareTrims('EXPEDITION', 2027, [
      'Expedition Active',
      'Expedition King Ranch Max',
    ]);

    expect(query.mock.calls[0][1]).toEqual([
      'expedition',
      2027,
      ['expeditionactive', 'active', 'expeditionkingranchmax', 'kingranchmax'],
      2025,
      2027,
    ]);
  });

  it('matches trim names stored with the model prefix as well as the trim suffix', async () => {
    const query = vi.fn().mockResolvedValue({rows: []});
    const service = new ComparisonService({query} as never);

    await service.compareTrims('LOBO RAPTOR', 2026, ['Lobo Raptor High', 'R']);

    expect(query.mock.calls[0][1]).toEqual([
      'loboraptor',
      2026,
      ['loboraptorhigh', 'high', 'r'],
      2025,
      2027,
    ]);
  });
});
