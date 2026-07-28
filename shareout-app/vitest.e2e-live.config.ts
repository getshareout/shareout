import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/e2e-live/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 90_000,
    fileParallelism: false,
    sequence: { concurrent: false },
    reporters: ['verbose'],
  },
});
