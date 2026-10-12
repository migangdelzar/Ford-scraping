import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import type {Pool} from 'pg';
import {createPool} from '../../src/storage/database.js';
import {integrationDatabaseUrl} from './integration-database.js';
import {SyncRunRepository} from '../../src/storage/sync-run-repository.js';

const databaseUrl = integrationDatabaseUrl();
let pool: Pool;

describe('SyncRunRepository', () => {
  beforeAll(async () => {
    pool = createPool(databaseUrl);
    await pool.query('TRUNCATE ford.sync_runs CASCADE');
  });

  afterAll(async () => {
    await pool.end();
  });

  it('records successful and failed synchronization runs', async () => {
    const repository = new SyncRunRepository(pool);
    const success = await repository.start('site');
    await repository.finish(success, {pagesChanged: 3});
    const failed = await repository.start('site');
    await repository.fail(failed, new Error('network failure'));

    const rows = await pool.query(
      'SELECT status, counters, error FROM ford.sync_runs ORDER BY started_at',
    );
    expect(rows.rows).toEqual([
      {status: 'succeeded', counters: {pagesChanged: 3}, error: null},
      {
        status: 'failed',
        counters: {},
        error: {message: 'network failure'},
      },
    ]);
  });
});
