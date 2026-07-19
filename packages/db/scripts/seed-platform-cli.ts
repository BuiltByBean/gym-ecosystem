/* Platform content only — taxonomies, the curated exercise library and its
 * graph, default templates and progression rules. Idempotent and safe to run
 * against production; contains no demo/tenant data. */
import { seedPlatform } from '../../../seeds/platform/index.js';

await seedPlatform();
console.log('[seed] platform content ready');
