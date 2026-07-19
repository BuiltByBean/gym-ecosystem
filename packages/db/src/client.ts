import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import * as schema from './schema/index.js';
import { env } from './env.js';

export interface TenantCtx {
  gymId: string | null;
  userId: string | null;
}

/** Postgres array-literal for parameterized `ANY(${...}::uuid[])` casts.
 *  (drizzle's sql template expands JS arrays into placeholder lists, which
 *  breaks array casts — pass one text param instead.) */
export function uuidArrayLiteral(ids: string[]): string {
  for (const id of ids) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error(`not a uuid: ${id}`);
  }
  return `{${ids.join(',')}}`;
}

export function createDb(connectionString: string) {
  const pool = new pg.Pool({ connectionString, max: 10 });
  const db = drizzle(pool, { schema });

  /**
   * Every tenant-data access runs inside this wrapper. It opens a transaction and
   * sets transaction-local `app.gym_id` / `app.user_id`, which the RLS policies read.
   * No context set => policies fail closed => zero rows.
   */
  async function withTenant<T>(ctx: TenantCtx, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('app.gym_id', ${ctx.gymId ?? ''}, true), set_config('app.user_id', ${ctx.userId ?? ''}, true)`,
      );
      return fn(tx);
    });
  }

  return { pool, db, withTenant, end: () => pool.end() };
}

export type DbBundle = ReturnType<typeof createDb>;
export type Db = DbBundle['db'];
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

let defaultBundle: DbBundle | undefined;
/** Process-wide bundle bound to DATABASE_URL (the RLS-enforced app role). */
export function getDb(): DbBundle {
  defaultBundle ??= createDb(env.DATABASE_URL);
  return defaultBundle;
}
