import fs from 'node:fs';
import path from 'node:path';

/** Walk upward to the workspace root (the package.json with "workspaces"). */
export function repoRoot(start = process.cwd()): string {
  let dir = start;
  for (let i = 0; i < 10; i++) {
    const pkg = path.join(dir, 'package.json');
    if (fs.existsSync(pkg)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(pkg, 'utf8'));
        if (parsed.workspaces) return dir;
      } catch {
        // unreadable package.json — keep walking
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

let loaded = false;
/** Minimal .env loader (no dep). Never overrides variables already set. */
export function loadDotEnv(): void {
  if (loaded) return;
  loaded = true;
  const file = path.join(repoRoot(), '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    const key = m[1]!;
    let val = m[2]!;
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

loadDotEnv();

const PG_PORT = Number(process.env.PG_PORT ?? 5433);

/** Dev defaults mirror .env.example so `npm run dev` works with no .env file. */
export const env = {
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  PG_PORT,
  DATABASE_URL:
    process.env.DATABASE_URL ?? `postgres://app_rw:app_rw_dev_pw@127.0.0.1:${PG_PORT}/gym_dev`,
  DATABASE_ADMIN_URL:
    process.env.DATABASE_ADMIN_URL ?? `postgres://postgres:postgres@127.0.0.1:${PG_PORT}/gym_dev`,
  API_PORT: Number(process.env.API_PORT ?? 3001),
  WEB_ORIGIN: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
  SENSITIVE_DATA_KEY: process.env.SENSITIVE_DATA_KEY ?? 'dev-only-sensitive-data-key',
  UPLOADS_DIR: process.env.UPLOADS_DIR ?? path.join(repoRoot(), 'uploads'),
  APP_DB_PASSWORD: process.env.APP_DB_PASSWORD ?? 'app_rw_dev_pw',
} as const;

export const isProduction = env.NODE_ENV === 'production';
