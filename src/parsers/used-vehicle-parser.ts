import {load} from 'cheerio';
import type {PageParser} from '../crawl/page-parser.js';
import {
  parseMileageKm,
  parseMoney,
  sanitizeText,
} from '../crawl/text-normalization.js';
import type {
  ParseResult,
  StoredPage,
  UsedVehicleCandidate,
} from '../domain/contracts.js';

export class UsedVehicleParser implements PageParser<UsedVehicleCandidate[]> {
  supports(page: StoredPage): boolean {
    return page.pageType === 'used_vehicle';
  }

  parse(page: StoredPage): ParseResult<UsedVehicleCandidate[]> {
    const $ = load(page.rawHtml);
    const warnings: string[] = [];
    const records: UsedVehicleCandidate[] = [];
    const cards = $(
      '.used-vehicle-card, .vehicle-card, .auto-card, [data-auto-id], article',
    );

    cards.each((_, element) => {
      const card = $(element);
      const text = sanitizeText(card.text()) ?? '';
      const detailUrl = this.detailUrl($, card, page.url);
      const inventoryId = this.inventoryId(card, detailUrl, text);
      if (!inventoryId) {
        warnings.push('Seminuevo card has no inventory ID');
        return;
      }
      const title = sanitizeText(
        card.find('h2, h3, h4, .title, .name, [data-title]').first().text(),
      );
      if (!title) {
        warnings.push(`Seminuevo ${inventoryId} has no title`);
        return;
      }
      records.push({
        inventoryId,
        title,
        price: parseMoney(
          card.find('.price, [data-price]').first().text() || text,
        ),
        currency: 'MXN',
        mileageKm: parseMileageKm(
          card.find('.mileage, [data-mileage]').first().text() || text,
        ),
        transmission: parseTransmission(
          card.find('.transmission, [data-transmission]').first().text() ||
            text,
        ),
        imageUrls: [
          ...new Set(
            card
              .find('img[src]')
              .map((__, image) =>
                new URL($(image).attr('src')!, page.url).toString(),
              )
              .get(),
          ),
        ],
        detailUrl,
        sourceUrl: page.url,
        metadata: {extraction: 'ssr-cheerio'},
      });
    });

    if (!records.length) warnings.push('No Seminuevos cards were found');
    return {value: records, warnings};
  }

  private inventoryId(
    card: ReturnType<ReturnType<typeof load>>,
    detailUrl: string | undefined,
    text: string,
  ): string | undefined {
    const explicit =
      card.attr('data-auto-id') ||
      card.attr('data-id') ||
      card.attr('data-inventory-id');
    if (explicit) return sanitizeText(explicit);
    const imageId = text.match(/AutoID=(\d+)/i)?.[1];
    if (imageId) return imageId;
    return detailUrl?.match(/\/(\d+)\/?$/)?.[1];
  }

  private detailUrl(
    $: ReturnType<typeof load>,
    card: ReturnType<ReturnType<typeof load>>,
    sourceUrl: string,
  ): string | undefined {
    const href = card.find('a[href]').first().attr('href');
    return href ? new URL(href, sourceUrl).toString() : undefined;
  }
}

function parseTransmission(
  value: string,
): UsedVehicleCandidate['transmission'] {
  const normalized = sanitizeText(value)?.toLocaleLowerCase('es-MX');
  if (!normalized) return undefined;
  if (normalized.includes('autom')) return 'automatic';
  if (normalized.includes('manual')) return 'manual';
  return normalized.includes('transm') ? 'other' : undefined;
}

export function parseUsedVehiclePage(
  page: StoredPage,
): ParseResult<UsedVehicleCandidate[]> {
  return new UsedVehicleParser().parse(page);
}
