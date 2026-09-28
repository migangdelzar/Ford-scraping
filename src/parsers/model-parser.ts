import {load} from 'cheerio';
import type {
  ParseResult,
  StoredPage,
  VehicleCandidate,
} from '../domain/contracts.js';
import {normalizeSpecName} from '../domain/normalization.js';
import {parseTechnicalSheet} from './technical-sheet-parser.js';
import type {PageParser} from '../crawl/page-parser.js';

function getModelYear(title: string, url: string): number {
  const match = `${title} ${url}`.match(/20\d{2}/);
  if (!match) throw new Error(`Model page has no model year: ${url}`);
  return Number(match[0]);
}

function getModelName(title: string): string {
  return title
    .replace(/\s*\|\s*Ford Uruapan.*$/i, '')
    .replace(/^Ford\s+/i, '')
    .replace(/\b20\d{2}\b/g, '')
    .trim();
}

export class ModelParser implements PageParser<VehicleCandidate> {
  supports(page: StoredPage): boolean {
    return page.pageType === 'model';
  }

  parse(page: StoredPage): ParseResult<VehicleCandidate> {
    const $ = load(page.rawHtml);
    const title = $('h1').first().text().trim() || page.title;
    const description =
      $('.description').first().text().trim() ||
      $('main > p').first().text().trim();
    const sections: Record<string, string> = {};
    $('section[data-section]').each((_, element) => {
      const key = ($(element).attr('data-section') ?? '')
        .trim()
        .toLocaleLowerCase('es-MX');
      const heading = $(element).find('h2, h3').first();
      heading.remove();
      sections[key] = $(element).text().replace(/\s+/g, ' ').trim();
    });

    const images = $('img[src]')
      .map((_, element) => ({
        url: new URL($(element).attr('src')!, page.url).toString(),
        altText: $(element).attr('alt') || undefined,
      }))
      .get();
    const technicalSpecs = parseTechnicalSheet({
      ...page,
      pageType: 'technical_sheet',
    }).value;

    return {
      value: {
        modelName: getModelName(title),
        modelYear: getModelYear(title, page.url),
        title,
        description,
        sections,
        specifications: technicalSpecs,
        features: Object.entries(sections).flatMap(([category, text]) =>
          text ? [{name: text, category}] : [],
        ),
        images,
        sourceUrl: page.url,
      },
      warnings: [],
    };
  }
}

export function parseModelPage(
  page: StoredPage,
): ParseResult<VehicleCandidate> {
  return new ModelParser().parse(page);
}

export {normalizeSpecName};
