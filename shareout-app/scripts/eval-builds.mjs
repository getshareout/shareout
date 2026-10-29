#!/usr/bin/env node
// Page-build eval: runs a versioned set of build requests against a live instance through
// its public API and scores the pages. Not part of `npm test` and never run by CI: each item
// is a real build on the instance's AI budget. Details: evals/page-build/README.md
//
//   npm run eval:builds -- --origin https://… --workspace wsp_… --token-env SHAREOUT_TOKEN [--only a,b] [--repeat 2] [--cleanup]
//   npm run eval:builds -- compare evals/results/a.json evals/results/b.json
//   npm run eval:builds -- list
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';

const APP_DIR = path.resolve(import.meta.dirname, '..');
// Outside the checkout: the bundle inlines acorn, whose tables trip the repo's customer-name scan.
const bundle = path.join(mkdtempSync(path.join(tmpdir(), 'eval-builds-')), 'cli.mjs');

// The scorers reuse src/build-agent's static check, so bundle it with the CLI. Some worker
// modules it reaches import `cloudflare:workers`; nothing the static check calls needs it,
// so it resolves to an empty stub that fails loudly if it is ever used.
const workersStub = {
  name: 'cloudflare-workers-stub',
  setup(b) {
    b.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: 'cloudflare:workers', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: "const no = () => { throw new Error('cloudflare:workers is not available in the eval CLI'); };\nexport const waitUntil = no; export const env = {}; export class DurableObject {}; export class WorkerEntrypoint {}; export class RpcTarget {};",
      loader: 'js',
    }));
  },
};

await build({
  entryPoints: [path.join(APP_DIR, 'evals/page-build/cli.ts')],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  plugins: [workersStub],
  logLevel: 'warning',
});

const run = spawnSync(process.execPath, [bundle, ...process.argv.slice(2)], { stdio: 'inherit', cwd: APP_DIR });
process.exit(run.status ?? 1);
