import {load} from 'cheerio';
import type {
  ParseResult,
  SpecificationCandidate,
  StoredPage,
} from '../domain/contracts.js';
import {normalizeSpecName} from '../domain/normalization.js';
import type {PageParser} from '../crawl/page-parser.js';

function numericValue(value: string): number | undefined {
  const match = value.match(/-?\d[\d.,]*/);
  if (!match) return undefined;
  const token = match[0];
  const normalized =
    token.includes(',') && !token.includes('.')
      ? /,\d{1,2}$/.test(token)
        ? token.replace(',', '.')
        : token.replaceAll(',', '')
      : token.replaceAll(',', '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function candidate(
  name: string,
  valueText: string,
  category?: string,
): SpecificationCandidate {
  const valueNumeric = numericValue(valueText);
  const unit =
    valueText.match(/\d[\d.,]*\s*(mm|hp|cv|nm|cc|km\/l|kg|l|%)(?!\w)/i)?.[1] ??
    name.match(/\((mm|hp|cv|nm|cc|km\/l|kg|l|%)\)/i)?.[1];
  return {
    name: name.trim(),
    normalizedName: normalizeSpecName(name),
    valueText: valueText.trim(),
    valueNumeric,
    unit,
    category,
  };
}

export class TechnicalSheetParser implements PageParser<
  SpecificationCandidate[]
> {
  supports(page: StoredPage): boolean {
    return page.pageType === 'technical_sheet';
  }

  parse(page: StoredPage): ParseResult<SpecificationCandidate[]> {
    const $ = load(page.rawHtml);
    const specs: SpecificationCandidate[] = [];
    const warnings: string[] = [];

    $('.datos-ficha .seccion').each((_, section) => {
      const values = $(section)
        .find('.seccion-item')
        .map((__, item) => $(item).text().replace(/\s+/g, ' ').trim())
        .get();
      const name = values.shift();
      const valueText = [...new Set(values.filter(Boolean))].join(' | ');
      if (name && valueText)
        specs.push(candidate(name, valueText, 'equipment'));
    });

    $('table tr').each((_, row) => {
      const cells = $(row)
        .find('th, td')
        .map((__, cell) => $(cell).text().replace(/\s+/g, ' ').trim())
        .get();
      if (cells.length >= 2) specs.push(candidate(cells[0], cells[1]));
    });

    $('dt').each((_, term) => {
      const definition = $(term).next('dd');
      if (definition.length)
        specs.push(candidate($(term).text(), definition.text()));
    });

    const unique = [
      ...new Map(
        specs.map(spec => [`${spec.normalizedName}:${spec.valueText}`, spec]),
      ).values(),
    ];
    if (unique.length === 0)
      warnings.push(`No specifications found on ${page.url}`);
    return {value: unique, warnings};
  }
}

export function parseTechnicalSheet(
  page: StoredPage,
): ParseResult<SpecificationCandidate[]> {
  return new TechnicalSheetParser().parse(page);
}
