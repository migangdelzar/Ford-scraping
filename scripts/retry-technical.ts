import {load} from 'cheerio';
import {loadConfig} from '../src/config.js';
import {createApplication} from '../src/composition-root.js';
import {PlaywrightPageFetcher} from '../src/crawl/crawler.js';
import {normalizeUrl} from '../src/crawl/url-policy.js';

const config = loadConfig(process.env);
const application = createApplication(config);
const canonicalTechnicalUrl = (url: string): string =>
  normalizeUrl(url, config.fordBaseUrl).replace(/\/$/, '');

try {
  const pages = await application.pages.list(1000);
  const modelPages = pages.filter(page => page.pageType === 'model');
  const technicalUrls = new Set<string>();

  for (const modelPage of modelPages) {
    const $ = load(modelPage.rawHtml);
    $('a[href]').each((_, element) => {
      const href = $(element).attr('href');
      if (href && /ficha-tecnica/i.test(href)) {
        technicalUrls.add(
          canonicalTechnicalUrl(new URL(href, modelPage.url).toString()),
        );
      }
    });
  }

  const storedTechnicalUrls = new Set(
    pages
      .filter(page => page.pageType === 'technical_sheet')
      .map(page => canonicalTechnicalUrl(page.url)),
  );
  const missingUrls = [...technicalUrls].filter(
    url => !storedTechnicalUrls.has(url),
  );
  console.error(
    JSON.stringify(
      {
        discoveredTechnical: technicalUrls.size,
        alreadyStored: storedTechnicalUrls.size,
        missing: missingUrls.length,
        missingUrls,
      },
      null,
      2,
    ),
  );

  const fetcher = new PlaywrightPageFetcher(config.fordBaseUrl);
  let fetched = 0;
  let changed = 0;
  const errors: Array<{url: string; error: string}> = [];

  try {
    for (const url of missingUrls) {
      try {
        const fetchedPage = await fetcher.fetch(url);
        const change = await application.pages.upsert(fetchedPage);
        fetched += 1;
        if (change.changed) changed += 1;
        console.error('OK', url);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push({url, error: message});
        console.error('ERROR', url, message);
      }
    }
  } finally {
    await fetcher.close();
  }

  console.log(
    JSON.stringify({fetched, changed, failed: errors.length, errors}, null, 2),
  );
} finally {
  await application.pool.end();
}
