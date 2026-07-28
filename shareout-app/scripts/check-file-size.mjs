#!/usr/bin/env node
// Repo-wide source-file line cap. The home-CSS split already enforces a 1000-line
// ceiling on its section modules (tests/unit/design-system/home.test.ts); this is the
// same ceiling applied to all worker source, so the NEXT file to cross 1000 lines
// trips here instead of quietly becoming the next styles.ts (which once blocked a
// deploy at 1006 lines). Over-cap files are a forcing function to split, not to bump
// the number — raise nothing here; decompose the file.
//
// ALLOWLIST holds files already over the cap when this guard landed. Each is debt to
// pay down, not a permanent exemption. When you split one below 1000, delete its line.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'src');
const MAX_LINES = 1000;

// Pre-existing offenders (relative to shareout-app/). Shrink the list, never grow it.
const ALLOWLIST = new Set(['src/data/comments.ts']);

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      yield full;
    }
  }
}

let failed = false;
const near = [];
for (const file of walk(SRC)) {
  const rel = relative(root, file);
  const lines = readFileSync(file, 'utf8').split('\n').length;
  if (lines > MAX_LINES) {
    if (ALLOWLIST.has(rel)) continue;
    console.error(`✗ ${rel}: ${lines} lines (cap ${MAX_LINES}) — split it into focused modules`);
    failed = true;
  } else if (lines > MAX_LINES - 40) {
    near.push(`${rel} (${lines})`);
  }
}

if (near.length) {
  console.log(`Approaching ${MAX_LINES}-line cap: ${near.join(', ')}`);
}

if (failed) {
  console.error(`\nFile-size cap exceeded. Do NOT raise the cap — decompose the file (see src/design-system/pages/home for the pattern).`);
  process.exit(1);
}
console.log(`File-size OK — all src/*.ts within ${MAX_LINES} lines (${ALLOWLIST.size} allowlisted).`);
