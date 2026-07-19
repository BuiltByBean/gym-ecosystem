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

const NODE_ENV = process.env.NODE_ENV ?? 'development';
const IS_PROD = NODE_ENV === 'production';
const PG_PORT = Number(process.env.PG_PORT ?? 5433);
const APP_DB_USER = 'app_rw';

function required(name: string, hint: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name} in production.\n${hint}\n` +
        `Set it with: railway variables --set "${name}=<value>"`,
    );
  }
  return value;
}

/**
 * Tenant isolation needs TWO database identities (docs/ARCHITECTURE.md §4):
 *   - owner  → migrations, DDL, seeds
 *   - app_rw → the application, non-owner so RLS is never bypassed
 *
 * Managed providers (Railway, Neon, RDS) hand you ONE url with the owner role.
 * So: if DATABASE_ADMIN_URL is unset, treat DATABASE_URL as the owner url and
 * derive the app_rw url from it. The role itself is created by the migrator.
 */
function resolveDatabaseUrls(): { app: string; admin: string; appPassword: string } {
  const explicitAdmin = process.env.DATABASE_ADMIN_URL;
  const provided = process.env.DATABASE_URL;

  if (explicitAdmin && provided) {
    return {
      app: provided,
      admin: explicitAdmin,
      appPassword: process.env.APP_DB_PASSWORD ?? 'app_rw_dev_pw',
    };
  }

  if (provided) {
    const appPassword = IS_PROD
      ? required(
          'APP_DB_PASSWORD',
          'Password for the RLS-enforced application role (app_rw). Generate a strong random value.',
        )
      : (process.env.APP_DB_PASSWORD ?? 'app_rw_dev_pw');
    const appUrl = new URL(provided);
    appUrl.username = APP_DB_USER;
    appUrl.password = appPassword;
    return { app: appUrl.toString(), admin: provided, appPassword };
  }

  if (IS_PROD) {
    throw new Error('Missing DATABASE_URL in production — attach a Postgres database to this service.');
  }
  return {
    app: `postgres://app_rw:app_rw_dev_pw@127.0.0.1:${PG_PORT}/gym_dev`,
    admin: `postgres://postgres:postgres@127.0.0.1:${PG_PORT}/gym_dev`,
    appPassword: 'app_rw_dev_pw',
  };
}

const db = resolveDatabaseUrls();

/** Public origin, used for invite links. Railway injects RAILWAY_PUBLIC_DOMAIN. */
function resolveWebOrigin(): string {
  if (process.env.WEB_ORIGIN) return process.env.WEB_ORIGIN;
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  return 'http://localhost:5173';
}

/**
 * Key for app-layer encryption of health data. A dev default is fine locally;
 * in production a known key would mean the sensitive columns are not protected
 * at all, so boot fails loudly instead.
 */
function resolveSensitiveKey(): string {
  if (IS_PROD) {
    return required(
      'SENSITIVE_DATA_KEY',
      'Encryption key for PAR-Q answers, injury notes, and progress photos. ' +
        'Generate: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))". ' +
        'Rotating this key makes existing encrypted rows unreadable — set it once, keep it safe.',
    );
  }
  return process.env.SENSITIVE_DATA_KEY ?? 'dev-only-sensitive-data-key';
}

export const env = {
  NODE_ENV,
  PG_PORT,
  DATABASE_URL: db.app,
  DATABASE_ADMIN_URL: db.admin,
  APP_DB_PASSWORD: db.appPassword,
  /** Railway/Heroku-style injected port; falls back to the dev API port. */
  API_PORT: Number(process.env.PORT ?? process.env.API_PORT ?? 3001),
  HOST: process.env.HOST ?? (IS_PROD ? '0.0.0.0' : '127.0.0.1'),
  WEB_ORIGIN: resolveWebOrigin(),
  SENSITIVE_DATA_KEY: resolveSensitiveKey(),
  UPLOADS_DIR: process.env.UPLOADS_DIR ?? path.join(repoRoot(), 'uploads'),
  /** Apply pending migrations during API boot (single-replica deploys). */
  MIGRATE_ON_BOOT: (process.env.MIGRATE_ON_BOOT ?? String(IS_PROD)) === 'true',
} as const;

export const isProduction = IS_PROD;
