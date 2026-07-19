import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { createDb, type DbBundle } from './client.js';
import { ensureDatabase, runMigrations } from './migrate.js';
import { env, repoRoot } from './env.js';

const URL_FILE = path.join(repoRoot(), '.pgdata-test', 'admin-url');

/** Admin URL for the test cluster: CI provides PG_TEST_ADMIN_URL; locally the
 *  vitest globalSetup boots an embedded instance and writes the url file. */
export function getTestClusterAdminUrl(): string {
  if (process.env.PG_TEST_ADMIN_URL) return process.env.PG_TEST_ADMIN_URL;
  if (fs.existsSync(URL_FILE)) return fs.readFileSync(URL_FILE, 'utf8').trim();
  throw new Error(
    'No test Postgres available. Run tests via `npm test` (vitest globalSetup boots one) or set PG_TEST_ADMIN_URL.',
  );
}

export interface TestDb {
  bundle: DbBundle;      // app_rw connection — RLS enforced
  adminUrl: string;      // owner connection to this test database
  adminQuery: (text: string, params?: unknown[]) => Promise<pg.QueryResult>;
  destroy: () => Promise<void>;
}

let counter = 0;

/** Fresh, fully-migrated database per test suite. app connection runs as app_rw. */
export async function createTestDb(): Promise<TestDb> {
  const clusterUrl = getTestClusterAdminUrl();
  const dbName = `gym_test_${Date.now().toString(36)}_${process.pid}_${counter++}`;
  await ensureDatabase(clusterUrl, dbName);

  const parsed = new URL(clusterUrl);
  parsed.pathname = `/${dbName}`;
  const adminUrl = parsed.toString();
  await runMigrations(adminUrl);

  const appUrl = new URL(adminUrl);
  appUrl.username = 'app_rw';
  appUrl.password = env.APP_DB_PASSWORD;
  const bundle = createDb(appUrl.toString());

  const adminPool = new pg.Pool({ connectionString: adminUrl, max: 2 });

  return {
    bundle,
    adminUrl,
    adminQuery: (text, params) => adminPool.query(text, params as never[]),
    destroy: async () => {
      await bundle.end();
      await adminPool.end();
      const cleanup = new pg.Client({ connectionString: clusterUrl });
      await cleanup.connect();
      try {
        await cleanup.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
      } finally {
        await cleanup.end();
      }
    },
  };
}
