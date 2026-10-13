import {load} from 'cheerio';
import type {
  ComparisonAttributeCandidate,
  ParseResult,
  StoredPage,
  VehicleComparisonCandidate,
} from '../domain/contracts.js';
import {normalizeModelKey, normalizeSpecName} from '../domain/normalization.js';
import type {PageParser} from '../crawl/page-parser.js';

function parseHeader(value: string): {
  make: string;
  model: string;
  year?: number;
} {
  const match = value.trim().match(/^(.+?)\s+(20\d{2}|\d{2})$/);
  if (!match) return {make: 'Unknown', model: value.trim()};
  const year = Number(match[2].length === 2 ? `20${match[2]}` : match[2]);
  const words = match[1].trim().split(/\s+/);
  return {
    make: words.shift() ?? 'Unknown',
    model: words.join(' '),
    year,
  };
}

function numericValue(value: string): {value?: number; unit?: string} {
  const match = value.match(/-?\d[\d,]*(?:\.\d+)?/);
  if (!match) return {};
  const parsed = Number(match[0].replaceAll(',', ''));
  const unit = value
    .slice(match.index! + match[0].length)
    .trim()
    .match(/^[\p{L}%°$]+/u)?.[0];
  return {value: Number.isFinite(parsed) ? parsed : undefined, unit};
}

function routeParts(page: StoredPage):
  | {
      modelName: string;
      modelYear: number;
      fordTrimName: string;
    }
  | undefined {
  const match = new URL(page.url).pathname.match(
    /^\/([^/]+)\/(20\d{2}|\d{2})\/Comparativo\/([^/]+)\/?$/i,
  );
  if (!match) return undefined;
  return {
    modelName: decodeURIComponent(match[1]).replaceAll('-', ' '),
    modelYear: Number(match[2].length === 2 ? `20${match[2]}` : match[2]),
    fordTrimName: decodeURIComponent(match[3]).replaceAll('-', ' '),
  };
}

export class ComparisonParser implements PageParser<VehicleComparisonCandidate> {
  supports(page: StoredPage): boolean {
    return page.pageType === 'comparison';
  }

  parse(page: StoredPage): ParseResult<VehicleComparisonCandidate> {
    const route = routeParts(page);
    if (!route) throw new Error(`Invalid Comparativo route: ${page.url}`);
    const $ = load(page.rawHtml);
    const header = $('.modelos-nombres-contenedor #modelos-nombres').first();
    const vehicles = header.find('.modelo-detalles').toArray();
    const fordHeader = vehicles[0] ? $(vehicles[0]) : undefined;
    const competitorHeader = vehicles[1] ? $(vehicles[1]) : undefined;
    const fordTitle = fordHeader?.find('.modelo-titulo').text().trim() ?? '';
    const competitorTitle =
      competitorHeader?.find('.modelo-titulo').text().trim() ?? '';
    const fordTrimName =
      fordHeader?.find('.modelo-version').text().trim() || route.fordTrimName;
    const competitorTrim =
      competitorHeader?.find('.modelo-version').text().trim() || undefined;
    const opponent = parseHeader(competitorTitle);
    const fordAttributes: ComparisonAttributeCandidate[] = [];
    const competitorAttributes: ComparisonAttributeCandidate[] = [];
    const rawRows: Array<Record<string, string>> = [];

    $('#grupos .grupo').each((_, group) => {
      const category = $(group).find('.grupo-titulo').first().text().trim();
      $(group)
        .find('.grupo-items')
        .each((__, row) => {
          const columns = $(row).find('.grupo-item').toArray();
          if (columns.length < 2) return;
          const cells = columns.slice(0, 2).map(column => {
            const cell = $(column);
            return {
              name: cell.find('.item-nombre').first().text().trim(),
              value: cell
                .find('.item-valor')
                .first()
                .text()
                .replace(/\s+/g, ' ')
                .trim(),
            };
          });
          const name = cells[0].name || cells[1].name;
          if (!name) return;
          const [fordCell, competitorCell] = cells;
          rawRows.push({
            category,
            name,
            fordValue: fordCell.value,
            competitorValue: competitorCell.value,
          });
          for (const [target, cell] of [
            [fordAttributes, fordCell],
            [competitorAttributes, competitorCell],
          ] as const) {
            if (!cell.value) continue;
            const numeric = numericValue(cell.value);
            target.push({
              category,
              name,
              normalizedName: normalizeSpecName(name),
              valueText: cell.value,
              ...(numeric.value !== undefined
                ? {valueNumeric: numeric.value}
                : {}),
              ...(numeric.unit ? {unit: numeric.unit} : {}),
            });
          }
        });
    });

    const fordImageUrl = $('#modelos-imagenes .modelo-img').eq(0).attr('src');
    const competitorImageUrl = $('#modelos-imagenes .modelo-img')
      .eq(1)
      .attr('src');
    const fordImage = fordImageUrl
      ? new URL(fordImageUrl, page.url).toString()
      : undefined;
    const competitorImage = competitorImageUrl
      ? new URL(competitorImageUrl, page.url).toString()
      : undefined;
    const candidate: VehicleComparisonCandidate = {
      ...route,
      fordTrimName,
      competitorMake: opponent.make,
      competitorModel: opponent.model,
      competitorYear: opponent.year,
      competitorTrim,
      fordAttributes,
      competitorAttributes,
      fordImageUrl: fordImage,
      competitorImageUrl: competitorImage,
      sourceUrl: page.url,
      rawData: {
        fordHeader: fordTitle,
        fordTrim: fordTrimName,
        competitorHeader: competitorTitle,
        competitorTrim,
        rows: rawRows,
        images: {ford: fordImage, competitor: competitorImage},
        routeTrimKey: normalizeModelKey(route.fordTrimName),
      },
    };
    const warnings = [
      ...(!fordHeader ? ['Comparativo page has no Ford header'] : []),
      ...(!competitorHeader
        ? ['Comparativo page has no competitor header']
        : []),
      ...(rawRows.length ? [] : ['Comparativo page has no paired attributes']),
    ];
    return {value: candidate, warnings};
  }
}
