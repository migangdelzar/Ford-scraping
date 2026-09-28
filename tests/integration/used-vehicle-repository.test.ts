import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import type {Pool} from 'pg';
import {createPool} from '../../src/storage/database.js';
import {
  PageRepository,
  type FetchedPage,
} from '../../src/storage/page-repository.js';
import {UsedVehicleRepository} from '../../src/storage/used-vehicle-repository.js';
import type {UsedVehicleCandidate} from '../../src/domain/contracts.js';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgres://postgres:postgres@localhost:5432/ford';
let pool: Pool;

const page: FetchedPage = {
  sourceBaseUrl: 'https://www.forduruapan.mx',
  sourceName: 'Ford Uruapan',
  url: 'https://www.forduruapan.mx/Seminuevos/',
  canonicalUrl: 'https://www.forduruapan.mx/Seminuevos/',
  pageType: 'used_vehicle',
  status: 200,
  contentType: 'text/html',
  title: 'Seminuevos',
  rawHtml: '<main>inventory</main>',
  extractedText: 'inventory',
  contentHash: 'used-vehicle-page',
  metadata: {},
};

const vehicle = (inventoryId: string, price: number): UsedVehicleCandidate => ({
  inventoryId,
  title: `Ford Territory ${inventoryId}`,
  price,
  currency: 'MXN',
  mileageKm: 30332,
  transmission: 'automatic',
  imageUrls: ['https://www.forduruapan.mx/image.jpg'],
  detailUrl: `https://www.forduruapan.mx/Seminuevos/FORD/TERRITORY/2023/${inventoryId}`,
  sourceUrl: page.url,
  metadata: {},
});

describe('UsedVehicleRepository', () => {
  beforeAll(async () => {
    pool = createPool(databaseUrl);
    await pool.query('TRUNCATE ford.used_vehicles, ford.sync_runs CASCADE');
  });

  afterAll(async () => {
    await pool.end();
  });

  it('upserts a complete snapshot and deactivates missing inventory', async () => {
    const pages = new PageRepository(pool);
    const storedPage = (await pages.upsert(page)).page;
    const repository = new UsedVehicleRepository(pool);

    await repository.syncSnapshot(
      [vehicle('514854', 530000), vehicle('514883', 870000)],
      storedPage,
    );
    const summary = await repository.syncSnapshot(
      [vehicle('514854', 525000)],
      storedPage,
    );

    expect(summary).toMatchObject({seen: 1, deactivated: 1, changed: 1});
    const rows = await pool.query(
      'SELECT inventory_id, price, active FROM ford.used_vehicles ORDER BY inventory_id',
    );
    expect(rows.rows).toEqual([
      {inventory_id: '514854', price: '525000.00', active: true},
      {inventory_id: '514883', price: '870000.00', active: false},
    ]);
  });

  it('does not deactivate inventory when the snapshot is incomplete', async () => {
    const repository = new UsedVehicleRepository(pool);
    const storedPage = (await new PageRepository(pool).getByUrl(page.url))!;

    await repository.syncSnapshot([], storedPage, {complete: false});
    const result = await pool.query(
      'SELECT count(*)::int AS count FROM ford.used_vehicles WHERE active',
    );
    expect(result.rows[0].count).toBe(1);
  });
});
