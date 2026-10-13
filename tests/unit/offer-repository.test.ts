import {describe, expect, it, vi} from 'vitest';
import {OfferRepository} from '../../src/storage/offer-repository.js';

describe('OfferRepository', () => {
  it('uses a source promotion id to update an existing offer', async () => {
    const calls: Array<{sql: string; values?: unknown[]}> = [];
    const client = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        calls.push({sql, values});
        if (sql.includes('SELECT id FROM ford.offers')) {
          return {rowCount: 1, rows: [{id: 'existing-offer'}]};
        }
        return {rowCount: 1, rows: []};
      }),
      release: vi.fn(),
    };
    const repository = new OfferRepository({
      connect: vi.fn().mockResolvedValue(client),
    } as never);

    const result = await repository.upsertOffer(
      {
        title: 'Ranger 2027',
        offerType: 'promotion',
        currency: 'MXN',
        sourceUrl: 'https://www.forduruapan.mx/Promociones/',
        requiresCreditApproval: true,
        metadata: {externalPromotionId: '2261'},
        taxRatePercent: 16,
        openingCommissionRatePercent: 3,
        maximumDownPaymentPercent: 80,
        lifeInsurancePrice: 12500,
      },
      {id: 91} as never,
    );

    expect(result.offerId).toBe('existing-offer');
    expect(
      calls.find(call => call.sql.includes('SELECT id FROM ford.offers')),
    ).toMatchObject({
      sql: expect.stringContaining('external_key = $2'),
      values: ['promotion', '2261'],
    });
    expect(client.release).toHaveBeenCalledOnce();
    expect(
      calls
        .find(call => call.sql.includes('UPDATE ford.offers'))
        ?.values?.slice(-4),
    ).toEqual([16, 3, 80, 12500]);
  });
});
