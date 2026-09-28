import {describe, expect, it} from 'vitest';
import {
  parseMileageKm,
  parseMoney,
  sanitizeText,
} from '../../src/crawl/text-normalization.js';

describe('text normalization', () => {
  it('collapses regular and non-breaking whitespace', () => {
    expect(sanitizeText('  Territory\u00a02026\n\t SUV  ')).toBe(
      'Territory 2026 SUV',
    );
  });

  it('returns undefined for missing or empty values', () => {
    expect(sanitizeText(undefined)).toBeUndefined();
    expect(sanitizeText(' \u00a0 ')).toBeUndefined();
  });

  it('parses Mexican money labels', () => {
    expect(parseMoney('$ 559,900 MXN')).toBe(559900);
    expect(parseMoney(undefined)).toBeUndefined();
    expect(parseMoney('Precio no disponible')).toBeUndefined();
  });

  it('parses mileage labels in kilometers', () => {
    expect(parseMileageKm('Kilometraje 30,332 km')).toBe(30332);
    expect(parseMileageKm('')).toBeUndefined();
  });
});
