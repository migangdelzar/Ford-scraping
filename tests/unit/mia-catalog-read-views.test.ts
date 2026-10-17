import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

const migration = readFileSync(
  'db/migrations/022_mia_catalog_read_views.sql',
  'utf8',
);

describe('MÍA catalog read-view migration', () => {
  it('creates stable vehicle search, exact-detail, and promotion evidence views', () => {
    expect(migration).toMatch(/CREATE SCHEMA IF NOT EXISTS ford_read/i);
    expect(migration).toMatch(/CREATE OR REPLACE VIEW ford_read\.vehicle_search_v1/i);
    expect(migration).toMatch(/CREATE OR REPLACE VIEW ford_read\.vehicle_facts_v1/i);
    expect(migration).toMatch(/CREATE OR REPLACE VIEW ford_read\.promotions_v1/i);
  });

  it('includes direct source URLs and observed timestamps in every evidence view', () => {
    for (const view of [
      'ford_read.vehicle_search_v1',
      'ford_read.vehicle_facts_v1',
      'ford_read.promotions_v1',
    ]) {
      const definition = migration.split(view)[1]?.split(';')[0] ?? '';
      expect(definition).toContain('source_url');
      expect(definition).toContain('observed_at');
    }
  });

  it('contains no catalog writes or schema creation outside the read schema', () => {
    expect(migration).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP TABLE)\b/i);
    expect(migration).not.toMatch(/CREATE TABLE/i);
  });
});
