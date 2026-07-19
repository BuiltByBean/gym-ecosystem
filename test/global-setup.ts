/* Boots one embedded Postgres cluster for the whole test run (unless CI provides
 * PG_TEST_ADMIN_URL via a service container). Suites create their own databases
 * through @gym/db/testing. */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const TEST_PORT = 5434;

export default async function setup(): Promise<(() => Promise<void>) | void> {
  if (process.env.PG_TEST_ADMIN_URL) return;

  const dir = path.join(process.cwd(), '.pgdata-test');
  const dataDir = path.join(dir, 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const epg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port: TEST_PORT,
    persistent: true, // keep the initialised cluster between runs; re-init is slow
    onLog: () => {},
    onError: () => {},
  });

  if (!fs.existsSync(path.join(dataDir, 'PG_VERSION'))) {
    await epg.initialise();
  }
  const pidFile = path.join(dataDir, 'postmaster.pid');
  try {
    await epg.start();
  } catch (err) {
    if (fs.existsSync(pidFile)) {
      fs.rmSync(pidFile);
      await epg.start();
    } else {
      throw err;
    }
  }

  const adminUrl = `postgres://postgres:postgres@127.0.0.1:${TEST_PORT}/postgres`;
  fs.writeFileSync(path.join(dir, 'admin-url'), adminUrl);

  // Sweep databases left behind by previously crashed runs.
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  const leftovers = await client.query(
    `SELECT datname FROM pg_database WHERE datname LIKE 'gym_test_%'`,
  );
  for (const row of leftovers.rows as { datname: string }[]) {
    await client.query(`DROP DATABASE IF EXISTS "${row.datname}" WITH (FORCE)`);
  }
  await client.end();

  return async () => {
    await epg.stop();
  };
}
