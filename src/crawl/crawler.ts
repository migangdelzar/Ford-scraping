import {createHash} from 'node:crypto';
import {load} from 'cheerio';
import {chromium, type Browser, type Page} from 'playwright';
import {classifyPage} from './page-classifier.js';
import {extractPageLinks} from './page-links.js';
import {parseCatalogPage} from '../parsers/catalog-parser.js';
import {
  isCrawlablePublicPage,
  normalizeUrl,
  type CrawlPolicy,
} from './url-policy.js';
import type {PageType, StoredPage} from '../domain/contracts.js';
import {
  PageRepository,
  type FetchedPage,
  type PageChange,
} from '../storage/page-repository.js';

export interface PageFetcher {
  fetch(url: string): Promise<FetchedPage>;
}

export interface PageSink {
  upsert(page: FetchedPage): Promise<PageChange>;
}

export interface CrawlOptions {
  startUrl: string;
  policy: CrawlPolicy;
  fetcher: PageFetcher;
  pages: PageSink | PageRepository;
  maxPages: number;
}

export interface CrawlSummary {
  fetched: number;
  changed: number;
  failed: number;
  discoveredUrls: string[];
  changedPages: StoredPage[];
  errors: Array<{url: string; error: string}>;
}

export async function crawlCatalog(
  options: CrawlOptions,
): Promise<CrawlSummary> {
  return crawlTargets({...options, startUrls: [options.startUrl]});
}

export async function crawlTargets(
  options: Omit<CrawlOptions, 'startUrl'> & {startUrls: string[]},
): Promise<CrawlSummary> {
  const queue = options.startUrls.map(startUrl =>
    normalizeUrl(startUrl, options.policy.baseUrl),
  );
  const visited = new Set<string>();
  const discovered = new Set<string>();
  const summary: CrawlSummary = {
    fetched: 0,
    changed: 0,
    failed: 0,
    discoveredUrls: [],
    changedPages: [],
    errors: [],
  };

  while (queue.length && visited.size < options.maxPages) {
    const url = queue.shift()!;
    if (visited.has(url) || !isCrawlablePublicPage(new URL(url), options.policy))
      continue;
    visited.add(url);
    try {
      const fetched = await options.fetcher.fetch(url);
      const change = await options.pages.upsert(fetched);
      summary.fetched += 1;
      if (change.changed) {
        summary.changed += 1;
        summary.changedPages.push(change.page);
      }
      for (const link of extractPageLinks(fetched.rawHtml, url)) {
        if (!link.internal) continue;
        // Follow model facts and their linked Comparativo pages; unrelated
        // public links remain available via get_page_links.
        if (!['catalog', 'model', 'technical_sheet'].includes(fetched.pageType))
          continue;
        const child = normalizeUrl(link.targetUrl, options.policy.baseUrl);
        if (isCrawlablePublicPage(new URL(child), options.policy)) {
          if (!isCatalogRoute(new URL(child))) continue;
          discovered.add(child);
          if (!visited.has(child)) queue.push(child);
        }
      }
      if (fetched.pageType === 'catalog') {
        for (const vehicle of parseCatalogPage({
          ...fetched,
          title: fetched.title ?? '',
          pageType: 'catalog',
        }).value) {
          const child = normalizeUrl(vehicle.sourceUrl, options.policy.baseUrl);
          if (!isCrawlablePublicPage(new URL(child), options.policy)) continue;
          discovered.add(child);
          if (!visited.has(child)) queue.push(child);
        }
      }
      if (fetched.pageType === 'model') {
        const modelUrl = new URL(url);
        if (/\/(20\d{2}|\d{2})\/?$/.test(modelUrl.pathname)) {
          const detailUrl = normalizeUrl(
            new URL(
              'Ficha-Tecnica/',
              url.endsWith('/') ? url : `${url}/`,
            ).toString(),
            options.policy.baseUrl,
          );
          if (isCrawlablePublicPage(new URL(detailUrl), options.policy)) {
            discovered.add(detailUrl);
            if (!visited.has(detailUrl)) queue.push(detailUrl);
          }
        }
      }
    } catch (error) {
      summary.failed += 1;
      summary.errors.push({
        url,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  summary.discoveredUrls = [...discovered];
  return summary;
}

function isCatalogRoute(url: URL): boolean {
  const path = url.pathname.toLocaleLowerCase('es-MX');
  return (
    path.includes('/todos') ||
    path.includes('ficha-tecnica') ||
    path.includes('/comparativo/') ||
    /\/(20\d{2}|2\d)\/?$/.test(path)
  );
}

export class PlaywrightPageFetcher implements PageFetcher {
  private browser?: Browser;
  private page?: Page;

  constructor(
    private readonly baseUrl: URL,
    private readonly locale = 'es-MX',
  ) {}

  async fetch(url: string): Promise<FetchedPage> {
    this.browser ??= await chromium.launch({headless: true});
    if (!this.page) {
      const context = await this.browser.newContext({locale: this.locale});
      this.page = await context.newPage();
    }
    const response = await this.page.goto(url, {
      waitUntil: 'networkidle',
      timeout: 60_000,
    });
    if (!response) throw new Error(`No response received for ${url}`);
    const rawHtml = await this.page.content();
    const $ = load(rawHtml);
    const title = $('title').text().trim() || $('h1').first().text().trim();
    const extractedText = $('body').text().replace(/\s+/g, ' ').trim();
    const pageType: PageType = classifyPage(new URL(url), title, extractedText);
    const contentHash = createHash('sha256').update(rawHtml).digest('hex');
    return {
      sourceBaseUrl: this.baseUrl.origin,
      sourceName: 'Ford Uruapan',
      url,
      canonicalUrl: url,
      pageType,
      status: response.status(),
      contentType: response.headers()['content-type'],
      title,
      rawHtml,
      extractedText,
      contentHash,
      metadata: {},
    };
  }

  async close(): Promise<void> {
    await this.browser?.close();
  }
}
