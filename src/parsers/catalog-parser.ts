import {load} from 'cheerio';
import type {
  CatalogCandidate,
  ParseResult,
  StoredPage,
} from '../domain/contracts.js';
import {normalizeModelName} from '../domain/normalization.js';
import type {PageParser} from '../crawl/page-parser.js';
import {parseMoney, sanitizeText} from '../crawl/text-normalization.js';

function displayModelName(value: string): string {
  return value
    .replace(/\b20\d{2}\b/g, '')
    .trim()
    .replace(/^Ford\s+/i, '');
}

export class CatalogParser implements PageParser<CatalogCandidate[]> {
  supports(page: StoredPage): boolean {
    return page.pageType === 'catalog';
  }

  parse(page: StoredPage): ParseResult<CatalogCandidate[]> {
    const $ = load(page.rawHtml);
    const candidates: CatalogCandidate[] = [];
    const warnings: string[] = [];
    const liveCards = $('a.autos-item-web[href]');

    if (liveCards.length) {
      liveCards.each((_, element) => {
        const card = $(element);
        const title = sanitizeText(card.find('p').first().text()) ?? '';
        const yearMatch = title.match(/20\d{2}/);
        const href = card.attr('href');
        const sourceUrl = href ? new URL(href, page.url).toString() : undefined;
        const priceText =
          card.find('.precio').first().text().trim() ||
          card.text().match(/\$\s*[\d,]+(?:\.\d{1,2})?/i)?.[0];
        const modelName = displayModelName(title);
        const category =
          card.closest('.tab-pane').attr('id')?.trim() || undefined;

        if (!yearMatch || !modelName || !sourceUrl) {
          warnings.push(`Catalog card could not be normalized: ${title}`);
          return;
        }

        candidates.push({
          modelName,
          modelYear: Number(yearMatch[0]),
          startingPrice: priceText ? parseMoney(priceText) : undefined,
          currency: 'MXN',
          category,
          sourceUrl,
        });
      });
      return {value: candidates, warnings};
    }

    const hiddenPayload = parseHiddenVehiclePayload($('#hAutos').attr('value'));
    if (hiddenPayload.length) {
      const seen = new Set<string>();
      for (const vehicle of hiddenPayload) {
        const modelName = sanitizeText(asString(vehicle.modelo));
        const modelYear = parseYear(vehicle.anio);
        if (!modelName || modelYear === undefined) continue;
        const key = `${modelName}:${modelYear}`;
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push({
          modelName,
          modelYear,
          startingPrice: parseMoney(
            asString(vehicle.Precio) ?? asString(vehicle.PrecioContado),
          ),
          currency: 'MXN',
          category: categoryForBodyType(asString(vehicle.TipCarr)),
          sourceUrl: new URL(
            `/${slug(modelName)}/${String(vehicle.anio).padStart(2, '0')}/`,
            page.url,
          ).toString(),
        });
      }
      if (candidates.length) return {value: candidates, warnings};
    }

    const cards = $('.vehicle-card, [data-vehicle-card], article').filter(
      (_, element) => /20\d{2}/.test($(element).text()),
    );

    cards.each((_, element) => {
      const card = $(element);
      const title =
        sanitizeText(card.find('h2, h3, [data-model-name]').first().text()) ||
        sanitizeText(card.text()) ||
        '';
      const yearMatch = title.match(/20\d{2}/);
      const href = card.find('a[href]').first().attr('href');
      const sourceUrl = href ? new URL(href, page.url).toString() : undefined;
      const priceText = card
        .text()
        .match(/(?:Desde\s*)?\$\s*[\d,]+(?:\.\d{1,2})?\s*(?:MXN)?/i)?.[0];
      const modelName = displayModelName(title);

      if (!yearMatch || !modelName || !sourceUrl) {
        warnings.push(`Catalog card could not be normalized: ${title}`);
        return;
      }

      candidates.push({
        modelName,
        modelYear: Number(yearMatch[0]),
        startingPrice: priceText ? parseMoney(priceText) : undefined,
        currency: 'MXN',
        category:
          card.closest('[data-category]').attr('data-category') ?? undefined,
        sourceUrl,
      });
    });

    if (candidates.length === 0) warnings.push('No catalog cards were found');
    return {value: candidates, warnings};
  }
}

function parseHiddenVehiclePayload(
  value: string | undefined,
): Array<Record<string, unknown>> {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter(
          (item): item is Record<string, unknown> =>
            typeof item === 'object' && item !== null && !Array.isArray(item),
        )
      : [];
  } catch {
    return [];
  }
}

function parseYear(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return undefined;
  return parsed < 100 ? 2000 + parsed : parsed;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).trim()
    : undefined;
}

function categoryForBodyType(value: string | undefined): string | undefined {
  return {
    '2': 'SUVs & Crossovers',
    '3': 'Camiones',
    '15': 'Híbridos y Eléctricos',
    '21': 'Performance',
  }[value ?? ''];
}

function slug(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toUpperCase();
}

export function parseCatalogPage(
  page: StoredPage,
): ParseResult<CatalogCandidate[]> {
  return new CatalogParser().parse(page);
}

export {normalizeModelName};
