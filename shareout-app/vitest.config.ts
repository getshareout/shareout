import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'istanbul',
      include: ['src/**/*.ts'],
      reporter: ['text', 'json', 'lcov'],
      // Regression floor, not a target. Measured ~67/56/66/70 (S/B/F/L) on 2026-07-09
      // before the robustness P0/P1 test wave; floors sit just under that band.
      // Bump these up as coverage improves; only lower them with a clear reason.
      thresholds: {
        statements: 66,
        branches: 55,
        functions: 62,
        lines: 67,
      },
    },
    projects: [
      {
        plugins: [
          cloudflareTest({
            // Use local Miniflare bindings in CI/tests (wrangler.toml sets remote=true for dev).
            wrangler: { configPath: './wrangler.test.toml' },
          }),
        ],
        test: {
          name: 'workers',
          include: ['tests/unit/**/*.test.ts'],
          exclude: [
            'tests/unit/openapi-contract.test.ts',
            'tests/unit/pages/home-views.test.ts',
            'tests/unit/editor/chat.test.ts',
            'tests/unit/editor/collab.test.ts',
            'tests/unit/editor/dashboard.test.ts',
            'tests/unit/editor/index.test.ts',
            'tests/unit/editor/presentation.test.ts',
            'tests/unit/design-system/components-dom.test.ts',
            'tests/unit/pages/admin-lens-smoke.test.ts',
          ],
        },
      },
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['tests/unit/openapi-contract.test.ts', 'tests/unit/pages/home-views.test.ts'],
        },
      },
      {
        test: {
          name: 'happy-dom',
          include: [
            'tests/unit/editor/chat.test.ts',
            'tests/unit/editor/collab.test.ts',
            'tests/unit/editor/dashboard.test.ts',
            'tests/unit/editor/index.test.ts',
            'tests/unit/editor/presentation.test.ts',
            'tests/unit/design-system/components-dom.test.ts',
            'tests/unit/pages/admin-lens-smoke.test.ts',
          ],
          environment: 'happy-dom',
        },
      },
    ],
  },
});
