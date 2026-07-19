/* Seed entry point. Platform content (exercise library, taxonomies, default
 * templates) + dev-only demo gym. Filled in as domains land; run via `npm run db:seed`. */

export async function seedAll(): Promise<void> {
  const { seedPlatform } = await import('./platform/index.js');
  const { seedDemo } = await import('./dev/demo.js');
  await seedPlatform();
  await seedDemo();
  console.log('[seed] done');
}
