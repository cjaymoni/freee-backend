import { Client } from 'pg';

/**
 * For specs that need a real Postgres. They run only when TEST_DATABASE_URL
 * names a disposable database, and drop its schema, e.g.
 *   docker run --rm -d -p 55432:5432 -e POSTGRES_PASSWORD=test \
 *     -e POSTGRES_DB=freee_test postgres:16-alpine
 * then point TEST_DATABASE_URL at it (user postgres, password test, host
 * localhost:55432, database freee_test) and run the spec.
 */
export const testDatabaseUrl = process.env.TEST_DATABASE_URL;

/** `describe` when a test database is configured, otherwise skipped. */
export const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/**
 * Throws unless the URL names a *_test database. The host alone is not
 * enough: a localhost port can be a tunnel to a real database.
 */
export function assertDisposable(databaseUrl: string): void {
  const { hostname, pathname } = new URL(databaseUrl);
  const database = decodeURIComponent(pathname.replace(/^\//, ''));
  if (!database.endsWith('_test')) {
    throw new Error(
      `Refusing to drop the schema of ${hostname}/${database}: ` +
        'TEST_DATABASE_URL must name a *_test database.',
    );
  }
}

/**
 * A database of its own for one spec, next to the one TEST_DATABASE_URL
 * names (freee_test gives freee_<name>_test), created if missing. Jest runs
 * spec files in parallel, and each drops its schema, so they can't share.
 */
export async function testDatabaseFor(name: string): Promise<string> {
  assertDisposable(testDatabaseUrl!);
  const url = new URL(testDatabaseUrl!);
  const base = decodeURIComponent(url.pathname.slice(1)).replace(/_test$/, '');
  const database = `${base}_${name}_test`;
  if (!/^[a-z0-9_]+$/.test(database)) {
    throw new Error(`Unexpected test database name: ${database}`);
  }

  const admin = new Client({ connectionString: testDatabaseUrl });
  await admin.connect();
  try {
    const { rowCount } = await admin.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [database],
    );
    if (!rowCount) await admin.query(`CREATE DATABASE "${database}"`);
  } finally {
    await admin.end();
  }

  url.pathname = `/${database}`;
  return url.toString();
}
