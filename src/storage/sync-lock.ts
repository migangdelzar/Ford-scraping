import type {Pool, PoolClient} from 'pg';

export class PostgresAdvisoryLock {
  private client?: PoolClient;

  constructor(private readonly pool: Pool) {}

  async tryAcquire(key: string): Promise<boolean> {
    if (this.client) return true;
    const client = await this.pool.connect();
    const result = await client.query<{acquired: boolean}>(
      'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired',
      [key],
    );
    if (!result.rows[0].acquired) {
      client.release();
      return false;
    }
    this.client = client;
    return true;
  }

  async release(key: string): Promise<void> {
    const client = this.client;
    this.client = undefined;
    if (!client) return;
    try {
      await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [
        key,
      ]);
    } finally {
      client.release();
    }
  }
}
