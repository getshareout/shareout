#!/usr/bin/env node
// Retrieval eval for workspace Knowledge: ingests a synthetic, Spanish-first corpus through
// the real ingest code into a fresh KnowledgeStore (Miniflare), asks every golden question
// through the real searchCorpus(), and reports recall / nDCG / MRR / starvation / latency.
// An on-demand gate for knowledge PRs — not part of `npm test` or the pre-push hook.
// Details: tests/eval/knowledge/README.md
//
//   npm run eval:knowledge                                  keyword only (FTS5), as the branch ships it
//   npm run eval:knowledge -- --dense                       + embeddings over the Workers AI REST API,
//                                                             with the model the code asks for
//   npm run eval:knowledge -- --model @cf/baai/bge-m3       + embeddings from another model
//   npm run eval:knowledge -- --model local-hash            dense plumbing check, offline (toy vectors)
//   npm run eval:knowledge -- --baseline                    also rewrite BASELINE.md + baseline.json
//   npm run eval:knowledge -- --check [--fixtures <dir>]    validate the corpus + golden set only
//
// Dense mode needs CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN (a token with Workers AI
// permissions); embeddings are cached under .eval/knowledge/cache, so repeat runs are free.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fixtureStats, loadFixtures } from '../tests/eval/knowledge/golden.mjs';

const APP_DIR = path.resolve(import.meta.dirname, '..');
const DEFAULT_FIXTURES = path.join(APP_DIR, 'tests/fixtures/knowledge-eval');
const KNOWN_MODELS = ['@cf/baai/bge-base-en-v1.5', '@cf/baai/bge-m3', '@cf/qwen/qwen3-embedding-0.6b', 'local-hash'];

function parseArgs(argv) {
  const opts = { check: false, dense: false, model: '', baseline: false, fixtures: DEFAULT_FIXTURES, out: path.join(APP_DIR, '.eval/knowledge') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (!v || v.startsWith('--')) fail(`${a} needs a value`);
      return v;
    };
    if (a === '--check') opts.check = true;
    else if (a === '--dense') opts.dense = true;
    else if (a === '--model') { opts.model = value(); opts.dense = true; }
    else if (a === '--baseline') opts.baseline = true;
    else if (a === '--fixtures') opts.fixtures = path.resolve(value());
    else if (a === '--out') opts.out = path.resolve(value());
    else if (a === '-h' || a === '--help') { console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 19).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(0); }
    else fail(`unknown option ${a} (see --help)`);
  }
  return opts;
}

function fail(msg) {
  console.error(`eval:knowledge — ${msg}`);
  process.exit(2);
}

function readTree(root) {
  const files = {};
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else files[path.relative(root, full).split(path.sep).join('/')] = readFileSync(full, 'utf8');
    }
  };
  walk(root);
  return files;
}

function check(fixtures) {
  const parsed = loadFixtures(readTree(fixtures));
  for (const w of parsed.warnings) console.warn(`  warn  ${w}`);
  for (const e of parsed.errors) console.error(`  error ${e}`);
  const s = fixtureStats(parsed);
  const line = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ');
  console.log(`\n${s.docs} docs (${s.privateDocs} private to another user) — ${line(s.docsBy.format)}`);
  console.log(`  lang: ${line(s.docsBy.lang)}\n  genre: ${line(s.docsBy.genre)}\n  cluster: ${line(s.docsBy.cluster)}`);
  console.log(`${s.questions} questions`);
  for (const [k, v] of Object.entries(s.questionsBy)) console.log(`  ${k}: ${line(v)}`);
  console.log(parsed.errors.length ? `\n✗ ${parsed.errors.length} error(s), ${parsed.warnings.length} warning(s)` : `\n✓ fixtures valid (${parsed.warnings.length} warning(s))`);
  return parsed.errors.length === 0;
}

const opts = parseArgs(process.argv.slice(2));
if (opts.check) process.exit(check(opts.fixtures) ? 0 : 1);
if (opts.fixtures !== DEFAULT_FIXTURES) fail('--fixtures only applies to --check (the eval imports tests/fixtures/knowledge-eval)');

if (opts.model && !KNOWN_MODELS.includes(opts.model)) {
  console.warn(`eval:knowledge — ${opts.model} is not one of ${KNOWN_MODELS.join(', ')}; sending it to Workers AI as-is`);
}
if (opts.dense && opts.model !== 'local-hash' && (!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_API_TOKEN)) {
  fail([
    'dense mode embeds with Workers AI over its REST API and needs credentials:',
    '  CLOUDFLARE_ACCOUNT_ID=<account id> CLOUDFLARE_API_TOKEN=<token with Workers AI permissions> \\',
    '    npm run eval:knowledge -- --dense [--model <id>]',
    'Without them, run keyword-only (no --dense / --model), or --model local-hash to check the dense plumbing offline.',
  ].join('\n'));
}
if (!check(opts.fixtures)) fail('fix the fixtures first');

const r = spawnSync('npx', ['vitest', 'run', '--config', 'vitest.eval.config.ts'], {
  cwd: APP_DIR,
  stdio: 'inherit',
  env: {
    ...process.env,
    TZ: process.env.TZ || 'UTC',
    KNOWLEDGE_EVAL_MODE: opts.dense ? 'dense' : 'keyword',
    KNOWLEDGE_EVAL_MODEL: opts.model,
    KNOWLEDGE_EVAL_OUT: opts.out,
    KNOWLEDGE_EVAL_BASELINE: opts.baseline ? '1' : '',
  },
});
process.exit(r.status ?? 1);
