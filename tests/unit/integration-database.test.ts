import {describe, expect, it} from 'vitest';
import {integrationDatabaseUrl} from '../../tests/integration/integration-database.js';

describe('integration test database selection', () => {
  it('uses a dedicated test database instead of DATABASE_URL', () => {
    expect(
      integrationDatabaseUrl({
        DATABASE_URL: 'postgres://localhost/ford',
      } as NodeJS.ProcessEnv),
    ).toBe('postgres://postgres:postgres@localhost:5432/ford_test');
  });

  it('rejects a configured database without a test suffix', () => {
    expect(() =>
      integrationDatabaseUrl({
        FORD_TEST_DATABASE_URL: 'postgres://localhost/ford',
      } as NodeJS.ProcessEnv),
    ).toThrow('FORD_TEST_DATABASE_URL must name a dedicated *_test database');
  });
});
