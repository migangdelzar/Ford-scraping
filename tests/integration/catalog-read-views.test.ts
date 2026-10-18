import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import type {Pool} from 'pg';
import {createPool, runMigrations} from '../../src/storage/database.js';
import {integrationDatabaseUrl} from './integration-database.js';

const databaseUrl = integrationDatabaseUrl();
let pool: Pool;

describe('Read-only catalog views', () => {
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
       WHERE normalized_name = 'fixture-contract-ranger'`,
    );

    expect(result.rows).toEqual([
      {
        model: 'Contract Ranger Fixture',
        year: 2027,
        price: '899000.00',
        currency: 'MXN',
        model_page_url: 'https://www.ford.mx/vehiculos/ranger/',
        price_source_url: 'https://www.ford.mx/vehiculos/ranger/precio/',
        observed_at: '2026-10-16 10:00:00+00',
      },
    ]);
  });

  it('returns source-backed detail facts with their source and observed time', async () => {
    const result = await pool.query(
      `SELECT fact_type, fact_name, fact_value, source_url, observed_at::text
       FROM ford_read.vehicle_facts_v1
       WHERE model = 'Contract Ranger Fixture' AND year = 2027`,
    );

    expect(result.rows).toContainEqual({
      fact_type: 'specification',
      fact_name: 'Potencia',
      fact_value: '270 hp',
      source_url: 'https://www.ford.mx/vehiculos/ranger/ficha-tecnica/',
      observed_at: '2026-10-16 10:00:00+00',
    });
  });

  it('returns v2 facts with display trim identity, variant identity, and complete evidence only', async () => {
    const result = await pool.query(
      `SELECT variant_id::text, trim, fact_name, fact_value, source_url, observed_at::text
       FROM ford_read.vehicle_facts_v2
       WHERE model = 'Contract Ranger Fixture' AND year = 2027
       ORDER BY fact_name`,
    );

    expect(result.rows).toContainEqual({
      variant_id: expect.any(String),
      trim: 'XLT Gasolina 4x2',
      fact_name: 'Potencia',
      fact_value: '270 hp',
      source_url: 'https://www.ford.mx/vehiculos/ranger/ficha-tecnica/',
      observed_at: '2026-10-16 10:00:00+00',
    });
    expect(result.rows.every(row => row.source_url && row.observed_at)).toBe(
      true,
    );
    expect(result.rows.map(row => row.fact_name)).not.toContain(
      'Dato sin fuente',
    );
    expect(result.rows.map(row => row.fact_name)).not.toContain(
      'Dato sin fecha',
    );
  });

  it('returns exact trim identity and trim price evidence', async () => {
    const result = await pool.query(
      `SELECT model, year, trim, price::text, price_source_url, observed_at::text
       FROM ford_read.vehicle_variants_v1
       WHERE normalized_model = 'fixture-contract-ranger'
         AND normalized_trim = 'xlt-gasolina-4x2'`,
    );

    expect(result.rows).toEqual([
      {
        model: 'Contract Ranger Fixture',
        year: 2027,
        trim: 'XLT Gasolina 4x2',
        price: '899000.00',
        price_source_url: 'https://www.ford.mx/vehiculos/ranger/precio/',
        observed_at: '2026-10-16 10:00:00+00',
      },
    ]);
  });

  it('returns dealer promotions with validity dates and source evidence', async () => {
    const result = await pool.query(
      `SELECT model, year, title, valid_from::text, valid_until::text,
              offer_type, description, discount_amount::text, conditions,
              source_url, observed_at::text, benefits, term_conflict
       FROM ford_read.promotions_v2
       WHERE model = 'Contract Ranger Fixture'`,
    );

    expect(result.rows).toEqual([
      {
        model: 'Contract Ranger Fixture',
        year: 2027,
        title: 'Contract Promotion Fixture',
        valid_from: '2026-10-01',
        valid_until: '2026-10-31',
        offer_type: 'promotion',
        description: 'Oferta publicada para Ranger.',
        discount_amount: '25000.00',
        conditions: 'Sujeto a términos publicados.',
        source_url: 'https://www.ford.mx/promociones/ranger/',
        observed_at: '2026-10-16 10:00:00+00',
        benefits: ['Bono de $25,000 MXN'],
        term_conflict: null,
      },
    ]);
    const structuredOffers = await pool.query(
      `SELECT offer_type, monthly_payment::text, term_months, source_url, benefits, term_conflict
       FROM ford_read.offers_v1
       WHERE offer_type = 'financing' AND model = 'Contract Ranger Fixture'`,
    );
    expect(structuredOffers.rows).toEqual([
      {
        offer_type: 'financing',
        monthly_payment: '12000.00',
        term_months: 60,
        source_url: 'https://www.ford.mx/promociones/ranger/',
        benefits: ['Bono de $130,000 MXN'],
        term_conflict: {labelMonths: 24, structuredMonths: 72},
      },
    ]);
    const dealerPromotions = await pool.query(
      "SELECT count(*)::int AS count FROM ford_read.promotions_v2 WHERE offer_type = 'financing'",
    );
    expect(dealerPromotions.rows[0].count).toBe(0);
  });

  it('exposes links, images, comparisons, provenance, and aggregate status as read-only views', async () => {
    const rangerPage = await pool.query<{id: number}>(
      "SELECT id FROM ford.pages WHERE url = 'https://www.ford.mx/vehiculos/ranger/'",
    );
    const modelYear = await pool.query<{id: string}>(
      "SELECT id FROM ford.model_years WHERE model_year = 2027 AND model_id = (SELECT id FROM ford.models WHERE normalized_name = 'fixture-contract-ranger')",
    );
    const variant = await pool.query<{id: string}>(
      'SELECT id FROM ford.variants WHERE model_year_id = $1',
      [modelYear.rows[0].id],
    );
    const document = await pool.query<{id: string}>(
      `INSERT INTO ford.documents (model_year_id, page_id, document_type, document_key, title, content, content_hash)
       VALUES ($1, $2, 'vehicle_profile', 'fixture-contract-document', 'Ranger profile fixture', 'Ficha fuente del vehículo.',
               'fixture-contract-document-hash') RETURNING id`,
      [modelYear.rows[0].id, rangerPage.rows[0].id],
    );
    await pool.query(
      `INSERT INTO ford.page_links (source_page_id, href, target_url, anchor_text, is_internal, link_type)
       VALUES ($1, '/vehiculos/ranger/galeria/', 'https://www.ford.mx/vehiculos/ranger/galeria/', 'Galería', true, 'internal')`,
      [rangerPage.rows[0].id],
    );
    await pool.query(
      `INSERT INTO ford.images (model_year_id, variant_id, url, alt_text, image_type, source_page_id)
       VALUES ($1, $2, 'https://www.ford.mx/images/ranger.jpg', 'Ford Ranger', 'exterior', $3)`,
      [modelYear.rows[0].id, variant.rows[0].id, rangerPage.rows[0].id],
    );
    const comparison = await pool.query<{id: string}>(
      `INSERT INTO ford.comparisons
         (model_year_id, variant_id, competitor_make, competitor_model, competitor_year, source_page_id)
       VALUES ($1, $2, 'Competitor', 'Pickup', 2027, $3) RETURNING id`,
      [modelYear.rows[0].id, variant.rows[0].id, rangerPage.rows[0].id],
    );
    await pool.query(
      `INSERT INTO ford.comparison_attributes (comparison_id, category, name, normalized_name, value_text)
       VALUES ($1, 'Motor', 'Potencia', 'potencia', '270 hp')`,
      [comparison.rows[0].id],
    );
    const trimComparison = await pool.query(
      "SELECT comparison_url FROM ford_read.vehicle_variants_v2 WHERE model = 'Contract Ranger Fixture'",
    );
    expect(trimComparison.rows[0].comparison_url).toBe(
      'https://www.ford.mx/vehiculos/ranger/',
    );

    const [
      links,
      images,
      comparisons,
      comparisonUrls,
      pageRegistry,
      provenance,
      documentProvenance,
      status,
    ] = await Promise.all([
      pool.query(
        "SELECT target_url FROM ford_read.page_links_v1 WHERE anchor_text = 'Galería'",
      ),
      pool.query(
        "SELECT image_url, source_url FROM ford_read.vehicle_images_v1 WHERE model = 'Contract Ranger Fixture'",
      ),
      pool.query(
        "SELECT competitor_model, fact_name, fact_value, source_url FROM ford_read.comparison_facts_v1 WHERE model = 'Contract Ranger Fixture'",
      ),
      pool.query(
        "SELECT comparison_url FROM ford_read.comparison_facts_v2 WHERE model = 'Contract Ranger Fixture'",
      ),
      pool.query(
        "SELECT source_url, title FROM ford_read.catalog_pages_v1 WHERE source_url = 'https://www.ford.mx/vehiculos/ranger/'",
      ),
      pool.query(
        "SELECT source_url, observed_at FROM ford_read.provenance_v1 WHERE model = 'Contract Ranger Fixture'",
      ),
      pool.query(
        'SELECT document_id::text, title, source_url FROM ford_read.document_provenance_v1 WHERE document_id = $1',
        [document.rows[0].id],
      ),
      pool.query(
        'SELECT model_count, active_model_year_count, page_count FROM ford_read.catalog_status_v1',
      ),
    ]);
    expect(links.rows[0].target_url).toBe(
      'https://www.ford.mx/vehiculos/ranger/galeria/',
    );
    expect(images.rows[0]).toMatchObject({
      image_url: 'https://www.ford.mx/images/ranger.jpg',
      source_url: 'https://www.ford.mx/vehiculos/ranger/',
    });
    expect(comparisons.rows[0]).toMatchObject({
      competitor_model: 'Pickup',
      fact_name: 'Potencia',
      fact_value: '270 hp',
      source_url: 'https://www.ford.mx/vehiculos/ranger/',
    });
    expect(comparisonUrls.rows[0].comparison_url).toBe(
      'https://www.ford.mx/vehiculos/ranger/',
    );
    expect(pageRegistry.rows).toEqual([
      {
        source_url: 'https://www.ford.mx/vehiculos/ranger/',
        title: 'Ford Ranger',
      },
    ]);
    expect(provenance.rows.length).toBeGreaterThan(0);
    expect(documentProvenance.rows[0]).toMatchObject({
      document_id: document.rows[0].id,
      title: 'Ranger profile fixture',
      source_url: 'https://www.ford.mx/vehiculos/ranger/',
    });
    expect(status.rows[0]).toMatchObject({
      model_count: '1',
      active_model_year_count: '1',
    });
  });
});

async function seedCatalog(): Promise<void> {
  const source = await pool.query<{id: number}>(
    `INSERT INTO ford.sources (base_url, name)
     VALUES ('https://www.ford.mx', 'catalog fixture source') RETURNING id`,
  );
  const pages = await pool.query<{id: number; page_type: string}>(
    `INSERT INTO ford.pages (source_id, url, canonical_url, page_type, title, crawled_at)
     VALUES
       ($1, 'https://www.ford.mx/vehiculos/ranger/', 'https://www.ford.mx/vehiculos/ranger/', 'model', 'Ford Ranger', '2026-10-16T10:00:00Z'),
       ($1, 'https://www.ford.mx/vehiculos/ranger/precio/', 'https://www.ford.mx/vehiculos/ranger/precio/', 'catalog', 'Ranger Precios', '2026-10-16T10:00:00Z'),
       ($1, 'https://www.ford.mx/vehiculos/ranger/ficha-tecnica/', 'https://www.ford.mx/vehiculos/ranger/ficha-tecnica/', 'technical_sheet', 'Ranger Ficha Técnica', '2026-10-16T10:00:00Z'),
       ($1, 'https://www.ford.mx/vehiculos/ranger/ficha-tecnica-no-crawl/', 'https://www.ford.mx/vehiculos/ranger/ficha-tecnica-no-crawl/', 'technical_sheet_unobserved', 'No observada', NULL),
       ($1, 'https://www.ford.mx/promociones/ranger/', 'https://www.ford.mx/promociones/ranger/', 'promotion', 'Promoción Ranger', '2026-10-16T10:00:00Z')
     RETURNING id, page_type`,
    [source.rows[0].id],
  );
  const pageId = (type: string) =>
    pages.rows.find(page => page.page_type === type)!.id;
  const model = await pool.query<{id: string}>(
    `INSERT INTO ford.models (name, normalized_name)
     VALUES ('Contract Ranger Fixture', 'fixture-contract-ranger') RETURNING id`,
  );
  const modelYear = await pool.query<{id: string}>(
    `INSERT INTO ford.model_years (model_id, model_year, source_page_id, starting_price, currency)
     VALUES ($1, 2027, $2, 899000, 'MXN') RETURNING id`,
    [model.rows[0].id, pageId('catalog')],
  );
  const variant = await pool.query<{id: string}>(
    `INSERT INTO ford.variants
       (model_year_id, name, normalized_name, trim_name, price, currency, source_page_id)
     VALUES ($1, 'XLT Gasolina 4x2', 'xlt-gasolina-4x2', 'XLT Gasolina 4x2', 899000, 'MXN', $2)
     RETURNING id`,
    [modelYear.rows[0].id, pageId('model')],
  );
  await pool.query(
    `INSERT INTO ford.specifications
       (variant_id, model_year_id, name, normalized_name, value_text, unit, source_page_id)
     VALUES ($1, $2, 'Potencia', 'potencia', '270 hp', 'hp', $3),
            ($1, $2, 'Dato sin fuente', 'dato-sin-fuente', 'unverified', null, null),
            ($1, $2, 'Dato sin fecha', 'dato-sin-fecha', 'unobserved', null, $4)`,
    [
      variant.rows[0].id,
      modelYear.rows[0].id,
      pageId('technical_sheet'),
      pageId('technical_sheet_unobserved'),
    ],
  );
  await pool.query(
    `INSERT INTO ford.specifications
       (variant_id, model_year_id, name, normalized_name, value_text, source_page_id)
     VALUES ($1, $2, 'Precio', 'precio', '899000', $3)`,
    [variant.rows[0].id, modelYear.rows[0].id, pageId('catalog')],
  );
  await pool.query(
    `INSERT INTO ford.offers
       (model_year_id, title, description, discount_amount, conditions, valid_from, valid_until, source_page_id,
        offer_type, content_hash, currency, requires_credit_approval, metadata)
     VALUES ($1, 'Contract Promotion Fixture', 'Oferta publicada para Ranger.', 25000, 'Sujeto a términos publicados.', '2026-10-01', '2026-10-31', $2,
             'promotion', 'fixture-promotion-hash', 'MXN', false, '{"benefits":["Bono de $25,000 MXN"]}'::jsonb)`,
    [modelYear.rows[0].id, pageId('promotion')],
  );
  await pool.query(
    `INSERT INTO ford.offers
       (model_year_id, title, description, monthly_payment, term_months, provider,
        valid_from, valid_until, source_page_id, offer_type, content_hash, currency,
        tax_rate_percent, opening_commission_rate_percent, maximum_down_payment_percent, life_insurance_price,
        requires_credit_approval, metadata)
     VALUES ($1, 'Plan Ford Credit', 'Plan estructurado de crédito.', 12000, 60, 'Ford Credit',
             '2026-10-01', '2026-10-31', $2, 'financing', 'fixture-financing-hash', 'MXN',
             16, 3.5, 80, 2500, true,
             '{"benefits":["Bono de $130,000 MXN"],"termConflict":{"labelMonths":24,"structuredMonths":72}}'::jsonb)`,
    [modelYear.rows[0].id, pageId('promotion')],
  );
  const finance = await pool.query(
    "SELECT tax_rate_percent, opening_commission_rate_percent, maximum_down_payment_percent, life_insurance_price FROM ford_read.offers_v2 WHERE offer_type = 'financing'",
  );
  expect(finance.rows[0]).toMatchObject({
    tax_rate_percent: '16.0000',
    opening_commission_rate_percent: '3.5000',
    maximum_down_payment_percent: '80.0000',
    life_insurance_price: '2500.00',
  });
  const unknownPage = await pool.query(
    "SELECT count(*)::int AS count FROM ford_read.catalog_pages_v1 WHERE source_url = 'https://www.ford.mx/unknown/'",
  );
  expect(unknownPage.rows[0].count).toBe(0);
}
