import {readdir, readFile} from 'node:fs/promises';
import {basename, join} from 'node:path';
import type {Pool} from 'pg';
import pg from 'pg';

export function createPool(databaseUrl: string): Pool {
  return new pg.Pool({connectionString: databaseUrl});
}

export async function runMigrations(
  pool: Pool,
  migrationsDirectory = 'db/migrations',
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const files = (await readdir(migrationsDirectory))
      .filter(file => file.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const applied = await client.query(
        'SELECT 1 FROM schema_migrations WHERE filename = $1',
        [file],
      );
      if (applied.rowCount) continue;

      await client.query(
        await readFile(join(migrationsDirectory, file), 'utf8'),
      );
      await client.query(
        'INSERT INTO schema_migrations (filename) VALUES ($1)',
        [basename(file)],
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
