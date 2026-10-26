// The knowledge retrieval eval only — run through `npm run eval:knowledge`
// (scripts/eval-knowledge.mjs), which sets the KNOWLEDGE_EVAL_* variables. Kept apart from
// vitest.config.ts so `npm test`, test:affected and the pre-push hook never run it.
import { fileURLToPath } from 'node:url';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';
import { evalHost } from './scripts/lib/knowledge-eval-host.mjs';

const appDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.test.toml' },
      miniflare: {
        bindings: { KNOWLEDGE_EVAL_MODE: process.env.KNOWLEDGE_EVAL_MODE === 'dense' ? 'dense' : 'keyword' },
        serviceBindings: {
          KNOWLEDGE_EVAL_HOST: evalHost({
            appDir,
            out: process.env.KNOWLEDGE_EVAL_OUT || `${appDir}.eval/knowledge`,
            model: process.env.KNOWLEDGE_EVAL_MODEL || '',
            baseline: process.env.KNOWLEDGE_EVAL_BASELINE === '1',
          }),
        },
      },
    }),
  ],
  test: {
    include: ['tests/eval/knowledge/**/*.eval.ts'],
    testTimeout: 60 * 60_000,
    hookTimeout: 10 * 60_000,
  },
});
