import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';

const migration = readFileSync(
  'db/migrations/022_mia_catalog_read_views.sql',
  'utf8',
);
const parityMigration = readFileSync(
  'db/migrations/023_mia_catalog_parity_views.sql',
  'utf8',
);
const parityCompletionMigration = readFileSync(
  'db/migrations/024_mia_catalog_parity_completion_views.sql',
  'utf8',
);
const comparisonLinkMigration = readFileSync(
  'db/migrations/025_mia_trim_comparison_links.sql',
  'utf8',
);

describe('MÍA catalog read-view migration', () => {
  it('adds parity views in a forward migration without rewriting applied migration 022', () => {
    expect(migration).not.toMatch(
      /vehicle_facts_v2|offers_v1|vehicle_variants_v1/i,
    );
    expect(parityMigration).toMatch(
      /CREATE OR REPLACE VIEW ford_read\.vehicle_facts_v2/i,
    );
    expect(parityMigration).toMatch(
      /CREATE OR REPLACE VIEW ford_read\.vehicle_variants_v1/i,
    );
    expect(parityMigration).toMatch(
      /CREATE OR REPLACE VIEW ford_read\.offers_v1/i,
    );
    expect(parityMigration).toMatch(
      /CREATE OR REPLACE VIEW ford_read\.promotions_v2/i,
    );
    expect(parityMigration).not.toMatch(
      /CREATE OR REPLACE VIEW ford_read\.promotions_v1/i,
    );
    expect(parityMigration).toMatch(/benefits/i);
    expect(parityMigration).toMatch(/term_conflict/i);
    expect(parityMigration).not.toMatch(
      /\b(INSERT|UPDATE|DELETE|DROP TABLE)\b/i,
    );
  });

  it('adds missing comparison, page, and financing evidence as new versioned views', () => {
    expect(parityCompletionMigration).toMatch(
      /CREATE OR REPLACE VIEW ford_read\.offers_v2/i,
    );
    expect(parityCompletionMigration).toMatch(/tax_rate_percent/i);
    expect(parityCompletionMigration).toMatch(
      /opening_commission_rate_percent/i,
    );
    expect(parityCompletionMigration).toMatch(/maximum_down_payment_percent/i);
    expect(parityCompletionMigration).toMatch(/life_insurance_price/i);
    expect(parityCompletionMigration).toMatch(
      /CREATE OR REPLACE VIEW ford_read\.comparison_facts_v2/i,
    );
    expect(parityCompletionMigration).toMatch(/comparison_url/i);
    expect(parityCompletionMigration).toMatch(
      /CREATE OR REPLACE VIEW ford_read\.catalog_pages_v1/i,
    );
  });

  it('adds exact per-trim comparison URLs without rewriting earlier view contracts', () => {
    expect(comparisonLinkMigration).toMatch(
      /CREATE OR REPLACE VIEW ford_read\.vehicle_variants_v2/i,
    );
    expect(comparisonLinkMigration).toMatch(/comparison_url/i);
  });

  it('creates stable vehicle search, exact-detail, and promotion evidence views', () => {
    expect(migration).toMatch(/CREATE SCHEMA IF NOT EXISTS ford_read/i);
    expect(migration).toMatch(
      /CREATE OR REPLACE VIEW ford_read\.vehicle_search_v1/i,
    );
    expect(migration).toMatch(
      /CREATE OR REPLACE VIEW ford_read\.vehicle_facts_v1/i,
    );
    expect(parityMigration).toMatch(
      /CREATE OR REPLACE VIEW ford_read\.vehicle_facts_v2/i,
    );
    expect(parityMigration).toMatch(
      /CREATE OR REPLACE VIEW ford_read\.vehicle_variants_v1/i,
    );
    expect(migration).toMatch(
      /CREATE OR REPLACE VIEW ford_read\.promotions_v1/i,
    );
    expect(parityMigration).toMatch(
      /CREATE OR REPLACE VIEW ford_read\.offers_v1/i,
    );
    expect(parityMigration).toMatch(
      /CREATE OR REPLACE VIEW ford_read\.page_links_v1/i,
    );
    expect(parityMigration).toMatch(
      /CREATE OR REPLACE VIEW ford_read\.vehicle_images_v1/i,
    );
    expect(parityMigration).toMatch(
      /CREATE OR REPLACE VIEW ford_read\.comparison_facts_v1/i,
    );
    expect(parityMigration).toMatch(
      /CREATE OR REPLACE VIEW ford_read\.provenance_v1/i,
    );
    expect(parityMigration).toMatch(
      /CREATE OR REPLACE VIEW ford_read\.document_provenance_v1/i,
    );
    expect(parityMigration).toMatch(
      /CREATE OR REPLACE VIEW ford_read\.catalog_status_v1/i,
    );
  });

  it('includes direct source URLs and observed timestamps in every evidence view', () => {
    for (const view of [
      'ford_read.vehicle_search_v1',
      'ford_read.vehicle_facts_v1',
    ]) {
      const definition = migration.split(view)[1]?.split(';')[0] ?? '';
      expect(definition).toMatch(/source_(?:page_)?url/);
      expect(definition).toContain('observed_at');
    }
    for (const view of [
      'ford_read.vehicle_facts_v2',
      'ford_read.vehicle_variants_v1',
      'ford_read.offers_v1',
      'ford_read.page_links_v1',
      'ford_read.vehicle_images_v1',
      'ford_read.comparison_facts_v1',
      'ford_read.provenance_v1',
      'ford_read.document_provenance_v1',
    ]) {
      const definition = parityMigration.split(view)[1]?.split(';')[0] ?? '';
      expect(definition).toMatch(/source_(?:page_)?url/);
      expect(definition).toContain('observed_at');
    }
  });

  it('exposes source-backed offer benefit and term-conflict metadata', () => {
    const offers =
      parityMigration
        .split('CREATE OR REPLACE VIEW ford_read.offers_v1')[1]
        ?.split(';')[0] ?? '';
    expect(offers).toMatch(/o\.metadata\s*->\s*'benefits'\s+AS\s+benefits/i);
    expect(offers).toMatch(
      /o\.metadata\s*->\s*'termConflict'\s+AS\s+term_conflict/i,
    );
  });

  it('adds variant-aware complete facts without changing the v1 view', () => {
    const facts =
      parityMigration
        .split('CREATE OR REPLACE VIEW ford_read.vehicle_facts_v2')[1]
        ?.split(';')[0] ?? '';
    for (const column of [
      'variant_id',
      'category',
      'normalized_name',
      'value_numeric',
    ]) {
      expect(facts).toContain(column);
    }
    expect(facts).toMatch(/fact_source\.url\s+IS\s+NOT\s+NULL/i);
    expect(facts).toMatch(/fact_source\.crawled_at\s+IS\s+NOT\s+NULL/i);
  });

  it('contains no catalog writes or schema creation outside the read schema', () => {
    expect(`${migration}\n${parityMigration}`).not.toMatch(
      /\b(INSERT|UPDATE|DELETE|DROP TABLE)\b/i,
    );
    expect(`${migration}\n${parityMigration}`).not.toMatch(/CREATE TABLE/i);
  });
});
