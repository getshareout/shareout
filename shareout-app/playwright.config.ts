import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  // Real-time collab specs open several browser contexts + WebSockets against a single
  // local wrangler dev; run serially so they don't contend, and retry once to absorb
  // occasional timing flakes.
  workers: 1,
  retries: 1,
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://localhost:55162',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:55162',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
