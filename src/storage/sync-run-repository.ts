import type {Pool} from 'pg';
import type {SyncRunCounters} from '../domain/sync.js';

export class SyncRunRepository {
  constructor(private readonly pool: Pool) {}

  async start(runType: string): Promise<string> {
    const result = await this.pool.query<{id: string}>(
      'INSERT INTO ford.sync_runs (run_type) VALUES ($1) RETURNING id',
      [runType],
    );
    return result.rows[0].id;
  }

  async finish(runId: string, counters: SyncRunCounters): Promise<void> {
    await this.pool.query(
      `UPDATE ford.sync_runs
       SET status = 'succeeded', finished_at = now(), counters = $2::jsonb
       WHERE id = $1`,
      [runId, JSON.stringify(counters)],
    );
  }

  async fail(runId: string, error: unknown): Promise<void> {
    await this.pool.query(
      `UPDATE ford.sync_runs
       SET status = 'failed', finished_at = now(), error = $2::jsonb
       WHERE id = $1`,
      [
        runId,
        JSON.stringify({
          message: error instanceof Error ? error.message : String(error),
        }),
      ],
    );
  }
}
