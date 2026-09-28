import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import type {Pool} from 'pg';
import {createPool} from '../../src/storage/database.js';
import {
  PageRepository,
  type FetchedPage,
} from '../../src/storage/page-repository.js';
import {CatalogRepository} from '../../src/storage/catalog-repository.js';
import {DocumentRepository} from '../../src/storage/document-repository.js';
import {OfferRepository} from '../../src/storage/offer-repository.js';
import {buildOfferDocument} from '../../src/domain/offers.js';
import type {OfferCandidate} from '../../src/domain/contracts.js';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgres://postgres:postgres@localhost:5432/ford';
let pool: Pool;

describe('offers schema', () => {
  beforeAll(() => {
    pool = createPool(databaseUrl);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('stores financing terms and links documents to offers', async () => {
    const columns = await pool.query<{column_name: string}>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'ford' AND table_name = 'offers'`,
    );

    expect(columns.rows.map(row => row.column_name)).toEqual(
      expect.arrayContaining([
        'offer_type',
        'provider',
        'months_without_interest',
        'annual_interest_rate',
        'content_hash',
        'valid_until',
        'external_key',
      ]),
    );

    const documentColumns = await pool.query<{column_name: string}>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'ford' AND table_name = 'documents'`,
    );

    expect(documentColumns.rows.map(row => row.column_name)).toContain(
      'offer_id',
    );
  });

  it('upserts an offer and preserves a ready document when content is unchanged', async () => {
    await pool.query(
      'TRUNCATE ford.documents, ford.document_embeddings, ford.offers, ford.model_years, ford.models, ford.pages, ford.sources CASCADE',
    );
    const pages = new PageRepository(pool);
    const catalog = new CatalogRepository(pool);
    const documents = new DocumentRepository(pool);
    const offers = new OfferRepository(pool);
    const sourcePage: FetchedPage = {
      sourceBaseUrl: 'https://www.forduruapan.mx',
      sourceName: 'Ford Uruapan',
      url: 'https://www.forduruapan.mx/promociones/',
      canonicalUrl: 'https://www.forduruapan.mx/promociones/',
      pageType: 'promotion',
      status: 200,
      contentType: 'text/html',
      title: 'Promociones',
      rawHtml: '<main>Promociones</main>',
      extractedText: 'Promociones',
      contentHash: 'promotion-page',
      metadata: {},
    };
    const page = (await pages.upsert(sourcePage)).page;
    await catalog.upsertCatalog(
      {
        modelName: 'Territory',
        modelYear: 2026,
        startingPrice: 559900,
        currency: 'MXN',
        category: 'SUVs y Crossovers',
        sourceUrl: page.url,
      },
      page,
    );
    const candidate: OfferCandidate = {
      title: '12 meses sin intereses',
      description: 'Oferta para Territory.',
      offerType: 'months_without_interest',
      provider: 'BBVA',
      modelName: 'Territory',
      modelYear: 2026,
      monthsWithoutInterest: 12,
      validUntil: '2026-10-31',
      currency: 'MXN',
      requiresCreditApproval: true,
      sourceUrl: page.url,
      metadata: {},
    };

    const first = await offers.upsertOffer(candidate, page);
    const firstDocument = buildOfferDocument({id: first.offerId, ...candidate});
    await documents.upsertOfferDocument(first, firstDocument, page.id);
    const documentRow = await pool.query<{id: string}>(
      'SELECT id FROM ford.documents WHERE offer_id = $1',
      [first.offerId],
    );
    await documents.saveReady(
      documentRow.rows[0].id,
      [1, ...Array.from({length: 1023}, () => 0)],
      'test-model',
    );

    const second = await offers.upsertOffer(candidate, page);
    const secondDocument = buildOfferDocument({
      id: second.offerId,
      ...candidate,
    });
    await documents.upsertOfferDocument(second, secondDocument, page.id);
    const embedding = await pool.query<{status: string}>(
      'SELECT status FROM ford.document_embeddings WHERE document_id = $1',
      [documentRow.rows[0].id],
    );

    expect(second.offerId).toBe(first.offerId);
    expect(embedding.rows[0].status).toBe('ready');
  });

  it('keeps financing terms distinct when their source identities differ', async () => {
    await pool.query(
      'TRUNCATE ford.documents, ford.document_embeddings, ford.offers, ford.model_years, ford.models, ford.pages, ford.sources CASCADE',
    );
    const pages = new PageRepository(pool);
    const offers = new OfferRepository(pool);
    const sourcePage: FetchedPage = {
      sourceBaseUrl: 'https://www.forduruapan.mx',
      sourceName: 'Ford Uruapan',
      url: 'https://www.forduruapan.mx/Financiamiento/',
      canonicalUrl: 'https://www.forduruapan.mx/Financiamiento/',
      pageType: 'financing',
      status: 200,
      contentType: 'text/html',
      title: 'Financiamiento',
      rawHtml: '<main>Financiamiento</main>',
      extractedText: 'Financiamiento',
      contentHash: 'financing-page',
      metadata: {},
    };
    const page = (await pages.upsert(sourcePage)).page;
    const baseCandidate: OfferCandidate = {
      title: 'Territory Titanium - financing',
      description: 'Financiamiento.',
      offerType: 'financing',
      modelName: 'Territory',
      modelYear: 2026,
      currency: 'MXN',
      requiresCreditApproval: true,
      sourceUrl: page.url,
      metadata: {
        externalKey: 'TERR26:VERSION-1:PLAN-1:24',
        vehicleKey: 'TERR26',
        versionId: 'VERSION-1',
        planId: 'PLAN-1',
        termMonths: 24,
      },
    };
    const first = await offers.upsertOffer(baseCandidate, page);
    const second = await offers.upsertOffer(
      {
        ...baseCandidate,
        metadata: {
          ...baseCandidate.metadata,
          externalKey: 'TERR26:VERSION-1:PLAN-1:48',
          termMonths: 48,
        },
      },
      page,
    );

    expect(second.offerId).not.toBe(first.offerId);
    const rows = await pool.query<{count: string}>(
      'SELECT count(*)::text AS count FROM ford.offers',
    );
    expect(rows.rows[0].count).toBe('2');
  });
});
