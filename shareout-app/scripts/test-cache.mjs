// A test file's result is reused while every module it loaded is byte-identical to the
// run where it last passed. So any gate re-runs only the test files a change reaches.
//
// A file's key is a hash of: its recorded dependencies (what it imported at runtime — the
// pool's Durable Object entry, dynamic and ?raw/glob imports included — plus its static
// import graph, which covers files sharing an isolate) and their contents, plus a global
// key (lockfile, configs, Node, TZ, .dev.vars). npm packages are covered by the lockfile.
// Files that read the disk with fs are never cached: their inputs are invisible here.
//
// The cache lives in the git common dir, shared by every worktree of the clone, so
// integrate.sh reuses what feature worktrees already proved. Off: SHAREOUT_TEST_CACHE=0.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const APP_DIR = path.resolve(import.meta.dirname, '..');
const VERSION = 2;
const KEEP_KEYS = 8;

const GLOBAL_INPUTS = [
  'package-lock.json',
  'vitest.config.ts',
  'wrangler.test.toml',
  'tsconfig.json',
  'tests/isolation.ts',
  'scripts/test-cache.mjs',
  '.dev.vars',
];

export function cacheFile() {
  if (process.env.SHAREOUT_TEST_CACHE_FILE) return process.env.SHAREOUT_TEST_CACHE_FILE;
  const common = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: APP_DIR, encoding: 'utf8' }).trim();
  return path.resolve(APP_DIR, common, 'shareout-test-cache.json');
}

export function load() {
  try {
    const c = JSON.parse(readFileSync(cacheFile(), 'utf8'));
    if (c.v === VERSION) return c;
  } catch {}
  return { v: VERSION, paths: [], lists: {}, files: {} };
}

/**
 * Merges `entries` ({ test → { deps, key } }) into the cache on disk: read, merge, atomic rename.
 * Each passing key keeps the dependency list it was computed over (a later run can load a
 * slightly different set); identical lists are stored once.
 */
export function record(entries) {
  const c = load();
  const index = new Map(c.paths.map((p, i) => [p, i]));
  const id = (p) => {
    if (!index.has(p)) { index.set(p, c.paths.length); c.paths.push(p); }
    return index.get(p);
  };
  for (const [test, { deps, key }] of Object.entries(entries)) {
    const ids = deps.map(id).sort((a, b) => a - b);
    const list = createHash('sha1').update(ids.join(',')).digest('hex').slice(0, 16);
    c.lists[list] = ids;
    const prev = (c.files[test] ?? []).filter((e) => e.k !== key);
    c.files[test] = [{ l: list, k: key }, ...prev].slice(0, KEEP_KEYS);
  }
  const used = new Set(Object.values(c.files).flatMap((es) => es.map((e) => e.l)));
  for (const l of Object.keys(c.lists)) if (!used.has(l)) delete c.lists[l];
  const file = cacheFile();
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(c));
  renameSync(tmp, file);
}

// Served through the ASSETS binding, not imported: a dependency of tests that fetch through the worker.
export const ASSETS_DIR = 'public/';

const hashes = new Map();
function contentHash(rel) {
  if (!hashes.has(rel)) {
    const abs = path.join(APP_DIR, rel);
    let h = 'missing';
    if (rel.endsWith('/') && existsSync(abs)) {
      const d = createHash('sha1');
      for (const f of (readdirSync(abs, { recursive: true })).sort()) {
        const p = path.join(abs, f);
        if (statSync(p).isFile()) d.update(f).update(readFileSync(p));
      }
      h = d.digest('hex');
    } else if (existsSync(abs) && statSync(abs).isFile()) {
      h = createHash('sha1').update(readFileSync(abs)).digest('hex');
    }
    hashes.set(rel, h);
  }
  return hashes.get(rel);
}

let globalKey;
export function getGlobalKey() {
  globalKey ??= createHash('sha1')
    .update(JSON.stringify([VERSION, process.version, process.env.TZ || 'UTC', GLOBAL_INPUTS.map(contentHash)]))
    .digest('hex');
  return globalKey;
}

/** The key of `test` over `deps` as they are on disk now. */
export function keyFor(test, deps) {
  const h = createHash('sha1').update(getGlobalKey()).update(test).update(contentHash(test));
  for (const d of [...deps].sort()) h.update(d).update(contentHash(d));
  return h.digest('hex');
}

/** True when one of `test`'s passing runs had exactly the inputs on disk now. */
export function isGreen(c, test) {
  return (c.files[test] ?? []).some((e) => e.k === keyFor(test, c.lists[e.l].map((i) => c.paths[i])));
}

/** A module id from vitest (absolute, maybe ?query) → app-relative path, or null for npm/virtual ids. */
export function toRel(id) {
  const clean = id.split('?')[0];
  if (!path.isAbsolute(clean) || clean.includes('/node_modules/')) return null;
  return path.relative(APP_DIR, clean).split(path.sep).join('/');
}

export const READS_DISK = /from ['"](?:node:)?fs(?:\/promises)?['"]|\b(?:readFileSync|readdirSync|statSync|existsSync)\(/;

export function listTests() {
  return readdirSync(path.join(APP_DIR, 'tests/unit'), { recursive: true })
    .filter((f) => f.endsWith('.test.ts'))
    .map((f) => `tests/unit/${f.split(path.sep).join('/')}`)
    .sort();
}

// Static graph: import/export-from, side-effect imports, literal dynamic imports and vi.mock
// paths (relative only; npm packages are in the global key). Type-only imports are skipped.
const STATIC = /^[ \t]*(?:import|export)[ \t]+(?!type\b)([^;'"]*?)[ \t\n]*from[ \t]*['"](\.[^'"]+)['"]|^[ \t]*import[ \t]*['"](\.[^'"]+)['"]|\bimport\(\s*['"](\.[^'"]+)['"]\s*\)|\bvi\.(?:mock|doMock)\(\s*['"](\.[^'"]+)['"]/gm;
const edges = new Map();
function resolveLocal(fromRel, spec) {
  const base = path.join(path.dirname(path.join(APP_DIR, fromRel)), spec.split('?')[0]);
  for (const c of [base, `${base}.ts`, base.replace(/\.js$/, '.ts'), path.join(base, 'index.ts')]) {
    if (existsSync(c) && statSync(c).isFile()) return path.relative(APP_DIR, c).split(path.sep).join('/');
  }
  return null;
}
function staticDeps(rel) {
  if (edges.has(rel)) return edges.get(rel);
  const out = [];
  edges.set(rel, out);
  if (!/\.(ts|mts|js|mjs)$/.test(rel) || !existsSync(path.join(APP_DIR, rel))) return out;
  for (const m of readFileSync(path.join(APP_DIR, rel), 'utf8').matchAll(STATIC)) {
    const clause = m[1];
    if (clause && /^\{[^}]*\}$/s.test(clause.trim()) && clause.replace(/[{}\s]/g, '').split(',').filter(Boolean).every((s) => s.startsWith('type'))) continue;
    const r = resolveLocal(rel, m[2] || m[3] || m[4] || m[5]);
    if (r) out.push(r);
  }
  return out;
}
export function staticClosure(test) {
  const seen = new Set([test]);
  const stack = [test];
  while (stack.length) for (const d of staticDeps(stack.pop())) if (!seen.has(d)) { seen.add(d); stack.push(d); }
  seen.delete(test);
  return seen;
}
