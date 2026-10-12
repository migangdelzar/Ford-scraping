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
  const year =
    new URL(url).pathname.match(/\/(20\d{2}|\d{2})\/?$/)?.[1] ??
    title.match(/20\d{2}/)?.[0];
  if (!year) throw new Error(`Model page has no model year: ${url}`);
  return Number(year.length === 2 ? `20${year}` : year);
}

function getModelName(title: string): string {
  return title
    .replace(/\s*\|\s*Ford Uruapan.*$/i, '')
    .replace(/^Ford\s+/i, '')
    .replace(/\b20\d{2}\b/g, '')
    .trim();
}

function getModelNameFromUrl(url: string): string | undefined {
  const slug = new URL(url).pathname.match(/^\/([^/]+)\/(?:20\d{2}|\d{2})\/?$/)?.[1];
  if (!slug) return undefined;
  return decodeURIComponent(slug)
    .split(/[-_]+/)
    .filter(Boolean)
    .map(part => `${part[0].toLocaleUpperCase('es-MX')}${part.slice(1).toLocaleLowerCase('es-MX')}`)
    .join(' ');
}

export class ModelParser implements PageParser<VehicleCandidate> {
  supports(page: StoredPage): boolean {
    return page.pageType === 'model';
  }

  parse(page: StoredPage): ParseResult<VehicleCandidate> {
    const $ = load(page.rawHtml);
    const title =
      page.title.trim() ||
      $('main h1, .titulo-ficha, h1').first().text().trim() ||
      new URL(page.url).pathname;
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
        width: positiveInteger($(element).attr('width')),
        height: positiveInteger($(element).attr('height')),
      }))
      .filter((_, image) =>
        /\/Assets\/ModelosNuevos\/Img\/(?:Modelos|Home)\//i.test(
          new URL(image.url).pathname,
        ),
      )
      .map((_, image) => ({
        ...image,
        imageType: imageType(image.url),
      }))
      .get();
    const variants = $('#menuver input[data-idvers]')
      .map((_, element) => {
        const input = $(element);
        const name = input
          .closest('.form-check')
          .find('label')
          .first()
          .text()
          .replace(/\s+/g, ' ')
          .trim();
        const externalId = input.attr('data-idvers')?.trim();
        return name
          ? {name, ...(externalId ? {externalId} : {})}
          : undefined;
      })
      .get()
      .filter((variant): variant is {name: string; externalId?: string} =>
        Boolean(variant),
      );
    const technicalSpecs = parseTechnicalSheet({
      ...page,
      pageType: 'technical_sheet',
    }).value;

    return {
      value: {
        modelName: getModelNameFromUrl(page.url) ?? getModelName(title),
        modelYear: getModelYear(title, page.url),
        title,
        description,
        sections,
        specifications: technicalSpecs,
        features: Object.entries(sections).flatMap(([category, text]) =>
          text ? [{name: text, category}] : [],
        ),
        images,
        variants,
        sourceUrl: page.url,
      },
      warnings: [],
    };
  }
}

function positiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function imageType(url: string): string {
  const path = new URL(url).pathname.toLocaleLowerCase('es-MX');
  if (path.includes('/colores')) return 'color';
  if (path.includes('/versiones')) return 'trim';
  if (path.includes('/home/')) return 'hero';
  return 'model';
}

export function parseModelPage(
  page: StoredPage,
): ParseResult<VehicleCandidate> {
  return new ModelParser().parse(page);
}

export {normalizeSpecName};
