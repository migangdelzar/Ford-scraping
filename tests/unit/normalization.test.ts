import {describe, expect, it} from 'vitest';
import {
  normalizeModelKey,
  normalizeModelName,
  normalizeSpecName,
  parsePrice,
} from '../../src/domain/normalization.js';

describe('normalization', () => {
  it('normalizes model names without removing meaningful accents', () => {
    expect(normalizeModelName('  Edge   Híbrida ')).toBe('edge híbrida');
  });

  it('creates the same identity key for case and accent variants', () => {
    expect(normalizeModelKey('Edge Híbrida')).toBe(
      normalizeModelKey('EDGE HIBRIDA'),
    );
  });

  it('creates the same identity key for punctuation variants', () => {
    expect(normalizeModelKey('F-150 Híbrida')).toBe(
      normalizeModelKey('F 150 HIBRIDA'),
    );
    expect(normalizeModelKey('E-Transit')).toBe(normalizeModelKey('E Transit'));
  });

  it('maps equivalent specification labels to canonical keys', () => {
    expect(normalizeSpecName('Potencia máxima')).toBe('power_hp');
    expect(normalizeSpecName('Capacidad de pasajeros')).toBe(
      'seating_capacity',
    );
  });

  it('parses Mexican price formatting', () => {
    expect(parsePrice('$559,900 MXN')).toBe(559900);
    expect(parsePrice('Desde $ 773,500')).toBe(773500);
  });
});
