import {describe, expect, it, vi} from 'vitest';
import {SearchRepository} from '../../src/storage/search-repository.js';

describe('SearchRepository offer candidates', () => {
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
