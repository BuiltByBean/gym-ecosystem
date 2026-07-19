import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { env } from './env.js';

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/**
 * The app connects as a NON-OWNER role so RLS can never be bypassed
 * (docs/ARCHITECTURE.md §4). Owner-only providers (Railway, Neon) hand us one
 * superuser-ish url; this creates the second identity from it.
 */
/** Postgres error codes raised when another connection wins a race on the
 *  cluster-global role row. Advisory locks cannot help here: they are scoped to
 *  a database, and concurrent migrators each work in their own. */
const ROLE_RACE_CODES = new Set([
  '23505', // unique_violation
  '42710', // duplicate_object
  'XX000', // "tuple concurrently updated"
]);

const errCode = (err: unknown): string | undefined => (err as { code?: string }).code;

async function ensureAppRole(client: pg.Client, syncPassword: boolean): Promise<void> {
  // CREATE/ALTER ROLE cannot take bind parameters, so the password is inlined —
  // single quotes doubled per SQL string-literal escaping.
  const literal = `'${env.APP_DB_PASSWORD.replaceAll("'", "''")}'`;
  const exists = await client.query(`SELECT 1 FROM pg_roles WHERE rolname = 'app_rw'`);

  if (exists.rowCount === 0) {
    try {
      await client.query(`CREATE ROLE app_rw LOGIN PASSWORD ${literal}`);
    } catch (err) {
      if (!ROLE_RACE_CODES.has(errCode(err) ?? '')) throw err;
    }
    return;
  }

  // Rewriting the password on every run would make parallel migrators collide
  // on one row, so deployments opt in — that is where APP_DB_PASSWORD can
  // actually have changed since the role was created.
  if (!syncPassword) return;
  try {
    await client.query(`ALTER ROLE app_rw LOGIN PASSWORD ${literal}`);
  } catch (err) {
    if (!ROLE_RACE_CODES.has(errCode(err) ?? '')) throw err;
  }
}

export interface MigrateOptions {
  log?: (msg: string) => void;
  /** Rewrite app_rw's password from APP_DB_PASSWORD. Deployments want this;
   *  concurrent migrators (parallel test suites) must not. */
  syncRolePassword?: boolean;
}

/** Create the target database and the RLS-bound app role if missing.
 *  `clusterAdminUrl` must point at an existing db (usually `postgres`). */
export async function ensureDatabase(
  clusterAdminUrl: string,
  dbName: string,
  opts: MigrateOptions = {},
): Promise<void> {
  const client = new pg.Client({ connectionString: clusterAdminUrl });
  await client.connect();
  try {
    await ensureAppRole(client, opts.syncRolePassword ?? false);
    if (!/^[a-z_][a-z0-9_]*$/.test(dbName)) throw new Error(`invalid database name: ${dbName}`);
    const db = await client.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [dbName]);
    if (db.rowCount === 0) {
      // Windows initdb defaults to a legacy encoding — force UTF8 explicitly.
      await client.query(
        `CREATE DATABASE "${dbName}" ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0`,
      );
    }
  } finally {
    await client.end();
  }
}

/** Apply pending migrations (owner connection), then re-grant to app_rw. */
export async function runMigrations(adminUrl: string, opts: MigrateOptions = {}): Promise<string[]> {
  const log = opts.log ?? (() => {});
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  const applied: string[] = [];
  try {
    await ensureAppRole(client, opts.syncRolePassword ?? false);
    await client.query(
      `CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
    );
    const done = new Set(
      (await client.query(`SELECT name FROM _migrations`)).rows.map((r: { name: string }) => r.name),
    );
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(`INSERT INTO _migrations (name) VALUES ($1)`, [file]);
        await client.query('COMMIT');
        applied.push(file);
        log(`applied ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${file} failed: ${(err as Error).message}`);
      }
    }
    // Re-grant every run so tables from new migrations are always covered.
    await client.query(`GRANT USAGE ON SCHEMA public TO app_rw`);
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_rw`);
    await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_rw`);
    await client.query(`REVOKE ALL ON _migrations FROM app_rw`);
  } finally {
    await client.end();
  }
  return applied;
}
