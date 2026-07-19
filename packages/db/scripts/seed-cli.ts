/* Loads platform content (safe anywhere) and dev demo data (dev only). */
import { isProduction } from '../src/env.js';

const { seedAll } = await import('../../../seeds/index.js');

if (isProduction) {
  console.error('Refusing to load demo seed data with NODE_ENV=production.');
  console.error('Platform content can be loaded in prod via seeds/platform once that path is split out.');
  process.exit(1);
}

await seedAll();
