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
/** Arbitrary fixed key so every process contends on the same advisory lock. */
const ROLE_LOCK_KEY = 4_190_233_771;

async function ensureAppRole(client: pg.Client): Promise<void> {
  // CREATE/ALTER ROLE cannot take bind parameters, so the password is inlined —
  // single quotes doubled per SQL string-literal escaping.
  const literal = `'${env.APP_DB_PASSWORD.replaceAll("'", "''")}'`;
  // Role rows are cluster-global: concurrent migrators (parallel test suites,
  // or two deploys) racing CREATE/ALTER on the same row raise "tuple
  // concurrently updated". Serialize the whole check-then-write here.
  await client.query('BEGIN');
  try {
    await client.query(`SELECT pg_advisory_xact_lock(${ROLE_LOCK_KEY})`);
    const role = await client.query(`SELECT 1 FROM pg_roles WHERE rolname = 'app_rw'`);
    if (role.rowCount === 0) {
      await client.query(`CREATE ROLE app_rw LOGIN PASSWORD ${literal}`);
    } else {
      // keep the role's password in sync with the environment across redeploys
      await client.query(`ALTER ROLE app_rw LOGIN PASSWORD ${literal}`);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  }
}

/** Create the target database and the RLS-bound app role if missing.
 *  `clusterAdminUrl` must point at an existing db (usually `postgres`). */
export async function ensureDatabase(clusterAdminUrl: string, dbName: string): Promise<void> {
  const client = new pg.Client({ connectionString: clusterAdminUrl });
  await client.connect();
  try {
    await ensureAppRole(client);
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
export async function runMigrations(adminUrl: string, log: (msg: string) => void = () => {}): Promise<string[]> {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  const applied: string[] = [];
  try {
    await ensureAppRole(client);
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
