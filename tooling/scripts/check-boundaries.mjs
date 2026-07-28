#!/usr/bin/env node
// Import/zone boundary checks — architecture_plan_optimized.md §18.
// Fails (exit 1) when product source crosses a boundary it must not cross.
// Generated/embedded-bundle files are excluded: generated code is not reviewed like source.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(fileURLToPath(import.meta.url), '..', '..', '..');
const worker = join(repoRoot, 'shareout-app');

const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', '.wrangler', '.git',
  'coverage', 'test-results', 'playwright-report',
]);
const GENERATED = [/\.generated\.ts$/, /(^|\/)sdk-serve\.ts$/, /(^|\/)editor-serve\.ts$/];

// Known customers that must never reappear in platform source. Grows as customers
// are onboarded into the content zone (customers/), keeping their code out of src/.
const CUSTOMER_IDENTIFIERS = [/\btatt\b/i];

function walk(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(join(dir, e.name), acc);
    } else if (/\.(ts|tsx|mjs|js)$/.test(e.name)) {
      acc.push(join(dir, e.name));
    }
  }
  return acc;
}

const isGenerated = (rel) => GENERATED.some((r) => r.test(rel));

const rules = [
  {
    id: 'no-customer-code-in-product-source',
    desc: 'Worker product source must not contain customer-specific code (move it to customers/).',
    root: join(worker, 'src'),
    check(text) {
      const hits = [];
      for (const re of CUSTOMER_IDENTIFIERS) {
        const m = text.match(re);
        if (m) hits.push(`customer identifier "${m[0]}"`);
      }
      if (/from\s+['"][^'"]*\bcustomers\//.test(text)) hits.push('imports the customers/ content zone');
      return hits;
    },
  },
  {
    id: 'no-content-as-code',
    desc: 'Worker product source must not import demo/example content as code (serve it as artifacts/assets).',
    root: join(worker, 'src'),
    check(text) {
      return /from\s+['"][^'"]*\b(demos|examples)\//.test(text) ? ['imports demo/example content as code'] : [];
    },
  },
  {
    id: 'sdk-no-worker-imports',
    desc: 'SDK must not import Worker internals (router, serve, auth, data).',
    root: join(worker, 'sdk', 'src'),
    check(text) {
      return /from\s+['"](\.\.\/)+src\//.test(text) ? ['imports worker src/'] : [];
    },
  },
  {
    id: 'editor-client-no-worker-imports',
    desc: 'Editor client must not import Worker-only modules.',
    root: join(worker, 'editor-client', 'src'),
    check(text) {
      return /from\s+['"](\.\.\/)+src\//.test(text) ? ['imports worker src/'] : [];
    },
  },
];

let violations = 0;
for (const rule of rules) {
  for (const file of walk(rule.root)) {
    const rel = relative(repoRoot, file);
    if (isGenerated(rel)) continue;
    const hits = rule.check(readFileSync(file, 'utf8'));
    for (const hit of hits) {
      violations++;
      console.error(`✗ [${rule.id}] ${rel}: ${hit}`);
    }
  }
}

if (violations > 0) {
  console.error(`\n${violations} boundary violation(s). See architecture_plan_optimized.md §18.`);
  process.exit(1);
}
console.log('✓ boundary checks passed');
