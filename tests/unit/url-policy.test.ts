import {describe, expect, it} from 'vitest';
import {
  isAllowedPublicUrl,
  normalizeUrl,
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
