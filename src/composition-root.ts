import type {AppConfig} from './config.js';
import {createPool} from './storage/database.js';
import {PageRepository} from './storage/page-repository.js';
import {CatalogRepository} from './storage/catalog-repository.js';
import {DocumentRepository} from './storage/document-repository.js';
import {OfferRepository} from './storage/offer-repository.js';
import {ComparisonRepository} from './storage/comparison-repository.js';
import {SearchRepository} from './storage/search-repository.js';
import {createEmbeddingProvider} from './embeddings/provider.js';
import {SearchService} from './search/search-service.js';
import {OfferSearchService} from './search/offer-search-service.js';
import {
  VehicleQueryService,
  ProvenanceService,
  PromotionService,
  CatalogStatusService,
  PageLinkService,
  ComparisonService,
} from './storage/read-services.js';
import {FordFinanceClient} from './finance/ford-finance-client.js';
import {FinancingSyncService} from './finance/financing-sync.js';
import {HttpPageFetcher} from './crawl/http-fetcher.js';
import {HttpSitePageFetcher} from './crawl/http-site-fetcher.js';
import {UsedVehicleInventoryClient} from './crawl/used-vehicle-api.js';
import {crawlTargets} from './crawl/crawler.js';
import {ingestPage} from './crawl/ingestion.js';
import {SiteSynchronizationService} from './crawl/site-synchronization.js';
import {UsedVehicleRepository} from './storage/used-vehicle-repository.js';
import {SyncRunRepository} from './storage/sync-run-repository.js';
import {PostgresAdvisoryLock} from './storage/sync-lock.js';
import {EmbeddingWorker} from './embeddings/worker.js';
import {createLangfuseTelemetry} from './observability/langfuse.js';
import type {ApiServices} from './api/app.js';
import type {McpServices} from './mcp/server.js';

export function createApplication(config: AppConfig) {
  const pool = createPool(config.databaseUrl);
  const telemetry = createLangfuseTelemetry(config.langfuse);
  void telemetry.start();
  const pages = new PageRepository(pool);
  const catalog = new CatalogRepository(pool);
  const documents = new DocumentRepository(pool);
  const offers = new OfferRepository(pool);
  const comparisonsRepo = new ComparisonRepository(pool);
  const usedVehicles = new UsedVehicleRepository(pool);
  const syncRuns = new SyncRunRepository(pool);
  const syncLock = new PostgresAdvisoryLock(pool);
  const financeClient = new FordFinanceClient({baseUrl: config.fordBaseUrl});
  const financingSync = new FinancingSyncService(
    financeClient,
    offers,
    documents,
  );
  const embeddingProvider = createEmbeddingProvider({
    provider: config.embedding.provider,
    apiKey: config.embedding.apiKey,
    apiUrl: config.embedding.apiUrl,
    model: config.embedding.model,
    dimensions: config.embedding.dimensions,
  });
  const searchRepository = new SearchRepository(pool);
  const search = new SearchService(
    searchRepository,
    embeddingProvider,
    telemetry.observability,
  );
  const offerSearch = new OfferSearchService(
    searchRepository,
    embeddingProvider,
    telemetry.observability,
  );
  const httpFetcher = new HttpPageFetcher();
  const siteFetcher = new HttpSitePageFetcher(httpFetcher, config.fordBaseUrl);
  const usedVehicleUrl = new URL('/Seminuevos/', config.fordBaseUrl).toString();
  const usedInventory = new UsedVehicleInventoryClient(
    () =>
      httpFetcher.postJson(
        new URL(
          '/SeminuevosMotorV3/info/consultas.aspx',
          config.fordBaseUrl,
        ).toString(),
        {r: 'CheckDist'},
        {referer: usedVehicleUrl},
      ),
    usedVehicleUrl,
  );
  const embeddingWorker = new EmbeddingWorker(documents, embeddingProvider);
  const synchronization = new SiteSynchronizationService({
    crawler: {
      crawl: input =>
        crawlTargets({
          startUrls: input.startUrls,
          maxPages: input.maxPages,
          policy: {
            baseUrl: config.fordBaseUrl,
            allowedHosts: new Set([config.fordBaseUrl.hostname]),
          },
          fetcher: siteFetcher,
          pages,
        }),
    },
    pages,
    ingestPage: page => ingestPage(page, catalog, documents, offers, comparisonsRepo),
    usedVehicles,
    usedInventory,
    financing: financingSync,
    embeddings: embeddingWorker,
    runs: syncRuns,
    lock: syncLock,
  });
  const vehicles = new VehicleQueryService(pool);
  const provenance = new ProvenanceService(pool);
  const links = new PageLinkService(pool);
  const promotions = new PromotionService(pool);
  const comparisons = new ComparisonService(pool);
  const catalogStatus = new CatalogStatusService(pool);

  const apiServices: ApiServices = {
    search,
    vehicles,
    health: () => catalogStatus.status(),
  };
  const mcpServices: McpServices = {
    search,
    vehicles,
    provenance,
    links,
    promotions,
    offers: offerSearch,
    catalog: catalogStatus,
    comparisons,
  };

  return {
    pool,
    telemetry,
    async close() {
      await telemetry.shutdown();
      await pool.end();
    },
    pages,
    catalog,
    documents,
    offers,
    comparisonsRepo,
    financeClient,
    financingSync,
    synchronization,
    search,
    offerSearch,
    vehicles,
    provenance,
    links,
    promotions,
    comparisons,
    catalogStatus,
    apiServices,
    mcpServices,
  };
}
