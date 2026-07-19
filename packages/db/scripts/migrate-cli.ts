import { env } from '../src/env.js';
import { runMigrations } from '../src/migrate.js';

const applied = await runMigrations(env.DATABASE_ADMIN_URL, (m) => console.log(m));
console.log(applied.length ? `applied ${applied.length} migration(s)` : 'up to date');
