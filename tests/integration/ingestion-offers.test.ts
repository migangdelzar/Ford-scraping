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
import {ingestPage, ingestPages} from '../../src/crawl/ingestion.js';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgres://postgres:postgres@localhost:5432/ford';
let pool: Pool;
const promotionPage: FetchedPage = {
  sourceBaseUrl: 'https://www.forduruapan.mx',
  sourceName: 'Ford Uruapan',
  url: 'https://www.forduruapan.mx/promociones/',
  canonicalUrl: 'https://www.forduruapan.mx/promociones/',
  pageType: 'promotion',
  status: 200,
  contentType: 'text/html',
  title: 'Promociones Ford',
  rawHtml: `<main><article class="offer-card" data-model="Territory" data-year="2026"
    data-provider="BBVA" data-offer-type="months_without_interest"
    data-months-without-interest="12" data-valid-until="2026-10-31">
    <h2>Territory 12 meses sin intereses</h2><p>Sujeto a aprobación.</p>
  </article></main>`,
  extractedText: 'Territory 12 meses sin intereses',
  contentHash: 'ingestion-offer-page',
  metadata: {},
};

describe('offer ingestion', () => {
  beforeAll(async () => {
    pool = createPool(databaseUrl);
    await pool.query(
      'TRUNCATE ford.documents, ford.document_embeddings, ford.offers, ford.model_years, ford.models, ford.pages, ford.sources CASCADE',
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  it('persists explicit promotion cards and creates offer documents', async () => {
    const pages = new PageRepository(pool);
    await pages.upsert(promotionPage);
    const summary = await ingestPages(
      pages,
      new CatalogRepository(pool),
      new DocumentRepository(pool),
      100,
      new OfferRepository(pool),
    );

    const offer = await pool.query<{
      title: string;
      months_without_interest: number;
    }>('SELECT title, months_without_interest FROM ford.offers');
    const documents = await pool.query<{
      document_type: string;
      offer_id: string;
    }>(
      'SELECT document_type, offer_id FROM ford.documents WHERE offer_id IS NOT NULL',
    );

    expect(summary.failed).toBe(0);
    expect(offer.rows).toEqual([
      expect.objectContaining({
        title: 'Territory 12 meses sin intereses',
        months_without_interest: 12,
      }),
    ]);
    expect(documents.rows).toEqual([
      expect.objectContaining({document_type: 'offer'}),
    ]);
  });

  it('does not reset a ready embedding when the page content is unchanged', async () => {
    const pages = new PageRepository(pool);
    const storedPage = (await pages.upsert(promotionPage)).page;
    const documents = new DocumentRepository(pool);
    await ingestPage(
      storedPage,
      new CatalogRepository(pool),
      documents,
      new OfferRepository(pool),
    );
    const pending = await documents.listPending(10);
    await documents.saveReady(
      pending[0].documentId,
      Array.from({length: 1024}, () => 0),
      'test-model',
    );

    await ingestPage(
      storedPage,
      new CatalogRepository(pool),
      documents,
      new OfferRepository(pool),
    );
    const status = await pool.query(
      'SELECT status FROM ford.document_embeddings WHERE document_id = $1',
      [pending[0].documentId],
    );
    expect(status.rows[0].status).toBe('ready');
  });
});
