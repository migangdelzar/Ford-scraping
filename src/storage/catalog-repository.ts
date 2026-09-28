import type {Pool} from 'pg';
import type {
  CatalogCandidate,
  SpecificationCandidate,
  StoredPage,
  VehicleCandidate,
} from '../domain/contracts.js';
import {
  normalizeModelKey,
  normalizeModelName,
  normalizeSpecName,
} from '../domain/normalization.js';

export interface ModelYearRef {
  modelId: string;
  modelYearId: string;
}

export interface VehicleRef extends ModelYearRef {
  modelName: string;
  modelYear: number;
}

export class CatalogRepository {
  constructor(private readonly pool: Pool) {}

  async upsertCatalog(
    candidate: CatalogCandidate,
    page: StoredPage,
  ): Promise<ModelYearRef> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const ref = await this.upsertModelYear(
        client,
        candidate.modelName,
        candidate.modelYear,
        {
          sourcePageId: page.id,
          startingPrice: candidate.startingPrice,
          currency: candidate.currency,
          displayName: `${candidate.modelName} ${candidate.modelYear}`,
        },
      );
      if (candidate.category)
        await this.upsertCategory(
          client,
          ref.modelYearId,
          candidate.category,
          page.id,
        );
      await client.query('COMMIT');
      return ref;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async upsertVehicle(candidate: VehicleCandidate): Promise<VehicleRef> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const ref = await this.upsertModelYear(
        client,
        candidate.modelName,
        candidate.modelYear,
        {
          displayName: candidate.title,
        },
      );
      await client.query('COMMIT');
      return {
        ...ref,
        modelName: candidate.modelName,
        modelYear: candidate.modelYear,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async upsertSpecifications(
    ref: ModelYearRef,
    specs: SpecificationCandidate[],
    page: StoredPage,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'DELETE FROM ford.specifications WHERE model_year_id = $1 AND source_page_id IS NOT DISTINCT FROM $2',
        [ref.modelYearId, page.id ?? null],
      );
      for (const spec of specs) {
        await client.query(
          `INSERT INTO ford.specifications
             (model_year_id, name, normalized_name, value_text, value_numeric, unit, source_page_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            ref.modelYearId,
            spec.name,
            spec.normalizedName,
            spec.valueText,
            spec.valueNumeric ?? null,
            spec.unit ?? null,
            page.id,
          ],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async upsertFeatures(
    ref: ModelYearRef,
    features: Array<{name: string; description?: string; category?: string}>,
    page: StoredPage,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'DELETE FROM ford.features WHERE model_year_id = $1 AND source_page_id IS NOT DISTINCT FROM $2',
        [ref.modelYearId, page.id ?? null],
      );
      for (const feature of features) {
        await client.query(
          `INSERT INTO ford.features
             (model_year_id, category, name, normalized_name, description, source_page_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            ref.modelYearId,
            feature.category ?? null,
            feature.name,
            normalizeSpecName(feature.name),
            feature.description ?? null,
            page.id ?? null,
          ],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async upsertModelYear(
    client: Pick<Pool, 'query'>,
    modelName: string,
    modelYear: number,
    values: {
      sourcePageId?: number;
      startingPrice?: number;
      currency?: string;
      displayName?: string;
    },
  ): Promise<ModelYearRef> {
    const model = await client.query<{id: string}>(
      `INSERT INTO ford.models (name, normalized_name)
       VALUES ($1, $2)
       ON CONFLICT (brand, normalized_name) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
       RETURNING id`,
      [modelName, normalizeModelKey(modelName)],
    );
    const modelYearResult = await client.query<{id: string}>(
      `INSERT INTO ford.model_years
         (model_id, model_year, display_name, source_page_id, starting_price, currency, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (model_id, model_year) DO UPDATE SET
         display_name = coalesce(EXCLUDED.display_name, ford.model_years.display_name),
         source_page_id = coalesce(EXCLUDED.source_page_id, ford.model_years.source_page_id),
         starting_price = coalesce(EXCLUDED.starting_price, ford.model_years.starting_price),
         currency = coalesce(EXCLUDED.currency, ford.model_years.currency),
         last_seen_at = now()
       RETURNING id`,
      [
        model.rows[0].id,
        modelYear,
        values.displayName ?? null,
        values.sourcePageId ?? null,
        values.startingPrice ?? null,
        values.currency ?? 'MXN',
      ],
    );
    return {modelId: model.rows[0].id, modelYearId: modelYearResult.rows[0].id};
  }

  private async upsertCategory(
    client: Pick<Pool, 'query'>,
    modelYearId: string,
    name: string,
    sourcePageId?: number,
  ): Promise<void> {
    const category = await client.query<{id: number}>(
      `INSERT INTO ford.categories (name, normalized_name)
       VALUES ($1, $2)
       ON CONFLICT (normalized_name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [name, normalizeModelName(name)],
    );
    await client.query(
      `INSERT INTO ford.model_year_categories (model_year_id, category_id, source_page_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (model_year_id, category_id) DO UPDATE SET source_page_id = EXCLUDED.source_page_id`,
      [modelYearId, category.rows[0].id, sourcePageId ?? null],
    );
  }
}
