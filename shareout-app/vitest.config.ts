import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { sharedIsolateFiles } from './tests/isolation';

// Run by the node / happy-dom / workers-chat projects below, not the workers pool.
const NOT_WORKERS_FILES = [
  'tests/unit/chat-agent/session-do.test.ts',
  'tests/unit/openapi-contract.test.ts',
  'tests/unit/source-timestamps.test.ts',
  'tests/unit/http/d1-session-sources.test.ts',
  'tests/unit/pages/home-views.test.ts',
  'tests/unit/bundle-versions.test.ts',
  'tests/unit/scripts/stage-skill-bundle.test.ts',
  'tests/unit/scripts/provision-workspace.test.ts',
  'tests/unit/editor/chat.test.ts',
  'tests/unit/editor/collab.test.ts',
  'tests/unit/editor/dashboard.test.ts',
  'tests/unit/editor/index.test.ts',
  'tests/unit/editor/presentation.test.ts',
  'tests/unit/design-system/components-dom.test.ts',
  'tests/unit/pages/admin-lens-smoke.test.ts',
  'tests/unit/pages/schedules-lens.test.ts',
  'tests/unit/pages/auto-forms.test.ts',
  'tests/unit/pages/knowledge-map.test.ts',
  'tests/unit/pages/member-permissions-dom.test.ts',
  'tests/unit/pages/home-new-and-empty.test.ts',
];
const NOT_WORKERS = ['tests/unit/**/*.dom.test.ts', ...NOT_WORKERS_FILES];
const isNotWorkers = (rel: string) => rel.endsWith('.dom.test.ts') || NOT_WORKERS_FILES.includes(rel);

// Workers-pool files that can share one isolate — see tests/isolation.ts.
const SHARED = sharedIsolateFiles(fileURLToPath(new URL('.', import.meta.url)), 'tests/unit', isNotWorkers);

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
          exclude: [...NOT_WORKERS, ...SHARED],
        },
      },
      {
        plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.test.toml' } })],
        test: {
          name: 'workers-shared',
          include: SHARED,
          isolate: false,
        },
      },
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: './wrangler.test.toml' },
            main: './src/index.ts',
          }),
        ],
        test: {
          name: 'workers-chat',
          include: ['tests/unit/chat-agent/session-do.test.ts'],
        },
      },
      {
        resolve: { alias: { 'cloudflare:workers': new URL('./tests/stubs/cloudflare-workers.ts', import.meta.url).pathname } },
        test: {
          name: 'node',
          environment: 'node',
          include: [
            'tests/unit/openapi-contract.test.ts',
            'tests/unit/source-timestamps.test.ts',
            'tests/unit/http/d1-session-sources.test.ts',
            'tests/unit/pages/home-views.test.ts',
            'tests/unit/bundle-versions.test.ts',
            'tests/unit/scripts/stage-skill-bundle.test.ts',
            'tests/unit/scripts/provision-workspace.test.ts',
          ],
        },
      },
      {
        resolve: { alias: { 'cloudflare:workers': new URL('./tests/stubs/cloudflare-workers.ts', import.meta.url).pathname } },
        test: {
          name: 'happy-dom',
          include: [
            'tests/unit/**/*.dom.test.ts',
            'tests/unit/editor/chat.test.ts',
            'tests/unit/editor/collab.test.ts',
            'tests/unit/editor/dashboard.test.ts',
            'tests/unit/editor/index.test.ts',
            'tests/unit/editor/presentation.test.ts',
            'tests/unit/design-system/components-dom.test.ts',
            'tests/unit/pages/admin-lens-smoke.test.ts',
            'tests/unit/pages/schedules-lens.test.ts',
            'tests/unit/pages/auto-forms.test.ts',
            'tests/unit/pages/knowledge-map.test.ts',
            'tests/unit/pages/member-permissions-dom.test.ts',
            'tests/unit/pages/home-new-and-empty.test.ts',
          ],
          environment: 'happy-dom',
        },
      },
    ],
  },
});
