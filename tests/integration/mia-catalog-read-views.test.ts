import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import type {Pool} from 'pg';
import {createPool, runMigrations} from '../../src/storage/database.js';
import {integrationDatabaseUrl} from './integration-database.js';

const databaseUrl = integrationDatabaseUrl();
let pool: Pool;

describe('MÍA read-only catalog views', () => {
  beforeAll(async () => {
    pool = createPool(databaseUrl);
    await runMigrations(pool);
    await pool.query(
      'TRUNCATE ford.offers, ford.features, ford.specifications, ford.variants, ford.model_year_categories, ford.categories, ford.model_years, ford.models, ford.pages, ford.sources CASCADE',
    );
    await seedCatalog();
  });

  afterAll(async () => {
    await pool.end();
  });

  it('returns price and model links with the source crawl observation time', async () => {
    const result = await pool.query(
      `SELECT model, year, price::text, currency, model_page_url, price_source_url,
              observed_at::text
       FROM ford_read.vehicle_search_v1
       WHERE normalized_name = 'mia-contract-ranger'`,
    );

    expect(result.rows).toEqual([
      {
        model: 'MIA Contract Ranger',
        year: 2027,
        price: '899000.00',
        currency: 'MXN',
        model_page_url: 'https://www.ford.mx/vehiculos/ranger/',
        price_source_url: 'https://www.ford.mx/vehiculos/ranger/precio/',
        observed_at: '2026-10-16 10:00:00+00',
      },
    ]);
  });

  it('returns only source-backed detail facts with their source and observed time', async () => {
    const result = await pool.query(
      `SELECT fact_type, fact_name, fact_value, source_url, observed_at::text
       FROM ford_read.vehicle_facts_v1
       WHERE model = 'MIA Contract Ranger' AND year = 2027`,
    );

    expect(result.rows).toEqual([
      {
        fact_type: 'specification',
        fact_name: 'Potencia',
        fact_value: '270 hp',
        source_url: 'https://www.ford.mx/vehiculos/ranger/ficha-tecnica/',
        observed_at: '2026-10-16 10:00:00+00',
      },
    ]);
  });

  it('returns dealer promotions with validity dates and source evidence', async () => {
    const result = await pool.query(
      `SELECT model, year, title, valid_from::text, valid_until::text,
              source_url, observed_at::text
       FROM ford_read.promotions_v1
       WHERE model = 'MIA Contract Ranger'`,
    );

    expect(result.rows).toEqual([
      {
        model: 'MIA Contract Ranger',
        year: 2027,
        title: 'MIA Contract Promotion',
        valid_from: '2026-10-01',
        valid_until: '2026-10-31',
        source_url: 'https://www.ford.mx/promociones/ranger/',
        observed_at: '2026-10-16 10:00:00+00',
      },
    ]);
  });
});

async function seedCatalog(): Promise<void> {
  const source = await pool.query<{id: number}>(
    `INSERT INTO ford.sources (base_url, name)
     VALUES ('https://www.ford.mx', 'MIA contract test') RETURNING id`,
  );
  const pages = await pool.query<{id: number; page_type: string}>(
    `INSERT INTO ford.pages (source_id, url, canonical_url, page_type, crawled_at)
     VALUES
       ($1, 'https://www.ford.mx/vehiculos/ranger/', 'https://www.ford.mx/vehiculos/ranger/', 'model', '2026-10-16T10:00:00Z'),
       ($1, 'https://www.ford.mx/vehiculos/ranger/precio/', 'https://www.ford.mx/vehiculos/ranger/precio/', 'catalog', '2026-10-16T10:00:00Z'),
       ($1, 'https://www.ford.mx/vehiculos/ranger/ficha-tecnica/', 'https://www.ford.mx/vehiculos/ranger/ficha-tecnica/', 'technical_sheet', '2026-10-16T10:00:00Z'),
       ($1, 'https://www.ford.mx/promociones/ranger/', 'https://www.ford.mx/promociones/ranger/', 'promotion', '2026-10-16T10:00:00Z')
     RETURNING id, page_type`,
    [source.rows[0].id],
  );
  const pageId = (type: string) =>
    pages.rows.find(page => page.page_type === type)!.id;
  const model = await pool.query<{id: string}>(
    `INSERT INTO ford.models (name, normalized_name)
     VALUES ('MIA Contract Ranger', 'mia-contract-ranger') RETURNING id`,
  );
  const modelYear = await pool.query<{id: string}>(
    `INSERT INTO ford.model_years (model_id, model_year, source_page_id, starting_price, currency)
     VALUES ($1, 2027, $2, 899000, 'MXN') RETURNING id`,
    [model.rows[0].id, pageId('catalog')],
  );
  const variant = await pool.query<{id: string}>(
    `INSERT INTO ford.variants (model_year_id, name, normalized_name, trim_name, source_page_id)
     VALUES ($1, 'XLT Gasolina 4x2', 'xlt-gasolina-4x2', 'XLT Gasolina 4x2', $2)
     RETURNING id`,
    [modelYear.rows[0].id, pageId('model')],
  );
  await pool.query(
    `INSERT INTO ford.specifications
       (variant_id, model_year_id, name, normalized_name, value_text, unit, source_page_id)
     VALUES ($1, $2, 'Potencia', 'potencia', '270 hp', 'hp', $3)`,
    [variant.rows[0].id, modelYear.rows[0].id, pageId('technical_sheet')],
  );
  await pool.query(
    `INSERT INTO ford.offers
       (model_year_id, title, valid_from, valid_until, source_page_id,
        offer_type, content_hash, currency, requires_credit_approval)
     VALUES ($1, 'MIA Contract Promotion', '2026-10-01', '2026-10-31', $2,
             'promotion', 'mia-contract-promotion-hash', 'MXN', false)`,
    [modelYear.rows[0].id, pageId('promotion')],
  );
}
