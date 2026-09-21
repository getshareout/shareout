#!/usr/bin/env node
// Run only the unit tests affected by this branch's changes.
//
// The full suite is 466 files / ~4m40s, of which ~34s is actual assertions — the rest
// is re-importing the module graph once per test file. For a small PR that is pure
// waste, so this maps changed files to tests through vitest's module graph
// (`vitest related`) and runs just those.
//
// Falls back to the whole suite when a change can plausibly affect everything
// (config, lockfile, test setup). Force it with --full or SHAREOUT_FULL_TESTS=1.
//
// Base ref: SHAREOUT_TEST_BASE (default origin/main).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const APP_DIR = path.resolve(import.meta.dirname, '..');
const BASE = process.env.SHAREOUT_TEST_BASE || 'origin/main';
const passthrough = process.argv.slice(2).filter((a) => a !== '--full');
const forceFull = process.argv.includes('--full') || process.env.SHAREOUT_FULL_TESTS === '1';

// Changing any of these invalidates the module-graph mapping itself.
const FULL_SUITE_TRIGGERS = [
  'package.json',
  'package-lock.json',
  'vitest.config.ts',
  'vitest.unit.config.ts',
  'tsconfig.json',
  'wrangler.test.toml',
];

function git(...args) {
  const r = spawnSync('git', args, { cwd: APP_DIR, encoding: 'utf8' });
  return r.status === 0 ? r.stdout : '';
}

function runVitest(args) {
  const r = spawnSync('npx', ['vitest', ...args], {
    cwd: APP_DIR,
    stdio: 'inherit',
    env: { ...process.env, TZ: process.env.TZ || 'UTC' },
  });
  process.exit(r.status ?? 1);
}

if (forceFull) {
  console.log('==> Full unit suite (forced)');
  runVitest(['run', '--maxWorkers=8', ...passthrough]);
}

// Nothing to compare against (shallow clone, detached CI) — do not silently run less.
const mergeBase = git('merge-base', BASE, 'HEAD').trim();
if (!mergeBase) {
  console.log(`==> Full unit suite (no merge-base with ${BASE})`);
  runVitest(['run', '--maxWorkers=8', ...passthrough]);
}

const prefix = git('rev-parse', '--show-prefix').trim(); // e.g. "shareout-app/"
const changed = new Set(
  [
    git('diff', '--name-only', mergeBase, 'HEAD'),
    git('diff', '--name-only', 'HEAD'),
    git('diff', '--name-only', '--cached'),
    git('ls-files', '--others', '--exclude-standard'),
  ]
    .join('\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
);

// Paths come back repo-relative; keep the ones inside shareout-app and strip the prefix.
const appFiles = [...changed]
  .filter((f) => !prefix || f.startsWith(prefix))
  .map((f) => (prefix ? f.slice(prefix.length) : f));

const trigger = appFiles.find((f) => FULL_SUITE_TRIGGERS.includes(f));
if (trigger) {
  console.log(`==> Full unit suite (${trigger} changed)`);
  runVitest(['run', '--maxWorkers=8', ...passthrough]);
}

// Only files vitest can resolve in the graph, and only ones that still exist.
const candidates = appFiles
  .filter((f) => /\.(ts|tsx|mts|js|mjs)$/.test(f))
  .filter((f) => f.startsWith('src/') || f.startsWith('tests/unit/'))
  .filter((f) => existsSync(path.join(APP_DIR, f)));

if (candidates.length === 0) {
  console.log(`==> No src/ or tests/unit/ changes vs ${BASE} — skipping unit tests`);
  process.exit(0);
}

console.log(`==> Affected unit tests (${candidates.length} changed file(s) vs ${BASE})`);
for (const f of candidates) console.log(`    ${f}`);
runVitest(['related', '--run', '--maxWorkers=8', ...passthrough, ...candidates]);
