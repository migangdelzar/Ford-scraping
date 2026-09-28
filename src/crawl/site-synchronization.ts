import type {PageIngestionSummary} from './ingestion.js';
import {parseUsedVehiclePage} from '../parsers/used-vehicle-parser.js';
import type {StoredPage, UsedVehicleCandidate} from '../domain/contracts.js';
import type {SyncRunCounters} from '../domain/sync.js';

export interface SiteCrawlerResult {
  fetched: number;
  changed: number;
  failed: number;
  changedPages: StoredPage[];
  discoveredUrls: string[];
  errors: Array<{url: string; error: string}>;
}

export interface SiteCrawlerPort {
  crawl(input: {
    startUrls: string[];
    maxPages: number;
  }): Promise<SiteCrawlerResult>;
}

export interface SitePageReader {
  getByUrl(url: string): Promise<StoredPage | null>;
}

export interface SitePageIngestor {
  (page: StoredPage): Promise<PageIngestionSummary>;
}

export interface UsedVehicleSnapshotWriter {
  syncSnapshot(
    records: UsedVehicleCandidate[],
    page: StoredPage,
  ): Promise<{seen: number; changed: number; deactivated: number}>;
}

export interface UsedVehicleInventoryPort {
  fetch(): Promise<UsedVehicleCandidate[]>;
}

export interface FinancingSynchronizer {
  sync(page: StoredPage): Promise<{
    activeVehicles: number;
    versions: number;
    offers: number;
  }>;
}

export interface EmbeddingRunner {
  run(options: {limit: number}): Promise<{
    pending: number;
    embedded: number;
    failed: number;
  }>;
}

export interface SyncRunWriter {
  start(runType: string): Promise<string>;
  finish(runId: string, counters: SyncRunCounters): Promise<void>;
  fail(runId: string, error: unknown): Promise<void>;
}

export interface SyncLockPort {
  tryAcquire(key: string): Promise<boolean>;
  release(key: string): Promise<void>;
}

export interface SiteSynchronizationDependencies {
  crawler: SiteCrawlerPort;
  pages: SitePageReader;
  ingestPage: SitePageIngestor;
  usedVehicles: UsedVehicleSnapshotWriter;
  usedInventory?: UsedVehicleInventoryPort;
  financing: FinancingSynchronizer;
  embeddings: EmbeddingRunner;
  runs: SyncRunWriter;
  lock?: SyncLockPort;
}

export interface SiteSynchronizationOptions {
  targets: string[];
  financingUrl?: string;
  usedVehicleUrl?: string;
  maxPages: number;
  embeddingLimit: number;
}

export class SiteSynchronizationService {
  constructor(private readonly dependencies: SiteSynchronizationDependencies) {}

  async run(options: SiteSynchronizationOptions): Promise<SyncRunCounters> {
    const lockKey = 'forduruapan-site-sync';
    const acquired = this.dependencies.lock
      ? await this.dependencies.lock.tryAcquire(lockKey)
      : true;
    if (!acquired) throw new Error('Site synchronization is already running');

    let runId: string | undefined;
    try {
      runId = await this.dependencies.runs.start('site');
      const crawl = await this.dependencies.crawler.crawl({
        startUrls: options.targets,
        maxPages: options.maxPages,
      });
      const counters: SyncRunCounters = {
        pagesFetched: crawl.fetched,
        pagesChanged: crawl.changed,
        pagesFailed: crawl.failed,
        documentsProcessed: 0,
        warnings: 0,
        usedVehiclesSeen: 0,
        usedVehiclesChanged: 0,
        usedVehiclesDeactivated: 0,
        offersUpserted: 0,
        embeddingsReady: 0,
        embeddingFailures: 0,
      };

      const usedRootUrl =
        options.usedVehicleUrl ??
        options.targets.find(url => /seminuevo|usado/i.test(url));
      let usedSnapshotUrl: string | undefined;

      for (const page of crawl.changedPages) {
        if (page.pageType === 'used_vehicle') {
          const records =
            page.url === usedRootUrl && this.dependencies.usedInventory
              ? await this.dependencies.usedInventory.fetch()
              : parseUsedVehiclePage(page).value;
          await syncUsedRecords(
            records,
            page,
            counters,
            this.dependencies.usedVehicles,
          );
          if (page.url === usedRootUrl) usedSnapshotUrl = page.url;
          continue;
        }

        const ingestion = await this.dependencies.ingestPage(page);
        addIngestionCounters(counters, ingestion);
      }

      if (usedRootUrl && usedSnapshotUrl !== usedRootUrl) {
        const usedPage = await this.dependencies.pages.getByUrl(usedRootUrl);
        if (usedPage) {
          const records = this.dependencies.usedInventory
            ? await this.dependencies.usedInventory.fetch()
            : parseUsedVehiclePage(usedPage).value;
          await syncUsedRecords(
            records,
            usedPage,
            counters,
            this.dependencies.usedVehicles,
          );
        }
      }

      const financingUrl =
        options.financingUrl ??
        options.targets.find(url => /financiamiento/i.test(url));
      if (financingUrl) {
        const financingPage =
          await this.dependencies.pages.getByUrl(financingUrl);
        if (financingPage) {
          const financing =
            await this.dependencies.financing.sync(financingPage);
          counters.offersUpserted = financing.offers;
          counters.financingVehicles = financing.activeVehicles;
          counters.financingVersions = financing.versions;
        }
      }

      const embedding = await this.dependencies.embeddings.run({
        limit: options.embeddingLimit,
      });
      counters.embeddingsReady = embedding.embedded;
      counters.embeddingFailures = embedding.failed;
      counters.documentsPending = embedding.pending;
      await this.dependencies.runs.finish(runId, counters);
      return counters;
    } catch (error) {
      if (runId) await this.dependencies.runs.fail(runId, error);
      throw error;
    } finally {
      if (this.dependencies.lock) await this.dependencies.lock.release(lockKey);
    }
  }
}

function addIngestionCounters(
  counters: SyncRunCounters,
  ingestion: PageIngestionSummary,
): void {
  counters.documentsProcessed =
    (counters.documentsProcessed ?? 0) + ingestion.documents;
  counters.warnings = (counters.warnings ?? 0) + ingestion.warnings;
}

async function syncUsedRecords(
  records: UsedVehicleCandidate[],
  page: StoredPage,
  counters: SyncRunCounters,
  writer: UsedVehicleSnapshotWriter,
): Promise<void> {
  const used = await writer.syncSnapshot(records, page);
  counters.usedVehiclesSeen = (counters.usedVehiclesSeen ?? 0) + used.seen;
  counters.usedVehiclesChanged =
    (counters.usedVehiclesChanged ?? 0) + used.changed;
  counters.usedVehiclesDeactivated =
    (counters.usedVehiclesDeactivated ?? 0) + used.deactivated;
}
