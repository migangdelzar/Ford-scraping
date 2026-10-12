import {describe, expect, it} from 'vitest';
import {extractPageLinks} from '../../src/crawl/page-links.js';

describe('extractPageLinks', () => {
  it('stores Comparativo links without color selector query values', () => {
    const [link] = extractPageLinks(
      '<a href="/EXPEDITION/27/Comparativo/KING-RANCH-MAX/?exterior=gris%20denim&amp;interior=">Compare</a>',
      'https://www.forduruapan.mx/EXPEDITION/27/',
    );

    expect(link.href).toBe('https://www.forduruapan.mx/EXPEDITION/27/Comparativo/KING-RANCH-MAX/');
    expect(link.targetUrl).toBe('https://www.forduruapan.mx/EXPEDITION/27/Comparativo/KING-RANCH-MAX/');
  });
});
