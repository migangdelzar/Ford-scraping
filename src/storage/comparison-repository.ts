import type {Pool} from 'pg';
import type {StoredPage, VehicleComparisonCandidate} from '../domain/contracts.js';
import {normalizeModelKey} from '../domain/normalization.js';

export class ComparisonRepository {
  constructor(private readonly pool: Pool) {}

  async upsert(candidate: VehicleComparisonCandidate, page: StoredPage): Promise<{modelId: string; modelYearId: string; variantId: string}> {
    if (!page.id) throw new Error('Comparison page must be stored before ingestion');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const modelYear = await client.query<{id: string; model_id: string}>(
        `SELECT my.id, my.model_id FROM ford.model_years my
         JOIN ford.models m ON m.id = my.model_id
         WHERE m.normalized_name = $1 AND my.model_year = $2`,
        [normalizeModelKey(candidate.modelName), candidate.modelYear],
      );
      if (!modelYear.rowCount)
        throw new Error(`Model year not found: ${candidate.modelName} ${candidate.modelYear}`);
      let variant = await client.query<{id: string}>(
        `SELECT id FROM ford.variants
         WHERE model_year_id = $1 AND normalized_name = $2`,
        [modelYear.rows[0].id, normalizeModelKey(candidate.fordTrimName)],
      );
      if (!variant.rowCount)
        variant = await client.query<{id: string}>(
          `INSERT INTO ford.variants
             (model_year_id, name, normalized_name, trim_name, source_page_id, metadata)
           VALUES ($1, $2, $3, $2, $4, $5)
           ON CONFLICT (model_year_id, normalized_name) DO UPDATE SET
             name = EXCLUDED.name, trim_name = EXCLUDED.trim_name,
             source_page_id = coalesce(ford.variants.source_page_id, EXCLUDED.source_page_id)
           RETURNING id`,
          [
            modelYear.rows[0].id,
            candidate.fordTrimName,
            normalizeModelKey(candidate.fordTrimName),
            page.id,
            JSON.stringify({source: 'ford-comparativo-route'}),
          ],
        );
      const parent = await client.query<{id: string}>(
        `INSERT INTO ford.comparisons
           (model_year_id, variant_id, competitor_make, competitor_model,
            competitor_year, competitor_variant, source_page_id, raw_data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (source_page_id) DO UPDATE SET
           model_year_id = EXCLUDED.model_year_id,
           variant_id = EXCLUDED.variant_id,
           competitor_make = EXCLUDED.competitor_make,
           competitor_model = EXCLUDED.competitor_model,
           competitor_year = EXCLUDED.competitor_year,
           competitor_variant = EXCLUDED.competitor_variant,
           raw_data = EXCLUDED.raw_data,
           updated_at = now()
         RETURNING id`,
        [
          modelYear.rows[0].id,
          variant.rows[0].id,
          candidate.competitorMake,
          candidate.competitorModel,
          candidate.competitorYear ?? null,
          candidate.competitorTrim ?? null,
          page.id,
          JSON.stringify(candidate.rawData),
        ],
      );
      const comparisonId = parent.rows[0].id;
      await client.query('DELETE FROM ford.comparison_attributes WHERE comparison_id = $1', [comparisonId]);
      for (const attribute of candidate.competitorAttributes) {
        await client.query(
          `INSERT INTO ford.comparison_attributes
             (comparison_id, category, name, normalized_name, value_text,
              value_numeric, unit, raw_data)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            comparisonId,
            attribute.category,
            attribute.name,
            attribute.normalizedName,
            attribute.valueText,
            attribute.valueNumeric ?? null,
            attribute.unit ?? null,
            JSON.stringify({sourceText: attribute.valueText}),
          ],
        );
      }
      await client.query(
        `DELETE FROM ford.specifications
         WHERE model_year_id = $1 AND variant_id = $2 AND source_page_id = $3`,
        [modelYear.rows[0].id, variant.rows[0].id, page.id],
      );
      for (const attribute of candidate.fordAttributes) {
        await client.query(
          `INSERT INTO ford.specifications
             (variant_id, model_year_id, category, name, normalized_name,
              value_text, value_numeric, unit, source_page_id, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            variant.rows[0].id,
            modelYear.rows[0].id,
            attribute.category,
            attribute.name,
            attribute.normalizedName,
            attribute.valueText,
            attribute.valueNumeric ?? null,
            attribute.unit ?? null,
            page.id,
            JSON.stringify({comparisonId}),
          ],
        );
      }
      const sourcePrice = candidate.fordAttributes.find(
        attribute => attribute.normalizedName === 'precio' && attribute.valueNumeric !== undefined,
      );
      if (sourcePrice)
        await client.query(
          `UPDATE ford.variants SET price = $2, currency = 'MXN'
           WHERE id = $1`,
          [variant.rows[0].id, sourcePrice.valueNumeric],
        );
      await client.query('COMMIT');
      return {
        modelId: modelYear.rows[0].model_id,
        modelYearId: modelYear.rows[0].id,
        variantId: variant.rows[0].id,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
