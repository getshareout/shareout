#!/usr/bin/env node
// Fails if a staged static-asset bundle grows past its budget. Pairs with
// check-stale-bundles.mjs (freshness) — this one guards size regressions.
// Bump a budget only when the growth is intentional.
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const KB = 1024;
const BUDGETS = {
  'public/_bundles/editor.js': 640 * KB,
  'public/_bundles/shareout-sdk.js': 256 * KB,
  'public/_bundles/shareout-comments-agent.js': 32 * KB,
  'public/_bundles/chat-core.js': 16 * KB,
  'public/_bundles/shareout-mobile.js': 32 * KB,
};

let failed = false;
for (const [rel, max] of Object.entries(BUDGETS)) {
  let size;
  try {
    size = statSync(join(root, rel)).size;
  } catch {
    console.error(`MISS  ${rel} not found — was it staged? (npm run build:editor / build:sdk)`);
    failed = true;
    continue;
  }
  const pct = Math.round((size / max) * 100);
  const ok = size <= max;
  if (!ok) failed = true;
  console.log(
    `${ok ? 'ok  ' : 'OVER'} ${rel}  ${(size / KB).toFixed(1)}KB / ${(max / KB).toFixed(0)}KB budget (${pct}%)`
  );
}

if (failed) {
  console.error('\nBundle size budget exceeded. If the growth is intentional, raise the budget in scripts/check-bundle-size.mjs.');
  process.exit(1);
}
console.log('\nAll bundles within budget.');
