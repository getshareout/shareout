#!/usr/bin/env node
/**
 * Stage skills/ShareOutSkill/ as a Workers Static Asset so `/v1/skill` works on a
 * fresh self-hosted instance with nothing in R2.
 *
 * The founder instance keeps its R2 copy (sync-skill-to-r2.mjs) for live skill
 * updates without a redeploy; src/skill.ts prefers R2 and falls back to this asset.
 * A self-hoster has no R2 sync, so this asset is the only copy they get — without
 * it `GET {ORIGIN}/v1/skill` 404s, which is exactly what the deploy docs promise
 * will work.
 *
 * Output (committed, guarded by check:bundles):
 *   public/_bundles/skill.zip   — the whole skill tree
 *   public/_bundles/skill-meta.json — name/version/updated_at/description
 *
 * Usage: node scripts/stage-skill-bundle.mjs
 */
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { zipSync } from 'fflate';

// fflate encodes each zip entry's DOS timestamp via Date's *local-timezone*
// getters (getFullYear/getHours/etc, not the UTC variants) — see fflate's
// zipSync source. A fixed epoch `mtime` therefore still produces different
// bytes in different timezones: `new Date(FIXED_MTIME).getHours()` depends on
// the process's local TZ at the moment the Date is read, not just the epoch
// value. `process.env.TZ = 'UTC'` set *after* Node has already started is not
// reliably honored by V8's Date/Intl internals on every platform — that used
// to be this script's only guard, and direct `node scripts/stage-skill-bundle.mjs`
// invocations (bypassing the npm script's `TZ=UTC` prefix) could still produce
// non-deterministic bytes for identical source, which makes check:bundles flaky.
//
// Fix: re-exec this script as a child process with TZ=UTC set *before* that
// child's Node/V8 initializes, whenever the current process isn't already
// running with TZ=UTC. This makes determinism independent of how the script
// is invoked (npm script, direct node, CI, another script's execSync, …).
if (process.env.TZ !== 'UTC') {
  execFileSync(process.execPath, [fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, TZ: 'UTC' },
  });
  process.exit(0);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = join(__dirname, '..');
const skillDir = join(appRoot, '..', 'skills', 'ShareOutSkill');
const outDir = join(appRoot, 'public', '_bundles');

// fflate stamps the current time into each zip entry by default, which would make
// every build byte-different and the staleness guard permanently red. Pin it —
// safe now that TZ=UTC is guaranteed by the re-exec guard above.
const FIXED_MTIME = Date.UTC(2020, 0, 1);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

/** Minimal `key: "value"` frontmatter reader — same shape sync-skill-to-r2.mjs uses. */
function parseFrontmatter(md) {
  const match = md.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const meta = {};
  for (const line of match[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*"?(.*?)"?\s*$/);
    if (kv) meta[kv[1]] = kv[2];
  }
  return meta;
}

const files = walk(skillDir).sort();
if (files.length === 0) {
  console.error('stage-skill-bundle: no files found under skills/ShareOutSkill');
  process.exit(1);
}

const entries = {};
for (const file of files) {
  // Zip paths are always POSIX, regardless of the host platform.
  const relPath = relative(skillDir, file).split(sep).join('/');
  entries[relPath] = [readFileSync(file), { mtime: FIXED_MTIME }];
}

const skillMd = entries['SKILL.md'];
if (!skillMd) {
  console.error('stage-skill-bundle: skills/ShareOutSkill/SKILL.md is missing');
  process.exit(1);
}

const meta = parseFrontmatter(skillMd[0].toString('utf8'));
if (!meta?.version) {
  console.error('stage-skill-bundle: SKILL.md frontmatter has no version');
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
const zip = zipSync(entries, { mtime: FIXED_MTIME });
writeFileSync(join(outDir, 'skill.zip'), zip);
writeFileSync(
  join(outDir, 'skill-meta.json'),
  JSON.stringify(
    {
      name: meta.name || 'shareout-skill',
      version: meta.version,
      updated_at: meta.updated_at || '',
      description: meta.description || '',
    },
    null,
    2
  ) + '\n'
);

console.log(
  `✓ staged skill bundle: ${files.length} files, ${(zip.length / 1024).toFixed(0)} KB (v${meta.version})`
);
