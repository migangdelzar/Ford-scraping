import type {ParseResult, StoredPage} from '../domain/contracts.js';

export interface PageParser<T> {
  supports(page: StoredPage): boolean;
  parse(page: StoredPage): ParseResult<T>;
}
