import {describe, expect, it, vi} from 'vitest';
import {HttpPageFetcher} from '../../src/crawl/http-fetcher.js';
import {HttpSitePageFetcher} from '../../src/crawl/http-site-fetcher.js';

describe('HttpSitePageFetcher', () => {
  it('turns an SSR HTML response into a classified stored page', async () => {
    const http = new HttpPageFetcher(
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            '<html><head><title>Ford Territory</title></head><body><h1>Territory 2026</h1><p>Familia</p></body></html>',
            {status: 200, headers: {'content-type': 'text/html'}},
          ),
        ),
    );
    const fetcher = new HttpSitePageFetcher(
      http,
      new URL('https://www.forduruapan.mx'),
    );

    await expect(
      fetcher.fetch('https://www.forduruapan.mx/TERRITORY/26/'),
    ).resolves.toMatchObject({
      sourceBaseUrl: 'https://www.forduruapan.mx',
      sourceName: 'Ford Uruapan',
      pageType: 'model',
      title: 'Ford Territory',
      extractedText: 'Territory 2026 Familia',
      status: 200,
    });
  });
});
