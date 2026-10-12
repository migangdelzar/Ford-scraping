const DEFAULT_TEST_DATABASE_URL =
  'postgres://postgres:postgres@localhost:5432/ford_test';

export function integrationDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const databaseUrl = env.FORD_TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
  let databaseName = '';
  try {
    databaseName = new URL(databaseUrl).pathname.slice(1);
  } catch {
    throw new Error('FORD_TEST_DATABASE_URL must be a valid URL');
  }
  if (!databaseName.endsWith('_test')) {
    throw new Error(
      'FORD_TEST_DATABASE_URL must name a dedicated *_test database',
    );
  }
  return databaseUrl;
}
