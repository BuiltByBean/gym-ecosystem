/* Boots one embedded Postgres cluster for the whole test run (unless CI provides
 * PG_TEST_ADMIN_URL via a service container). Suites create their own databases
 * through @gym/db/testing.
 *
 * Windows reality: when vitest force-exits, postgres children get orphaned and
 * wedge the next run's cluster ("shared memory block is still in use"). So both
 * setup and teardown kill the postmaster PROCESS TREE by pid, ruthlessly. */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const TEST_PORT = 5434;

/** Kill embedded-postgres processes whose parent is dead — the zombies a
 *  force-killed run leaves behind, which pin shared memory and wedge re-init.
 *  Scoped to binaries under node_modules/@embedded-postgres so a system
 *  Postgres install is never touched. */
function killOrphanedEmbeddedPostgres(): void {
  if (process.platform !== 'win32') return;
  try {
    execSync(
      // dying workers can report a null ExecutablePath — treat pathless orphans as ours too
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='postgres.exe'\\" | ForEach-Object { if (($_.ExecutablePath -like '*embedded-postgres*' -or -not $_.ExecutablePath) -and -not (Get-Process -Id $_.ParentProcessId -ErrorAction SilentlyContinue)) { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } }"`,
      { stdio: 'ignore', timeout: 20_000 },
    );
  } catch {
    /* best effort */
  }
}

function killPostmasterTree(dataDir: string): void {
  const pidFile = path.join(dataDir, 'postmaster.pid');
  if (!fs.existsSync(pidFile)) return;
  try {
    const pid = Number(fs.readFileSync(pidFile, 'utf8').split(/\r?\n/)[0]);
    if (Number.isFinite(pid) && pid > 0) {
      if (process.platform === 'win32') {
        execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
      } else {
        process.kill(pid, 'SIGKILL');
      }
    }
  } catch {
    // already dead — fine
  }
  try {
    fs.rmSync(pidFile);
  } catch {
    /* ignore */
  }
}

export default async function setup(): Promise<(() => Promise<void>) | void> {
  if (process.env.PG_TEST_ADMIN_URL) return;

  const dir = path.join(process.cwd(), '.pgdata-test');
  const dataDir = path.join(dir, 'data');
  fs.mkdirSync(dataDir, { recursive: true });

  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const makeEpg = () =>
    new EmbeddedPostgres({
      databaseDir: dataDir,
      user: 'postgres',
      password: 'postgres',
      port: TEST_PORT,
      persistent: true,
      onLog: () => {},
      onError: () => {},
    });

  let epg = makeEpg();
  killOrphanedEmbeddedPostgres(); // zombies from force-killed runs pin shared memory
  killPostmasterTree(dataDir);    // stale pid file from the same

  if (!fs.existsSync(path.join(dataDir, 'PG_VERSION'))) {
    await epg.initialise();
  }
  try {
    await epg.start();
  } catch (err) {
    // Wedged cluster state — disposable, rebuild from scratch.
    console.warn('[test-pg] start failed, rebuilding test cluster…', err ?? '(no error detail)');
    killOrphanedEmbeddedPostgres();
    killPostmasterTree(dataDir);
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    epg = makeEpg();
    await epg.initialise();
    await epg.start();
  }

  const adminUrl = `postgres://postgres:postgres@127.0.0.1:${TEST_PORT}/postgres`;
  fs.writeFileSync(path.join(dir, 'admin-url'), adminUrl);

  // Sweep databases left behind by previously crashed runs.
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  const leftovers = await client.query(`SELECT datname FROM pg_database WHERE datname LIKE 'gym_test_%'`);
  for (const row of leftovers.rows as { datname: string }[]) {
    await client.query(`DROP DATABASE IF EXISTS "${row.datname}" WITH (FORCE)`);
  }
  await client.end();

  return async () => {
    try {
      await Promise.race([epg.stop(), new Promise((r) => setTimeout(r, 5000))]);
    } catch {
      /* ignore */
    }
    killPostmasterTree(dataDir); // belt and braces: no orphans, ever
  };
}
