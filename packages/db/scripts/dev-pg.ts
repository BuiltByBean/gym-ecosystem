/* Dev Postgres lifecycle: boots embedded binaries, ensures db + app role,
 * runs migrations, then stays alive until Ctrl+C. `npm run dev` runs this. */
import fs from 'node:fs';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import { env, repoRoot } from '../src/env.js';
import { ensureDatabase, runMigrations } from '../src/migrate.js';

const dataDir = path.join(repoRoot(), '.pgdata', 'data');
const port = env.PG_PORT;

async function main() {
  const epg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: true,
    onLog: () => {},
    onError: (msg: unknown) => console.error('[pg]', msg),
  });

  if (!fs.existsSync(path.join(dataDir, 'PG_VERSION'))) {
    console.log('[db] initialising embedded Postgres cluster…');
    await epg.initialise();
  }

  const pidFile = path.join(dataDir, 'postmaster.pid');
  try {
    await epg.start();
  } catch (err) {
    // A hard-killed previous run can leave a stale pid file; clear and retry once.
    if (fs.existsSync(pidFile)) {
      console.warn('[db] stale postmaster.pid — removing and retrying');
      fs.rmSync(pidFile);
      await epg.start();
    } else {
      throw err;
    }
  }

  const clusterUrl = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`;
  await ensureDatabase(clusterUrl, 'gym_dev');
  const applied = await runMigrations(env.DATABASE_ADMIN_URL, (m) => console.log(`[db] ${m}`));
  console.log(
    `[db] Postgres ready on :${port} (gym_dev)${applied.length ? `, ${applied.length} migration(s) applied` : ''}`,
  );

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    console.log('[db] stopping…');
    try {
      await epg.stop();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  // Keep the process alive.
  setInterval(() => {}, 1 << 30);
}

main().catch((err) => {
  console.error('[db] failed to start:', err);
  process.exit(1);
});
