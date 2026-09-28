import {beforeAll, afterAll, describe, expect, it} from 'vitest';
import type {Pool} from 'pg';
import {createPool} from '../../src/storage/database.js';
import {
  PageRepository,
  type FetchedPage,
} from '../../src/storage/page-repository.js';
import {CatalogRepository} from '../../src/storage/catalog-repository.js';
import {DocumentRepository} from '../../src/storage/document-repository.js';
import type {CatalogCandidate} from '../../src/domain/contracts.js';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgres://postgres:postgres@localhost:5432/ford';
let pool: Pool;
let pages: PageRepository;
let catalog: CatalogRepository;
let documents: DocumentRepository;

const samplePage: FetchedPage = {
  sourceBaseUrl: 'https://www.forduruapan.mx',
  sourceName: 'Ford Uruapan',
  url: 'https://www.forduruapan.mx/Todos/',
  canonicalUrl: 'https://www.forduruapan.mx/Todos/',
  pageType: 'catalog',
  status: 200,
  contentType: 'text/html',
  title: 'Todos',
  rawHtml: '<main>catalog</main>',
  extractedText: 'catalog',
  contentHash: 'catalog-hash',
  metadata: {},
};

const sampleCandidate: CatalogCandidate = {
  modelName: 'Territory',
  modelYear: 2026,
  startingPrice: 559900,
  currency: 'MXN',
  category: 'SUVs y Crossovers',
  sourceUrl: 'https://www.forduruapan.mx/TERRITORY/26/',
};

describe('PostgreSQL repositories', () => {
  beforeAll(async () => {
    pool = createPool(databaseUrl);
    pages = new PageRepository(pool);
    catalog = new CatalogRepository(pool);
    documents = new DocumentRepository(pool);
    await pool.query(
      'TRUNCATE ford.documents, ford.offers, ford.images, ford.features, ford.specifications, ford.variants, ford.model_year_categories, ford.categories, ford.model_years, ford.models, ford.pages, ford.sources CASCADE',
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  it('does not mark an unchanged page as changed', async () => {
    const first = await pages.upsert(samplePage);
    const second = await pages.upsert(samplePage);
    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
  });

  it('upserts the same model-year without duplicates', async () => {
    const storedPage = (await pages.upsert(samplePage)).page;
    await catalog.upsertCatalog(sampleCandidate, storedPage);
    await catalog.upsertCatalog(sampleCandidate, storedPage);
    const result = await pool.query(
      `SELECT count(*)::int AS count
       FROM ford.model_years my
       JOIN ford.models m ON m.id = my.model_id
       WHERE m.normalized_name = 'territory' AND my.model_year = 2026`,
    );
    expect(result.rows[0].count).toBe(1);
  });

  it('reuses a logical document key and resets its embedding to pending when content changes', async () => {
    const storedPage = (await pages.upsert(samplePage)).page;
    const ref = await catalog.upsertCatalog(sampleCandidate, storedPage);
    await documents.upsertDocuments(
      ref,
      [
        {
          documentType: 'technology',
          title: 'Territory tecnología',
          content: 'Pantalla y conectividad.',
          metadata: {},
        },
      ],
      storedPage.id,
    );
    await documents.upsertDocuments(
      ref,
      [
        {
          documentType: 'technology',
          title: 'Territory tecnología',
          content: 'Pantalla, conectividad y seguridad.',
          metadata: {},
        },
      ],
      storedPage.id,
    );

    const pending = await documents.listPending(10);
    expect(pending).toHaveLength(1);
    expect(pending[0].content).toContain('seguridad');
  });

  it('replaces specifications from the same source page on reingestion', async () => {
    const storedPage = (await pages.upsert(samplePage)).page;
    const ref = await catalog.upsertCatalog(sampleCandidate, storedPage);
    await catalog.upsertSpecifications(
      ref,
      [
        {
          name: 'Potencia',
          normalizedName: 'power_hp',
          valueText: '180 hp',
          valueNumeric: 180,
          unit: 'hp',
        },
      ],
      storedPage,
    );
    await catalog.upsertSpecifications(
      ref,
      [
        {
          name: 'Potencia',
          normalizedName: 'power_hp',
          valueText: '190 hp',
          valueNumeric: 190,
          unit: 'hp',
        },
      ],
      storedPage,
    );

    const result = await pool.query(
      `SELECT count(*)::int AS count, max(value_text) AS value_text
       FROM ford.specifications WHERE model_year_id = $1 AND source_page_id = $2`,
      [ref.modelYearId, storedPage.id],
    );
    expect(result.rows[0]).toEqual({count: 1, value_text: '190 hp'});
  });

  it('stores multiple sections and chunks independently for one model-year', async () => {
    await pool.query('DELETE FROM ford.documents');
    const storedPage = (await pages.upsert(samplePage)).page;
    const ref = await catalog.upsertCatalog(sampleCandidate, storedPage);
    await documents.upsertDocuments(
      ref,
      [
        {
          documentType: 'technology',
          sectionKey: 'infotainment',
          chunkIndex: 0,
          title: 'Territory infotainment',
          content: 'Pantalla central.',
          metadata: {},
        },
        {
          documentType: 'technology',
          sectionKey: 'infotainment',
          chunkIndex: 1,
          title: 'Territory infotainment continuación',
          content: 'Conectividad inalámbrica.',
          metadata: {},
        },
        {
          documentType: 'technology',
          sectionKey: 'connectivity',
          chunkIndex: 0,
          title: 'Territory connectivity',
          content: 'Apple CarPlay y Android Auto.',
          metadata: {},
        },
      ],
      storedPage.id,
    );

    const rows = await pool.query(
      `SELECT document_type, section_key, chunk_index
       FROM ford.documents WHERE model_year_id = $1
       ORDER BY section_key, chunk_index`,
      [ref.modelYearId],
    );
    expect(rows.rows).toEqual([
      {
        document_type: 'technology',
        section_key: 'connectivity',
        chunk_index: 0,
      },
      {
        document_type: 'technology',
        section_key: 'infotainment',
        chunk_index: 0,
      },
      {
        document_type: 'technology',
        section_key: 'infotainment',
        chunk_index: 1,
      },
    ]);

    const pending = await documents.listPending(10);
    expect(pending).toHaveLength(3);
    await documents.saveReady(
      pending[0].documentId,
      Array.from({length: 1024}, () => 0),
      'test-model',
    );
    expect(await documents.listPending(10)).toHaveLength(2);
  });

  it('allows distinct page documents to share the same content hash', async () => {
    await pool.query('DELETE FROM ford.documents');
    const firstPage = (await pages.upsert(samplePage)).page;
    const secondPage = (
      await pages.upsert({
        ...samplePage,
        url: 'https://www.forduruapan.mx/Promociones/forduruapan',
        canonicalUrl: 'https://www.forduruapan.mx/Promociones/forduruapan',
      })
    ).page;

    const candidate = {
      documentType: 'promotion',
      title: 'Promoción Ford',
      content: 'Contenido repetido de la página pública.',
      metadata: {},
    };
    await documents.upsertPageDocument(firstPage.id!, candidate);
    await documents.upsertPageDocument(secondPage.id!, candidate);

    const result = await pool.query(
      `SELECT count(*)::int AS count
       FROM ford.documents WHERE document_type = 'promotion'`,
    );
    expect(result.rows[0].count).toBe(2);
  });
});
