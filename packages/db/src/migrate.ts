import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { env } from './env.js';

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/** Create the target database and the RLS-bound app role if missing.
 *  `clusterAdminUrl` must point at an existing db (usually `postgres`). */
export async function ensureDatabase(clusterAdminUrl: string, dbName: string): Promise<void> {
  const client = new pg.Client({ connectionString: clusterAdminUrl });
  await client.connect();
  try {
    const role = await client.query(`SELECT 1 FROM pg_roles WHERE rolname = 'app_rw'`);
    if (role.rowCount === 0) {
      try {
        await client.query(`CREATE ROLE app_rw LOGIN PASSWORD '${env.APP_DB_PASSWORD}'`);
      } catch (err) {
        // parallel test suites on a fresh cluster can race this create —
        // 23505/42710 mean another connection won; that's fine
        const code = (err as { code?: string }).code;
        if (code !== '23505' && code !== '42710') throw err;
      }
    }
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
