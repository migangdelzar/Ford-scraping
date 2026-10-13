import {describe, expect, it, vi} from 'vitest';
import {SearchRepository} from '../../src/storage/search-repository.js';

describe('SearchRepository offer candidates', () => {
  it('limits vehicle and year-linked offer candidates to model years 2025 through 2027', async () => {
    const query = vi.fn().mockResolvedValue({rows: []});
    const repository = new SearchRepository({query} as never);

    await repository.findCandidates();
    expect(query.mock.calls[0][0]).toContain('my.model_year BETWEEN $8 AND $9');
    expect(query.mock.calls[0][1].slice(-2)).toEqual([2025, 2027]);

    await repository.findOfferCandidates();
    expect(query.mock.calls[1][0]).toContain(
      '(o.model_year_id IS NULL OR my.model_year BETWEEN $12 AND $13)',
    );
    expect(query.mock.calls[1][1].slice(-2)).toEqual([2025, 2027]);
  });

  it('normalizes Ford SUV category aliases and omits police fleet models from general results', async () => {
    const query = vi.fn().mockResolvedValue({rows: []});
    const repository = new SearchRepository({query} as never);

    await repository.findCandidates({category: 'SUVs & Crossovers'});

    expect(query.mock.calls[0][0]).toContain(
      "c.normalized_name IN ('suvs & crossovers', 'suvs y crossovers')",
    );
    expect(query.mock.calls[0][0]).toContain(
      "m.normalized_name NOT LIKE '%police%'",
    );
  });

  it('returns unknown validity and term conflict warnings for undated records', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          offer_id: 'offer-1',
          model_year_id: null,
          model_name: 'Explorer',
          model_year: 2026,
          title: 'Explorer 72-month financing',
          offer_type: 'financing',
          provider: null,
          cash_price: 1393600,
          monthly_payment: 21181.46,
          months_without_interest: null,
          annual_interest_rate: 13.79,
          valid_from: null,
          valid_until: null,
          metadata: {termConflict: {labelMonths: 24, structuredMonths: 72}},
          source_url: 'https://www.forduruapan.mx/Financiamiento/',
          crawled_at: '2026-09-24T19:54:50.176Z',
        },
      ],
    });
    const repository = new SearchRepository({query} as never);

    await expect(
      repository.findOfferCandidates({activeOnly: true, asOf: '2026-09-27'}),
    ).resolves.toEqual([
      expect.objectContaining({
        validityStatus: 'unknown',
        dataQualityWarnings: [
          'El nombre del plan indica 24 meses, pero el plazo estructurado es 72 meses. Confirmar con el distribuidor.',
        ],
      }),
    ]);
  });
});

describe('SearchRepository vehicle keyword search', () => {
  it('matches source terms with OR so unstated lifestyle words do not erase exact evidence hits', async () => {
    const query = vi.fn().mockResolvedValue({rows: []});
    const repository = new SearchRepository({query} as never);

    await repository.searchKeyword(
      'SUV familiar con cajuela y uso urbano',
      [{modelYearId: 'year-1'} as never],
      5,
    );

    expect(query.mock.calls[0][0]).toContain('tsvector_to_array');
    expect(query.mock.calls[0][0]).toContain("' | '");
  });
});
