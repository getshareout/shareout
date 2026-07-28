import { defineConfig } from 'vitest/config';

/** Node-only Vitest config for stable Istanbul coverage (avoids workers-pool .tmp races). */
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
    maxWorkers: 1,
    fileParallelism: false,
    coverage: {
      provider: 'istanbul',
      include: [
        'src/data/platform/**/*.ts',
        'src/data/router.ts',
      ],
      reporter: ['text', 'json-summary'],
      reportsDirectory: './coverage-unit',
    },
  },
});
