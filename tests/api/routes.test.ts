import {describe, expect, it, vi} from 'vitest';
import {buildApiApp, type ApiServices} from '../../src/api/app.js';

describe('REST API', () => {
  it('passes validated search filters to the shared search service', async () => {
    const services: ApiServices = {
      search: {
        search: vi.fn().mockResolvedValue({
          query: 'SUV familiar',
          results: [],
          semanticSearch: 'unavailable',
        }),
      },
      vehicles: {
        getByModelYear: vi.fn(),
        compare: vi.fn(),
      },
      health: vi
        .fn()
        .mockResolvedValue({database: 'ok', embeddings: 'pending'}),
    };
    const app = buildApiApp(services);
    const response = await app.inject({
      method: 'POST',
      url: '/search',
      payload: {
        query: 'SUV familiar',
        filters: {maxPrice: 800000, modelYear: 2026},
      },
    });
    expect(response.statusCode).toBe(200);
    expect(services.search.search).toHaveBeenCalledWith({
      query: 'SUV familiar',
      filters: {maxPrice: 800000, modelYear: 2026},
    });
  });

  it('rejects an invalid search limit', async () => {
    const services: ApiServices = {
      search: {search: vi.fn()},
      vehicles: {getByModelYear: vi.fn(), compare: vi.fn()},
      health: vi.fn(),
    };
    const app = buildApiApp(services);
    const response = await app.inject({
      method: 'POST',
      url: '/search',
      payload: {query: 'SUV', limit: 500},
    });
    expect(response.statusCode).toBe(400);
    expect(services.search.search).not.toHaveBeenCalled();
  });
});
