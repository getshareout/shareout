#!/usr/bin/env node
// Design-token drift guard (plan §12). Asserts the spacing scale documented in
// Design/system/tokens.md matches the @shareout/design-tokens package.
//
// Scoped to the spacing scale deliberately: it is the canonical, parseable family
// and is currently in sync. Other families (shadows, durations) presently differ
// between the docs and code; reconciling those is a design decision, not a lint, so
// they are out of scope until a canonical source is chosen.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(fileURLToPath(import.meta.url), '..', '..', '..');
const tokensMd = join(repoRoot, 'Design', 'system', 'tokens.md');
const tokensTs = join(repoRoot, 'shareout-app', 'packages', 'design-tokens', 'src', 'index.ts');

// Docs: rows like  | `--space-4` | 16px | ... |
const docSpacing = new Map();
for (const m of readFileSync(tokensMd, 'utf8').matchAll(/`--space-(\d+)`\s*\|\s*(\d+px)/g)) {
  docSpacing.set(m[1], m[2]);
}

// Code: the `export const spacing = { ... } as const;` block, entries like  4: '16px',
const block = readFileSync(tokensTs, 'utf8').match(/export const spacing = \{([\s\S]*?)\}\s*as const;/);
if (!block) {
  console.error('✗ could not find `spacing` in @shareout/design-tokens');
  process.exit(1);
}
const codeSpacing = new Map();
for (const m of block[1].matchAll(/(\d+):\s*'([^']+)'/g)) {
  codeSpacing.set(m[1], m[2]);
}

if (docSpacing.size === 0) {
  console.error('✗ no `--space-N` rows parsed from Design/system/tokens.md');
  process.exit(1);
}

let drift = 0;
for (const [key, docVal] of docSpacing) {
  const codeVal = codeSpacing.get(key);
  if (codeVal !== docVal) {
    drift++;
    console.error(`✗ spacing --space-${key}: docs=${docVal} code=${codeVal ?? '(missing)'}`);
  }
}

if (drift > 0) {
  console.error(`\n${drift} spacing token(s) drift between Design/system/tokens.md and @shareout/design-tokens.`);
  process.exit(1);
}
console.log(`✓ design-token spacing scale in sync (${docSpacing.size} values)`);
