import {describe, expect, it} from 'vitest';
import {
  isAllowedPublicUrl,
  normalizeUrl,
  stripComparisonSelectorParamsFromText,
  type CrawlPolicy,
} from '../../src/crawl/url-policy.js';

const policy: CrawlPolicy = {
  baseUrl: new URL('https://www.forduruapan.mx'),
  allowedHosts: new Set(['www.forduruapan.mx', 'forduruapan.mx']),
};

describe('URL policy', () => {
  it('removes fragments and tracking query parameters', () => {
    expect(
      normalizeUrl(
        'https://www.forduruapan.mx/Todos/?utm_source=x#catalog',
        policy.baseUrl,
      ),
    ).toBe('https://www.forduruapan.mx/Todos/');
  });

  it('removes color selector query parameters from Comparativo route identities', () => {
    expect(normalizeUrl(
      'https://www.forduruapan.mx/EXPEDITION/27/Comparativo/KING-RANCH-MAX/?exterior=gris%20denim&interior=',
      policy.baseUrl,
    )).toBe('https://www.forduruapan.mx/EXPEDITION/27/Comparativo/KING-RANCH-MAX/');
  });

  it('removes selector URLs from scraped HTML text but leaves unrelated query URLs intact', () => {
    expect(stripComparisonSelectorParamsFromText(
      '<a href="/EXPEDITION/27/Comparativo/ACTIVE/?exterior=gris&amp;interior=">Compare</a> '
      + '<a href="/Seminuevos/?page=2">Inventory</a>',
    )).toBe(
      '<a href="/EXPEDITION/27/Comparativo/ACTIVE/">Compare</a> '
      + '<a href="/Seminuevos/?page=2">Inventory</a>',
    );
  });

  it('rejects form and personal-data paths', () => {
    expect(
      isAllowedPublicUrl(new URL('https://www.forduruapan.mx/Cotiza/'), policy),
    ).toBe(false);
    expect(
      isAllowedPublicUrl(new URL('https://www.forduruapan.mx/Todos/'), policy),
    ).toBe(true);
    expect(
      isAllowedPublicUrl(new URL('https://example.com/Todos/'), policy),
    ).toBe(false);
  });
});
