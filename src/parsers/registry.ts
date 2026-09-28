import type {PageParser} from '../crawl/page-parser.js';
import type {ParseResult, StoredPage} from '../domain/contracts.js';
import {CatalogParser} from './catalog-parser.js';
import {ModelParser} from './model-parser.js';
import {PublicPageParser} from './public-page-parser.js';
import {TechnicalSheetParser} from './technical-sheet-parser.js';
import {UsedVehicleParser} from './used-vehicle-parser.js';

class UnknownParser implements PageParser<{
  documentType: 'unknown';
  content: string;
}> {
  supports(): boolean {
    return true;
  }

  parse(
    page: StoredPage,
  ): ParseResult<{documentType: 'unknown'; content: string}> {
    return {
      value: {documentType: 'unknown', content: page.extractedText},
      warnings: ['No focused parser supports this page'],
    };
  }
}

export function createParserRegistry(): PageParser<unknown>[] {
  return [
    new CatalogParser(),
    new TechnicalSheetParser(),
    new ModelParser(),
    new UsedVehicleParser(),
    new PublicPageParser(),
    new UnknownParser(),
  ];
}
