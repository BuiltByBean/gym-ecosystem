import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/api/test/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.pgdata/**',
      '**/.pgdata-test/**',
      '**/uploads/**',
      '**/.git/**',
    ],
    globalSetup: './test/global-setup.ts',
    pool: 'forks',
    hookTimeout: 180_000,
    testTimeout: 30_000,
  },
});
