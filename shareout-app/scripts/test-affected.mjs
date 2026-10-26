#!/usr/bin/env node
// Run only the unit tests affected by this branch's changes.
//
// The full suite is ~770 files (767 on 2026-10-25) and takes minutes: ~4m40s at 466
// files, ~3m at 550 after #99 cut per-file module imports. A small PR reaches a handful
// of those files, so this maps changed files to tests through vitest's module graph
// (`vitest related`) and runs just those.
//
// Workspaces (sdk/, editor-client/, chat-core/) have their own vitest suites. A change
// inside one runs that workspace's whole suite (each takes a few seconds), and its paths
// also go to `vitest related`, because root tests import workspace sources directly.
// SHAREOUT_AFFECTED_WORKSPACES=0 skips the workspace suites (ci-check-fast.sh runs them
// all as separate jobs).
//
// tests/worker-main.ts is the workers pool's `main`: it is loaded into every file that
// imports `cloudflare:test`, but never through the module graph, so a change to it
// selects those files explicitly.
//
// Falls back to the whole suite when a change can plausibly affect everything
// (config, lockfile, test setup). Force it with --full or SHAREOUT_FULL_TESTS=1.
//
// Base ref: SHAREOUT_TEST_BASE (default origin/main).
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const APP_DIR = path.resolve(import.meta.dirname, '..');
const BASE = process.env.SHAREOUT_TEST_BASE || 'origin/main';
const passthrough = process.argv.slice(2).filter((a) => a !== '--full');
const forceFull = process.argv.includes('--full') || process.env.SHAREOUT_FULL_TESTS === '1';
const runWorkspaces = process.env.SHAREOUT_AFFECTED_WORKSPACES !== '0';

// Changing any of these invalidates the module-graph mapping itself.
const FULL_SUITE_TRIGGERS = [
  'package.json',
  'package-lock.json',
  'vitest.config.ts',
  'vitest.unit.config.ts',
  'tsconfig.json',
  'wrangler.test.toml',
];

const WORKSPACES = ['sdk', 'editor-client', 'chat-core'];
const WORKER_MAIN = 'tests/worker-main.ts';
const CODE = /\.(ts|tsx|mts|js|mjs)$/;
const GRAPH_ROOTS = ['src/', 'tests/unit/', 'shared/', 'packages/', ...WORKSPACES.map((w) => `${w}/`)];

function git(...args) {
  const r = spawnSync('git', args, { cwd: APP_DIR, encoding: 'utf8' });
  return r.status === 0 ? r.stdout : '';
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, {
    cwd: APP_DIR,
    stdio: 'inherit',
    env: { ...process.env, TZ: process.env.TZ || 'UTC' },
  });
  return r.status ?? 1;
}

function runFullAndExit(reason) {
  console.log(`==> Full unit suite (${reason})`);
  process.exit(run('npx', ['vitest', 'run', '--maxWorkers=8', ...passthrough]));
}

function cloudflareTestFiles(dir = 'tests/unit') {
  const out = [];
  for (const e of readdirSync(path.join(APP_DIR, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...cloudflareTestFiles(rel));
    else if (rel.endsWith('.test.ts') && /['"]cloudflare:test['"]/.test(readFileSync(path.join(APP_DIR, rel), 'utf8'))) {
      out.push(rel);
    }
  }
  return out;
}

if (forceFull) runFullAndExit('forced');

// Nothing to compare against (shallow clone, detached CI) — do not silently run less.
const mergeBase = git('merge-base', BASE, 'HEAD').trim();
if (!mergeBase) runFullAndExit(`no merge-base with ${BASE}`);

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
if (trigger) runFullAndExit(`${trigger} changed`);

// Only files vitest can resolve in the graph, and only ones that still exist.
const candidates = appFiles
  .filter((f) => CODE.test(f))
  .filter((f) => GRAPH_ROOTS.some((root) => f.startsWith(root)))
  .filter((f) => existsSync(path.join(APP_DIR, f)));

const extra = [];
if (appFiles.includes(WORKER_MAIN)) {
  const files = cloudflareTestFiles();
  console.log(`==> ${WORKER_MAIN} changed: selecting all ${files.length} cloudflare:test files`);
  extra.push(...files.filter((f) => !candidates.includes(f)));
}

const touchedWorkspaces = WORKSPACES.filter((w) =>
  appFiles.some((f) => f.startsWith(`${w}/`) && !f.endsWith('.md'))
);

let status = 0;
if (candidates.length + extra.length === 0) {
  console.log(`==> No changes under ${GRAPH_ROOTS.join(', ')} vs ${BASE} — skipping root unit tests`);
} else {
  const plus = extra.length ? ` + ${extra.length} cloudflare:test file(s)` : '';
  console.log(`==> Affected unit tests (${candidates.length} changed file(s) vs ${BASE}${plus})`);
  for (const f of candidates) console.log(`    ${f}`);
  status = run('npx', [
    'vitest', 'related', '--run', '--passWithNoTests', '--maxWorkers=8',
    ...passthrough, ...candidates, ...extra,
  ]);
}

if (touchedWorkspaces.length && !runWorkspaces) {
  console.log(`==> Workspace suites skipped (SHAREOUT_AFFECTED_WORKSPACES=0): ${touchedWorkspaces.join(', ')}`);
} else {
  for (const w of touchedWorkspaces) {
    console.log(`==> Workspace suite: @shareout/${w}`);
    const s = run('npm', ['test', '--workspace', `@shareout/${w}`, '--', ...passthrough]);
    if (s !== 0) status = s;
  }
}
process.exit(status);
