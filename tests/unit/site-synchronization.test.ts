import {describe, expect, it, vi} from 'vitest';
import type {StoredPage} from '../../src/domain/contracts.js';
import {SiteSynchronizationService} from '../../src/crawl/site-synchronization.js';

const usedPage: StoredPage = {
  id: 1,
  url: 'https://www.forduruapan.mx/Seminuevos/',
  canonicalUrl: 'https://www.forduruapan.mx/Seminuevos/',
  pageType: 'used_vehicle',
  title: 'Seminuevos',
  rawHtml: '<main></main>',
  extractedText: '',
  contentHash: 'used',
  metadata: {},
};

const promotionPage: StoredPage = {
  id: 2,
  url: 'https://www.forduruapan.mx/Promociones/',
  canonicalUrl: 'https://www.forduruapan.mx/Promociones/',
  pageType: 'promotion',
  title: 'Promociones',
  rawHtml: '<main></main>',
  extractedText: '',
  contentHash: 'promotion',
  metadata: {},
};

const financingPage: StoredPage = {
  id: 3,
  url: 'https://www.forduruapan.mx/Financiamiento/',
  canonicalUrl: 'https://www.forduruapan.mx/Financiamiento/',
  pageType: 'financing',
  title: 'Financiamiento',
  rawHtml: '<main></main>',
  extractedText: '',
  contentHash: 'financing',
  metadata: {},
};

describe('SiteSynchronizationService', () => {
  it('dispatches changed pages and refreshes financing before embedding', async () => {
    const crawler = {
      crawl: vi.fn().mockResolvedValue({
        fetched: 3,
        changed: 1,
        failed: 0,
        discoveredUrls: [],
        changedPages: [promotionPage],
        errors: [],
      }),
    };
    const pages = {
      getByUrl: vi.fn(async (url: string) =>
        url.includes('Seminuevos') ? usedPage : financingPage,
      ),
    };
    const ingestPage = vi.fn().mockResolvedValue({
      processed: true,
      documents: 1,
      warnings: 0,
    });
    const usedVehicles = {
      syncSnapshot: vi.fn().mockResolvedValue({
        seen: 0,
        changed: 0,
        deactivated: 0,
      }),
    };
    const financing = {
      sync: vi.fn().mockResolvedValue({
        activeVehicles: 1,
        versions: 1,
        offers: 1,
      }),
    };
    const embeddings = {
      run: vi.fn().mockResolvedValue({pending: 0, embedded: 2, failed: 0}),
    };
    const runs = {
      start: vi.fn().mockResolvedValue('run-1'),
      finish: vi.fn().mockResolvedValue(undefined),
      fail: vi.fn().mockResolvedValue(undefined),
    };
    const lock = {
      tryAcquire: vi.fn().mockResolvedValue(true),
      release: vi.fn().mockResolvedValue(undefined),
    };

    const service = new SiteSynchronizationService({
      crawler,
      pages,
      ingestPage,
      usedVehicles,
      financing,
      embeddings,
      runs,
      lock,
    });

    await expect(
      service.run({
        targets: [
          'https://www.forduruapan.mx/Todos/',
          'https://www.forduruapan.mx/Seminuevos/',
          'https://www.forduruapan.mx/Promociones/',
          'https://www.forduruapan.mx/Financiamiento/',
        ],
        maxPages: 100,
        embeddingLimit: 10,
      }),
    ).resolves.toMatchObject({
      pagesFetched: 3,
      pagesChanged: 1,
      usedVehiclesSeen: 0,
      offersUpserted: 1,
      embeddingsReady: 2,
    });
    expect(ingestPage).toHaveBeenCalledWith(promotionPage);
    expect(usedVehicles.syncSnapshot).toHaveBeenCalledOnce();
    expect(financing.sync).toHaveBeenCalledWith(financingPage);
    expect(runs.finish).toHaveBeenCalledWith('run-1', expect.any(Object));
    expect(lock.tryAcquire).toHaveBeenCalledWith('forduruapan-site-sync');
    expect(lock.release).toHaveBeenCalledWith('forduruapan-site-sync');
  });
});
