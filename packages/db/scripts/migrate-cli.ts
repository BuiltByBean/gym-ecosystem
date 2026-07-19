import { env } from '../src/env.js';
import { runMigrations } from '../src/migrate.js';

const applied = await runMigrations(env.DATABASE_ADMIN_URL, {
  log: (m) => console.log(m),
  syncRolePassword: true,
});
console.log(applied.length ? `applied ${applied.length} migration(s)` : 'up to date');
