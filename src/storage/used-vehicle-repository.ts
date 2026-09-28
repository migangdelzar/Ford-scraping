import type {Pool} from 'pg';
import {hashUsedVehicle, type UsedVehicleSyncSummary} from '../domain/sync.js';
import type {StoredPage, UsedVehicleCandidate} from '../domain/contracts.js';

export class UsedVehicleRepository {
  constructor(private readonly pool: Pool) {}

  async syncSnapshot(
    records: UsedVehicleCandidate[],
    page: StoredPage,
    options: {complete?: boolean} = {},
  ): Promise<UsedVehicleSyncSummary> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      let changed = 0;
      for (const record of records) {
        const contentHash = hashUsedVehicle(record);
        const existing = await client.query<{content_hash: string}>(
          'SELECT content_hash FROM ford.used_vehicles WHERE inventory_id = $1',
          [record.inventoryId],
        );
        if (!existing.rowCount || existing.rows[0].content_hash !== contentHash)
          changed += 1;
        await client.query(
          `INSERT INTO ford.used_vehicles
             (inventory_id, title, price, currency, mileage_km, transmission,
              image_urls, detail_url, source_url, source_page_id, active,
              last_seen_at, content_hash, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, TRUE,
                   now(), $11, $12::jsonb)
           ON CONFLICT (inventory_id) DO UPDATE SET
             title = EXCLUDED.title, price = EXCLUDED.price, currency = EXCLUDED.currency,
             mileage_km = EXCLUDED.mileage_km, transmission = EXCLUDED.transmission,
             image_urls = EXCLUDED.image_urls, detail_url = EXCLUDED.detail_url,
             source_url = EXCLUDED.source_url, source_page_id = EXCLUDED.source_page_id,
             active = TRUE, last_seen_at = now(), content_hash = EXCLUDED.content_hash,
             metadata = EXCLUDED.metadata`,
          [
            record.inventoryId,
            record.title,
            record.price ?? null,
            record.currency,
            record.mileageKm ?? null,
            record.transmission ?? null,
            JSON.stringify(record.imageUrls),
            record.detailUrl ?? null,
            record.sourceUrl,
            page.id ?? null,
            contentHash,
            JSON.stringify(record.metadata),
          ],
        );
      }

      let deactivated = 0;
      if (options.complete ?? true) {
        const ids = records.map(record => record.inventoryId);
        const result = await client.query(
          `UPDATE ford.used_vehicles
           SET active = FALSE
           WHERE source_page_id IS NOT DISTINCT FROM $1
             AND active
             AND NOT (inventory_id = ANY($2::text[]))`,
          [page.id ?? null, ids],
        );
        deactivated = result.rowCount ?? 0;
      }
      await client.query('COMMIT');
      return {seen: records.length, changed, deactivated};
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
