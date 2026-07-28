#!/usr/bin/env node
/**
 * Guard: no customer names in the open-source product.
 *
 * This exists because a whole customer pipeline shipped in the repo — a group-moderation
 * job with its own Durable Object, a delivery destination whose validation error named an
 * external service, and docs in two languages. The feature inventory described it as a
 * "pipeline definition language", which is how it survived a row-by-row review.
 *
 * The first version of this guard reported "clean" on a repo with 175 live hits, for two
 * reasons that are the whole point of the rewrite:
 *
 *   1. It matched `\b(name)\b`. Word boundaries do not fire on the forms customer names
 *      actually take in code: `<name>_snowflake`, `svc_<name>`, `wsp_<name>`,
 *      `<name>solutions.co`, `<name>Artifact`. `_` is a word character, so `\bfoo\b`
 *      never matches `foo_bar`. Match substrings, case-insensitively.
 *
 *   2. It scanned an allowlist of four directories. The hits were in `sdk/`, `scripts/`,
 *      `examples/`, `shared/`, `docs/` and `Design/`. A tree that is not on a list nobody
 *      remembered to update is a tree nobody checks. Walk the repo; skip only build output.
 *
 * Usage: node tooling/scripts/check-customer-names.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(fileURLToPath(import.meta.url), '..', '..', '..');

/** Build output and vendored code — everything else is scanned. */
const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'dist', '.astro', 'coverage', '.wrangler', '_bundles',
]);
const SKIP_FILES = new Set(['package-lock.json', 'check-customer-names.mjs']);
const TEXT = /\.(ts|tsx|js|mjs|cjs|json|md|mdx|yaml|yml|html|css|toml|txt|sql|sh)$/;

/**
 * The blocklist is NOT stored in this repo, because the list of customer names is itself
 * the confidential thing this script exists to keep out. A public file enumerating every
 * client is the leak, not the guard.
 *
 * Supply it out-of-band, first match wins:
 *   1. `CUSTOMER_NAMES` env var — comma-separated. CI sets this from a repository secret.
 *   2. `tooling/customer-names.local` — one entry per line, `#` comments. Gitignored.
 *
 * Entries are regex source, matched case-insensitively, and match as SUBSTRINGS — that is
 * what catches `<name>_snowflake`, `svc_<name>`, `<name>solutions.co` and `<name>Artifact`,
 * every one of which a `\b` guard silently misses.
 *
 * A name that is also an English fragment needs a letter guard instead: a certain
 * four-letter client name as a plain substring matches `setAttribute` several hundred
 * times. Write it `(?<![a-z])name(?![a-z])` — that still matches `wsp_name` and
 * `name.example.com` (`_` and `.` are not letters) while leaving `setAttribute` alone.
 * Use that shape, not `\b`: `\b` is exactly what let `wsp_<name>` through before.
 */
function loadNames() {
  const fromEnv = (process.env.CUSTOMER_NAMES || '').split(',');
  const local = join(repo, 'tooling', 'customer-names.local');
  let fromFile = [];
  try {
    fromFile = readFileSync(local, 'utf8').split('\n').map((l) => l.replace(/#.*$/, ''));
  } catch { /* absent is fine — handled below */ }
  return [...fromEnv, ...fromFile].map((s) => s.trim()).filter(Boolean);
}

const NAMES = loadNames();
if (!NAMES.length) {
  console.error('check:customer-names — no blocklist configured.');
  console.error('Set CUSTOMER_NAMES (comma-separated) or create tooling/customer-names.local.');
  console.error('This guard cannot pass vacuously: an unconfigured check is not a clean repo.');
  process.exit(1);
}
const NEEDLE = new RegExp(`(${NAMES.join('|')})`, 'i');

/**
 * Substrings that legitimately contain one of the names above. Keep this short; an entry
 * here is a claim that the match is not a customer reference, and needs a reason.
 */
const ALLOW = [];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (TEXT.test(entry) && !SKIP_FILES.has(entry)) yield full;
  }
}

const hits = [];
for (const file of walk(repo)) {
  const rel = relative(repo, file);
  for (const [i, line] of readFileSync(file, 'utf8').split('\n').entries()) {
    if (!NEEDLE.test(line)) continue;
    if (ALLOW.some((a) => line.toLowerCase().includes(a))) continue;
    hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
  }
}

if (hits.length) {
  console.error('check:customer-names — customer references in the open-source product:\n');
  for (const h of hits) console.error(`  ${h}`);
  console.error(`\n${hits.length} hit(s). Customer-specific work does not belong in this repo.`);
  console.error('If the match is genuinely generic, add the substring to ALLOW with a reason.');
  process.exit(1);
}

console.log('✓ check:customer-names — repo clean');
