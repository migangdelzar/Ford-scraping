import {load} from 'cheerio';
import {classifyPage} from './page-classifier.js';
import type {PageType} from '../domain/contracts.js';
import {HttpPageFetcher, type HttpFetchOptions} from './http-fetcher.js';
import type {FetchedPage} from '../storage/page-repository.js';

export interface HttpSiteFetcher {
  fetch(url: string, options?: HttpFetchOptions): Promise<FetchedPage>;
}

export class HttpSitePageFetcher implements HttpSiteFetcher {
  constructor(
    private readonly http: HttpPageFetcher,
    private readonly baseUrl: URL,
    private readonly sourceName = 'Ford Uruapan',
  ) {}

  async fetch(url: string, options?: HttpFetchOptions): Promise<FetchedPage> {
    const response = await this.http.fetch(url, options);
    const $ = load(response.rawHtml);
    const title = $('title').text().trim() || $('h1').first().text().trim();
    const body = $('body').clone();
    body.find('script, style, noscript').remove();
    const extractedText = (body.html() ?? '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const pageType: PageType = classifyPage(new URL(url), title, extractedText);
    return {
      sourceBaseUrl: this.baseUrl.origin,
      sourceName: this.sourceName,
      url,
      canonicalUrl: url,
      pageType,
      status: response.status,
      contentType: response.contentType,
      title,
      rawHtml: response.rawHtml,
      extractedText,
      contentHash: response.contentHash,
      metadata: {transport: 'http-get', parser: 'cheerio'},
    };
  }
}
