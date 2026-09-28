import {describe, expect, it} from 'vitest';
import type {PageChange} from '../../src/storage/page-repository.js';
import {
  crawlCatalog,
  crawlTargets,
  type PageFetcher,
} from '../../src/crawl/crawler.js';
import type {FetchedPage} from '../../src/storage/page-repository.js';

describe('catalog crawler', () => {
  it('queues public model links but not form links', async () => {
    const fetched: string[] = [];
    const fetcher: PageFetcher = {
      fetch: async (url: string): Promise<FetchedPage> => {
        fetched.push(url);
        const html = url.endsWith('/Todos/')
          ? "<a class='autos-item-web' href='/TERRITORY/26/'><p>Territory 2026</p><small><span class='precio'>$559,900</span></small></a><a href='/Cotiza/'>Cotiza</a>"
          : '<h1>Territory 2026</h1>';
        return {
          sourceBaseUrl: 'https://www.forduruapan.mx',
          sourceName: 'Ford Uruapan',
          url,
          canonicalUrl: url,
          pageType: url.includes('Todos') ? 'catalog' : 'model',
          status: 200,
          contentType: 'text/html',
          title: 'Fixture',
          rawHtml: html,
          extractedText: html,
          contentHash: url,
          metadata: {},
        };
      },
    };
    const pages = {
      upsert: async (page: FetchedPage): Promise<PageChange> => ({
        page: {...page, id: 1, title: page.title ?? ''},
        changed: true,
      }),
    };

    const summary = await crawlCatalog({
      startUrl: 'https://www.forduruapan.mx/Todos/',
      policy: {
        baseUrl: new URL('https://www.forduruapan.mx'),
        allowedHosts: new Set(['www.forduruapan.mx']),
      },
      fetcher,
      pages,
      maxPages: 10,
    });

    expect(fetched).toContain('https://www.forduruapan.mx/TERRITORY/26/');
    expect(fetched).not.toContain('https://www.forduruapan.mx/Cotiza/');
    expect(summary.discoveredUrls).toContain(
      'https://www.forduruapan.mx/TERRITORY/26/',
    );
  });

  it('queues model URLs from the catalog hidden vehicle payload', async () => {
    const fetched: string[] = [];
    const fetcher: PageFetcher = {
      fetch: async (url: string): Promise<FetchedPage> => {
        fetched.push(url);
        const rawHtml = url.endsWith('/Todos/')
          ? `<input id='hAutos' value='${JSON.stringify([
              {modelo: 'TERRITORY', anio: '26', Precio: '559900'},
            ])}'>`
          : '<h1>Territory 2026</h1>';
        return {
          sourceBaseUrl: 'https://www.forduruapan.mx',
          sourceName: 'Ford Uruapan',
          url,
          canonicalUrl: url,
          pageType: url.endsWith('/Todos/') ? 'catalog' : 'model',
          status: 200,
          contentType: 'text/html',
          title: 'Fixture',
          rawHtml,
          extractedText: rawHtml,
          contentHash: url,
          metadata: {},
        };
      },
    };
    const pages = {
      upsert: async (page: FetchedPage): Promise<PageChange> => ({
        page: {...page, id: 1, title: page.title ?? ''},
        changed: true,
      }),
    };

    await crawlCatalog({
      startUrl: 'https://www.forduruapan.mx/Todos/',
      policy: {
        baseUrl: new URL('https://www.forduruapan.mx'),
        allowedHosts: new Set(['www.forduruapan.mx']),
      },
      fetcher,
      pages,
      maxPages: 10,
    });

    expect(fetched).toContain('https://www.forduruapan.mx/TERRITORY/26/');
  });

  it('queues a technical-sheet route when the model page has no link to it', async () => {
    const fetched: string[] = [];
    const fetcher: PageFetcher = {
      fetch: async (url: string): Promise<FetchedPage> => {
        fetched.push(url);
        const rawHtml = '<h1>Territory 2026</h1>';
        return {
          sourceBaseUrl: 'https://www.forduruapan.mx',
          sourceName: 'Ford Uruapan',
          url,
          canonicalUrl: url,
          pageType: url.includes('Ficha-Tecnica')
            ? 'technical_sheet'
            : url.endsWith('/Todos/')
              ? 'catalog'
              : 'model',
          status: 200,
          contentType: 'text/html',
          title: 'Fixture',
          rawHtml,
          extractedText: rawHtml,
          contentHash: url,
          metadata: {},
        };
      },
    };
    const pages = {
      upsert: async (page: FetchedPage): Promise<PageChange> => ({
        page: {...page, id: 1, title: page.title ?? ''},
        changed: true,
      }),
    };

    await crawlCatalog({
      startUrl: 'https://www.forduruapan.mx/TERRITORY/26/',
      policy: {
        baseUrl: new URL('https://www.forduruapan.mx'),
        allowedHosts: new Set(['www.forduruapan.mx']),
      },
      fetcher,
      pages,
      maxPages: 10,
    });

    expect(fetched).toContain(
      'https://www.forduruapan.mx/TERRITORY/26/Ficha-Tecnica/',
    );
  });

  it('supports multiple explicit public entry points and reports changed pages', async () => {
    const fetched: string[] = [];
    const fetcher: PageFetcher = {
      fetch: async (url: string): Promise<FetchedPage> => {
        fetched.push(url);
        return {
          sourceBaseUrl: 'https://www.forduruapan.mx',
          sourceName: 'Ford Uruapan',
          url,
          canonicalUrl: url,
          pageType: url.includes('Seminuevos') ? 'used_vehicle' : 'promotion',
          status: 200,
          contentType: 'text/html',
          title: 'Fixture',
          rawHtml: '<main>Fixture</main>',
          extractedText: 'Fixture',
          contentHash: url,
          metadata: {},
        };
      },
    };
    const pages = {
      upsert: async (page: FetchedPage): Promise<PageChange> => ({
        page: {...page, id: fetched.length, title: page.title ?? ''},
        changed: true,
      }),
    };

    const summary = await crawlTargets({
      startUrls: [
        'https://www.forduruapan.mx/Seminuevos/',
        'https://www.forduruapan.mx/Promociones/',
      ],
      policy: {
        baseUrl: new URL('https://www.forduruapan.mx'),
        allowedHosts: new Set(['www.forduruapan.mx']),
      },
      fetcher,
      pages,
      maxPages: 10,
    });

    expect(fetched).toEqual([
      'https://www.forduruapan.mx/Seminuevos/',
      'https://www.forduruapan.mx/Promociones/',
    ]);
    expect(summary.changedPages).toHaveLength(2);
  });
});
