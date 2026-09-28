import {describe, expect, it, vi} from 'vitest';
import {CatalogRepository} from '../../src/storage/catalog-repository.js';

describe('CatalogRepository', () => {
  it('stores feature rows against the model year and source page', async () => {
    const calls: Array<{sql: string; values?: unknown[]}> = [];
    const client = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        calls.push({sql, values});
        return {rows: []};
      }),
      release: vi.fn(),
    };
    const pool = {connect: vi.fn().mockResolvedValue(client)};
    const repository = new CatalogRepository(pool as never);

    await repository.upsertFeatures(
      {modelId: 'model-1', modelYearId: 'year-1'},
      [
        {
          name: 'Cuenta con pantalla y conectividad.',
          category: 'tecnología',
        },
      ],
      {id: 12} as never,
    );

    expect(
      calls.some(call => call.sql.includes('INSERT INTO ford.features')),
    ).toBe(true);
    expect(calls.at(-2)?.values).toEqual([
      'year-1',
      'tecnología',
      'Cuenta con pantalla y conectividad.',
      'cuenta_con_pantalla_y_conectividad',
      null,
      12,
    ]);
    expect(client.release).toHaveBeenCalledOnce();
  });
});
