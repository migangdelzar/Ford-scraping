import {describe, expect, it, vi} from 'vitest';
import {
  CatalogStatusService,
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
  it('compares structured specifications and features when available', async () => {
    const query = vi.fn().mockResolvedValue({rows: []});
    const service = new VehicleQueryService({query} as never);

    await service.compare(['year-1', 'year-2']);

    expect(query.mock.calls[0][0]).toContain('ford.specifications');
    expect(query.mock.calls[0][0]).toContain('ford.features');
  });
});
