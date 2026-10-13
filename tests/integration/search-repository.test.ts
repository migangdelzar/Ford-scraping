import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import type {Pool} from 'pg';
import {createPool} from '../../src/storage/database.js';
import {integrationDatabaseUrl} from './integration-database.js';
import {
  PageRepository,
  type FetchedPage,
} from '../../src/storage/page-repository.js';
import {CatalogRepository} from '../../src/storage/catalog-repository.js';
import {DocumentRepository} from '../../src/storage/document-repository.js';
import {OfferRepository} from '../../src/storage/offer-repository.js';
import type {EmbeddingProvider} from '../../src/embeddings/provider.js';
import type {OfferCandidate} from '../../src/domain/contracts.js';
import {buildOfferDocument} from '../../src/domain/offers.js';
import {SearchRepository} from '../../src/storage/search-repository.js';
import {SearchService} from '../../src/search/search-service.js';

const databaseUrl = integrationDatabaseUrl();
let pool: Pool;

function vector(first: number): number[] {
  return [first, ...Array.from({length: 1023}, () => 0)];
}

describe('hybrid search repository', () => {
  beforeAll(async () => {
    pool = createPool(databaseUrl);
    await pool.query(
      'TRUNCATE ford.documents, ford.document_embeddings, ford.offers, ford.images, ford.features, ford.specifications, ford.variants, ford.model_year_categories, ford.categories, ford.model_years, ford.models, ford.pages, ford.sources CASCADE',
    );

    const pages = new PageRepository(pool);
    const catalog = new CatalogRepository(pool);
    const documents = new DocumentRepository(pool);
    const offers = new OfferRepository(pool);
    const sourcePage: FetchedPage = {
      sourceBaseUrl: 'https://www.forduruapan.mx',
      sourceName: 'Ford Uruapan',
      url: 'https://www.forduruapan.mx/Todos/',
      canonicalUrl: 'https://www.forduruapan.mx/Todos/',
      pageType: 'catalog',
      status: 200,
      contentType: 'text/html',
      title: 'Todos',
      rawHtml: '<main/>',
      extractedText: 'catalog',
      contentHash: 'search-catalog',
      metadata: {},
    };
    const page = (await pages.upsert(sourcePage)).page;
    for (const item of [
      {
        name: 'Territory',
        price: 559900,
        content: 'SUV familiar con tecnología, conectividad y espacio.',
        embedding: vector(1),
      },
      {
        name: 'Bronco Sport',
        price: 773500,
        content: 'SUV aventurera con tecnología y seguridad.',
        embedding: vector(0.8),
      },
      {
        name: 'Explorer',
        price: 1193600,
        content: 'SUV familiar amplia con tecnología avanzada.',
        embedding: vector(0.2),
      },
    ]) {
      const ref = await catalog.upsertCatalog(
        {
          modelName: item.name,
          modelYear: 2026,
          startingPrice: item.price,
          currency: 'MXN',
          category: 'SUVs y Crossovers',
          sourceUrl: page.url,
        },
        page,
      );
      await documents.upsertDocuments(
        ref,
        [
          {
            documentType: 'technology',
            title: `${item.name} tecnología`,
            content: item.content,
            semanticContent: item.content,
            metadata: {},
          },
        ],
        page.id,
      );
      const pending = await documents.listPending(10);
      const current = pending.find(job => job.content === item.content);
      await documents.saveReady(
        current!.documentId,
        item.embedding,
        'test-model',
      );
    }
    const offerCandidate: OfferCandidate = {
      title: 'Territory monthly financing plan',
      description: 'SUV familiar con tecnología, conectividad y espacio.',
      offerType: 'financing',
      provider: 'Ford Credit',
      modelName: 'Territory',
      modelYear: 2026,
      currency: 'MXN',
      requiresCreditApproval: true,
      sourceUrl: page.url,
      metadata: {},
    };
    const offer = await offers.upsertOffer(offerCandidate, page);
    await documents.upsertOfferDocument(
      offer,
      buildOfferDocument({id: offer.offerId, ...offerCandidate}),
      page.id,
    );
    const offerDocument = await pool.query<{id: string}>(
      'SELECT id FROM ford.documents WHERE offer_id = $1',
      [offer.offerId],
    );
    await documents.saveReady(
      offerDocument.rows[0].id,
      vector(1),
      'test-model',
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  it('applies max price before semantic ranking', async () => {
    const provider: EmbeddingProvider = {
      model: 'test-model',
      dimensions: 1024,
      available: true,
      embed: async () => [vector(1)],
    };
    const service = new SearchService(new SearchRepository(pool), provider);
    const response = await service.search({
      query: 'SUV familiar con tecnología',
      filters: {maxPrice: 800000, modelYear: 2026},
    });
    expect(response.semanticSearch).toBe('ready');
    expect(
      response.results.every(
        result => result.price! <= 800000 && result.modelYear === 2026,
      ),
    ).toBe(true);
    expect(response.results.map(result => result.modelName)).not.toContain(
      'Explorer',
    );
  });

  it('does not include financing documents in vehicle search evidence', async () => {
    const provider: EmbeddingProvider = {
      model: 'test-model',
      dimensions: 1024,
      available: true,
      embed: async () => [vector(1)],
    };
    const service = new SearchService(new SearchRepository(pool), provider);

    const response = await service.search({
      query: 'SUV familiar con tecnología, conectividad y espacio',
      filters: {modelYear: 2026},
    });

    expect(
      response.results.flatMap(result => result.matchedSections),
    ).not.toContain('offer');
    expect(
      response.results.flatMap(result => result.evidence.map(hit => hit.title)),
    ).not.toContain('Territory — Territory monthly financing plan');
  });
});
