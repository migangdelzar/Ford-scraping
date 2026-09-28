import type {Pool} from 'pg';
import {normalizeModelKey} from '../domain/normalization.js';
import {
  getOfferDataQualityWarnings,
  getOfferValidityStatus,
} from '../domain/offers.js';

export class VehicleQueryService {
  constructor(private readonly pool: Pool) {}

  async getByModelYear(model: string, year: number): Promise<unknown | null> {
    const vehicle = await this.pool.query(
      `SELECT m.id AS model_id, m.name AS model, my.id AS model_year_id, my.model_year AS year,
              my.starting_price AS price, my.currency, my.metadata,
              source.url AS source_url, source.crawled_at
      FROM ford.model_years my
      JOIN ford.models m ON m.id = my.model_id
      LEFT JOIN ford.pages source ON source.id = my.source_page_id
      WHERE m.normalized_name = $1 AND my.model_year = $2`,
      [normalizeModelKey(model), year],
    );
    if (!vehicle.rowCount) return null;
    const row = vehicle.rows[0];
    const specs = await this.pool.query(
      `SELECT s.name, s.normalized_name, s.value_text, s.value_numeric, s.unit,
              source.url AS source_url, source.crawled_at
       FROM ford.specifications s
       LEFT JOIN ford.pages source ON source.id = s.source_page_id
       WHERE s.model_year_id = $1 ORDER BY s.id`,
      [row.model_year_id],
    );
    const features = await this.pool.query(
      `SELECT f.name, f.description, f.category,
              source.url AS source_url, source.crawled_at
       FROM ford.features f
       LEFT JOIN ford.pages source ON source.id = f.source_page_id
       WHERE f.model_year_id = $1 ORDER BY f.id`,
      [row.model_year_id],
    );
    return {...row, specifications: specs.rows, features: features.rows};
  }

  async compare(ids: string[]): Promise<unknown> {
    const result = await this.pool.query(
      `SELECT m.name AS model, my.model_year AS year, my.starting_price AS price, my.currency,
              my.id AS model_year_id,
              coalesce((
                SELECT jsonb_agg(jsonb_build_object(
                  'name', s.name, 'value', s.value_text, 'unit', s.unit,
                  'category', s.category, 'sourceUrl', source.url,
                  'crawledAt', source.crawled_at
                ) ORDER BY s.category NULLS LAST, s.name)
                FROM ford.specifications s
                LEFT JOIN ford.pages source ON source.id = s.source_page_id
                WHERE s.model_year_id = my.id
              ), '[]'::jsonb) AS specifications,
              coalesce((
                SELECT jsonb_agg(jsonb_build_object(
                  'name', f.name, 'description', f.description, 'category', f.category,
                  'sourceUrl', source.url, 'crawledAt', source.crawled_at
                ) ORDER BY f.category NULLS LAST, f.name)
                FROM ford.features f
                LEFT JOIN ford.pages source ON source.id = f.source_page_id
                WHERE f.model_year_id = my.id
              ), '[]'::jsonb) AS features
       FROM ford.model_years my JOIN ford.models m ON m.id = my.model_id
       WHERE my.id = ANY($1::uuid[]) ORDER BY m.name, my.model_year`,
      [ids],
    );
    return result.rows;
  }
}

export class ProvenanceService {
  constructor(private readonly pool: Pool) {}

  async get(documentId: string): Promise<unknown> {
    const result = await this.pool.query(
      `SELECT d.id AS document_id, d.document_type, d.content_hash,
              p.url AS source_url, p.crawled_at, p.content_hash AS page_content_hash
       FROM ford.documents d LEFT JOIN ford.pages p ON p.id = d.page_id
       WHERE d.id = $1`,
      [documentId],
    );
    return result.rows[0] ?? null;
  }
}

export class PromotionService {
  constructor(private readonly pool: Pool) {}

  async list(filters: Record<string, unknown>): Promise<unknown> {
    const result = await this.pool.query(
      `SELECT id, model_year_id, title, description, offer_type, valid_from, valid_until,
              term_months, metadata, source_page_id
       FROM ford.offers
       WHERE offer_type = 'promotion'
         AND ($1::date IS NULL OR valid_until IS NULL OR valid_until >= $1::date)
       ORDER BY valid_until NULLS LAST, title`,
      [filters.asOf ?? null],
    );
    const asOf =
      typeof filters.asOf === 'string'
        ? filters.asOf
        : new Date().toISOString().slice(0, 10);
    return result.rows.map((row: Record<string, unknown>) => ({
      ...row,
      validityStatus: getOfferValidityStatus(
        {
          validFrom: row.valid_from as string | undefined,
          validUntil: row.valid_until as string | undefined,
        },
        asOf,
      ),
      dataQualityWarnings: getOfferDataQualityWarnings(
        row.metadata as Record<string, unknown>,
      ),
    }));
  }
}

export class CatalogStatusService {
  constructor(private readonly pool: Pool) {}

  async status(): Promise<unknown> {
    const result = await this.pool.query(`
      SELECT
        (SELECT count(*)::int FROM ford.pages) AS pages,
        (SELECT count(*)::int FROM ford.model_years) AS vehicles,
        (SELECT count(*)::int FROM ford.documents) AS documents,
        (SELECT count(*)::int FROM ford.document_embeddings WHERE status = 'ready') AS embedded,
        (SELECT count(*)::int FROM ford.document_embeddings WHERE status = 'pending') AS pending,
        (SELECT max(crawled_at) FROM ford.pages) AS latest_crawled_at
    `);
    return result.rows[0];
  }
}
