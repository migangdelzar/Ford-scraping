import 'dotenv/config';
import {loadConfig} from './config.js';
import {loadRuntimeEnvironment} from './secrets/runtime-secrets.js';
import {runMigrations} from './storage/database.js';
import {createApplication} from './composition-root.js';
import {buildApiApp} from './api/app.js';
import {serveMcpStdio} from './mcp/server.js';
import {startMcpHttpServer} from './mcp/http.js';
import {
  crawlCatalog,
  crawlTargets,
  PlaywrightPageFetcher,
} from './crawl/crawler.js';
import {ingestPages} from './crawl/ingestion.js';
import {buildOfferDocument} from './domain/offers.js';
import {EmbeddingWorker} from './embeddings/worker.js';
import {createEmbeddingProvider} from './embeddings/provider.js';
import cron from 'node-cron';
import {DailySyncScheduler} from './scheduler.js';

function option(name: string, fallback: number): number {
  const value = process.argv
    .find(argument => argument.startsWith(`--${name}=`))
    ?.split('=')[1];
  const parsed = value ? Number(value) : fallback;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'help';
  const environment = await loadRuntimeEnvironment(process.env, {command});
  const config = loadConfig(environment);

  if (command === 'migrate') {
    const application = createApplication(config);
    await runMigrations(application.pool);
    await application.close();
    return;
  }

  if (command === 'mcp-http' && !config.mcpHttp.bearerToken) {
    throw new Error(
      'MCP_HTTP_BEARER_TOKEN is required when starting the MCP HTTP server',
    );
  }

  const application = createApplication(config);

  if (command === 'api') {
    const app = buildApiApp(application.apiServices);
    await app.listen({host: config.http.host, port: config.http.port});
    return;
  }

  if (command === 'mcp') {
    const handle = serveMcpStdio(application.mcpServices);
    const close = async () => {
      await handle.close();
      await application.close();
    };
    process.once('SIGINT', () => void close());
    process.once('SIGTERM', () => void close());
    return;
  }

  if (command === 'mcp-http') {
    const handle = await startMcpHttpServer(
      application.mcpServices,
      config.mcpHttp,
    );
    const address = handle.address();
    console.error(
      `MCP HTTP server listening on http://${address.host}:${address.port}/mcp`,
    );
    const close = async () => {
      await handle.close();
      await application.close();
    };
    process.once('SIGINT', () => void close());
    process.once('SIGTERM', () => void close());
    return;
  }

  if (command === 'crawl') {
    const fetcher = new PlaywrightPageFetcher(config.fordBaseUrl);
    try {
      const summary = await crawlCatalog({
        startUrl: new URL('/Todos/', config.fordBaseUrl).toString(),
        policy: {
          baseUrl: config.fordBaseUrl,
          allowedHosts: new Set([config.fordBaseUrl.hostname]),
        },
        fetcher,
        pages: application.pages,
        maxPages: option('max-pages', config.crawl.maxPages),
      });
      console.error(JSON.stringify(summary, null, 2));
    } finally {
      await fetcher.close();
      await application.close();
    }
    return;
  }

  if (command === 'crawl-comparisons') {
    const links = await application.pool.query<{url: string}>(
      `SELECT min(target_url) AS url
       FROM ford.page_links
       WHERE target_url ILIKE '%/Comparativo/%'
       GROUP BY split_part(split_part(target_url, '?', 1), '#', 1)
       ORDER BY 1`,
    );
    const fetcher = new PlaywrightPageFetcher(config.fordBaseUrl);
    try {
      const summary = await crawlTargets({
        startUrls: links.rows.map(row => row.url),
        policy: {
          baseUrl: config.fordBaseUrl,
          allowedHosts: new Set([config.fordBaseUrl.hostname]),
        },
        fetcher,
        pages: application.pages,
        maxPages: option('max-pages', config.crawl.maxPages),
      });
      const {changedPages, ...report} = summary;
      console.error(
        JSON.stringify(
          {
            ...report,
            changedPageCount: changedPages.length,
            targetRoutes: links.rowCount,
          },
          null,
          2,
        ),
      );
    } finally {
      await fetcher.close();
      await application.close();
    }
    return;
  }

  if (command === 'ingest') {
    const summary = await ingestPages(
      application.pages,
      application.catalog,
      application.documents,
      option('limit', 100),
      application.offers,
      application.comparisonsRepo,
    );
    console.error(JSON.stringify(summary, null, 2));
    await application.close();
    return;
  }

  if (command === 'refresh-offer-documents') {
    const offers = await application.offers.listForDocumentRefresh();
    for (const offer of offers) {
      await application.documents.upsertOfferDocument(
        offer.ref,
        buildOfferDocument(offer.candidate),
        offer.pageId,
      );
    }
    console.error(JSON.stringify({offersRefreshed: offers.length}));
    await application.close();
    return;
  }

  if (command === 'sync-financing') {
    const financingUrl = new URL(
      '/Financiamiento/',
      config.fordBaseUrl,
    ).toString();
    const page = await application.pages.getByUrl(financingUrl);
    if (!page) {
      throw new Error(
        `Financing page is not stored. Run crawl first: ${financingUrl}`,
      );
    }
    const summary = await application.financingSync.sync(page);
    console.error(JSON.stringify(summary, null, 2));
    await application.close();
    return;
  }

  if (command === 'sync') {
    const targets = [
      new URL('/Todos/', config.fordBaseUrl).toString(),
      new URL('/Seminuevos/', config.fordBaseUrl).toString(),
      new URL('/Promociones/', config.fordBaseUrl).toString(),
      new URL('/Financiamiento/', config.fordBaseUrl).toString(),
    ];
    const summary = await application.synchronization.run({
      targets,
      financingUrl: targets[3],
      maxPages: option('max-pages', config.crawl.maxPages),
      embeddingLimit: option('embedding-limit', 100),
    });
    console.error(JSON.stringify(summary, null, 2));
    await application.close();
    return;
  }

  if (command === 'scheduler') {
    const targets = [
      new URL('/Todos/', config.fordBaseUrl).toString(),
      new URL('/Seminuevos/', config.fordBaseUrl).toString(),
      new URL('/Promociones/', config.fordBaseUrl).toString(),
      new URL('/Financiamiento/', config.fordBaseUrl).toString(),
    ];
    const scheduler = new DailySyncScheduler(
      {
        schedule: (expression, task, options) =>
          cron.schedule(expression, task, options),
      },
      async () => {
        try {
          const summary = await application.synchronization.run({
            targets,
            financingUrl: targets[3],
            maxPages: config.crawl.maxPages,
            embeddingLimit: 100,
          });
          console.error(JSON.stringify(summary, null, 2));
        } catch (error) {
          console.error(error instanceof Error ? error.message : error);
        }
      },
    );
    scheduler.start(config.sync);
    console.error(
      `Scheduler active: ${config.sync.schedule} (${config.sync.timezone})`,
    );
    return;
  }

  if (command === 'embed') {
    const embeddingProvider = createEmbeddingProvider(config.embedding);
    const worker = new EmbeddingWorker(
      application.documents,
      embeddingProvider,
    );
    console.error(
      JSON.stringify(await worker.run({limit: option('limit', 100)}), null, 2),
    );
    await application.close();
    return;
  }

  console.error(
    'Commands: migrate | crawl | crawl-comparisons | ingest | refresh-offer-documents | sync | scheduler | sync-financing | embed | api | mcp | mcp-http',
  );
  await application.close();
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
