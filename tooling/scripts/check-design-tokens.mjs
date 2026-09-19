#!/usr/bin/env node
// Design-token drift guard (plan §12). Asserts the spacing scale documented in
// Design/system/tokens.md matches the @shareout/design-tokens package, and flags
// hardcoded feedback-palette hex in server-rendered page styles when a matching
// CSS custom property already exists.
import { readFileSync, readdirSync, statSync } from 'node:fs';
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

// Feedback colors: flag literal hex in page CSS when base.css already exposes --color-*.
const colorBlock = readFileSync(tokensTs, 'utf8').match(/export const colors = \{([\s\S]*?)\}\s*as const;/);
const tokenColors = new Map();
if (colorBlock) {
  for (const m of colorBlock[1].matchAll(/(\w+):\s*'(#[0-9a-fA-F]{3,8})'/g)) {
    tokenColors.set(m[2].toLowerCase(), m[1]);
  }
}
const cssVarFor = {
  success: '--color-success',
  warning: '--color-warning',
  error: '--color-error',
};
const pagesDir = join(repoRoot, 'shareout-app', 'src', 'pages');
// Pre-existing marketing/analytics pages — tracked separately from investor-facing polish.
const colorCheckSkip = new Set(['teams-preview.ts', 'slides-analytics.ts']);
let colorDrift = 0;
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !colorCheckSkip.has(name)) {
      const src = readFileSync(p, 'utf8');
      for (const m of src.matchAll(/#([0-9a-fA-F]{3,8})\b/g)) {
        const hex = `#${m[1]}`.toLowerCase();
        const key = tokenColors.get(hex);
        const cssVar = key && cssVarFor[key];
        if (cssVar) {
          colorDrift++;
          console.error(`✗ ${p.replace(repoRoot + '/', '')}: hardcoded ${hex} — use var(${cssVar})`);
        }
      }
    }
  }
}
if (tokenColors.size) walk(pagesDir);

if (colorDrift > 0) {
  console.error(`\n${colorDrift} hardcoded palette hex literal(s) in src/pages — use design-token CSS vars.`);
  process.exit(1);
}

console.log(`✓ design-token spacing scale in sync (${docSpacing.size} values)`);
if (tokenColors.size) console.log(`✓ no hardcoded feedback palette hex in src/pages`);
