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
import {SearchRepository} from '../../src/storage/search-repository.js';
import {OfferSearchService} from '../../src/search/offer-search-service.js';
import type {EmbeddingProvider} from '../../src/embeddings/provider.js';
import type {OfferCandidate} from '../../src/domain/contracts.js';
import {buildOfferDocument} from '../../src/domain/offers.js';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgres://postgres:postgres@localhost:5432/ford';
let pool: Pool;

function vector(first: number): number[] {
  return [first, ...Array.from({length: 1023}, () => 0)];
}

describe('hybrid offer search', () => {
  beforeAll(async () => {
    pool = createPool(databaseUrl);
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
      contentHash: 'offer-search-page',
      metadata: {},
    };
    const page = (await pages.upsert(sourcePage)).page;
    for (const vehicle of [
      {name: 'Territory', price: 559900},
      {name: 'Bronco Sport', price: 773500},
      {name: 'Explorer', price: 1193600},
    ]) {
      await catalog.upsertCatalog(
        {
          modelName: vehicle.name,
          modelYear: 2026,
          startingPrice: vehicle.price,
          currency: 'MXN',
          category: 'SUVs y Crossovers',
          sourceUrl: page.url,
        },
        page,
      );
    }

    const seed = async (candidate: OfferCandidate, score: number) => {
      const ref = await offers.upsertOffer(candidate, page);
      await documents.upsertOfferDocument(
        ref,
        buildOfferDocument({id: ref.offerId, ...candidate}),
        page.id,
      );
      const document = await pool.query<{id: string}>(
        'SELECT id FROM ford.documents WHERE offer_id = $1',
        [ref.offerId],
      );
      await documents.saveReady(
        document.rows[0].id,
        vector(score),
        'test-model',
      );
    };

    await seed(
      {
        title: 'Territory 12 meses sin intereses',
        offerType: 'months_without_interest',
        provider: 'BBVA',
        modelName: 'Territory',
        modelYear: 2026,
        cashPrice: 559900,
        monthsWithoutInterest: 12,
        validUntil: '2026-10-31',
        currency: 'MXN',
        requiresCreditApproval: true,
        sourceUrl: page.url,
        metadata: {},
        description: 'SUV familiar con buena promoción.',
      },
      0.9,
    );
    await seed(
      {
        title: 'Bronco Sport 12 meses sin intereses',
        offerType: 'months_without_interest',
        provider: 'BBVA',
        modelName: 'Bronco Sport',
        modelYear: 2026,
        cashPrice: 773500,
        monthsWithoutInterest: 12,
        validUntil: '2026-09-01',
        currency: 'MXN',
        requiresCreditApproval: true,
        sourceUrl: page.url,
        metadata: {},
        description: 'SUV familiar con promoción vencida.',
      },
      1,
    );
    await seed(
      {
        title: 'Explorer 12 meses sin intereses',
        offerType: 'months_without_interest',
        provider: 'BBVA',
        modelName: 'Explorer',
        modelYear: 2026,
        cashPrice: 1193600,
        monthsWithoutInterest: 12,
        validUntil: '2026-10-31',
        currency: 'MXN',
        requiresCreditApproval: true,
        sourceUrl: page.url,
        metadata: {},
        description: 'SUV familiar con promoción.',
      },
      0.8,
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  it('applies offer validity and financing filters before semantic ranking', async () => {
    const provider: EmbeddingProvider = {
      model: 'test-model',
      dimensions: 1024,
      available: true,
      embed: async () => [vector(1)],
    };
    const service = new OfferSearchService(
      new SearchRepository(pool),
      provider,
    );
    const response = await service.searchOffers({
      query: 'SUV familiar con buena promoción',
      filters: {
        modelYear: 2026,
        maxCashPrice: 800000,
        minimumMonthsWithoutInterest: 12,
        asOf: '2026-09-24',
        activeOnly: true,
      },
    });

    expect(response.semanticSearch).toBe('ready');
    expect(response.results.map(result => result.title)).toEqual([
      'Territory 12 meses sin intereses',
    ]);
  });
});
