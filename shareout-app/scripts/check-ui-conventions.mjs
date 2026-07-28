#!/usr/bin/env node
/**
 * Guard the UI-centralization invariants in client-side inline scripts.
 * After centralizing primitives into src/design-system/components/, browser
 * code should emit shared `.so-c-*` class names, not rebuild buttons/modals with
 * hardcoded hex colors or duplicated inline style strings.
 *
 * Two checks, scoped to the inline-script TARGETS below:
 *   A) the duplicated-modal smell: `var card/lbl/inp = '<style string>'`
 *   B) hardcoded hex in an inline CSS context: `background|color|border|box-shadow: #hex`
 *      (object literals like color:'#fff' and SVG fill/stroke are NOT flagged —
 *       those are data, not chrome; use design tokens / CSS vars for chrome).
 *
 * Escape hatch: put `// ui-allow-hex: <reason>` anywhere in a file to allow it.
 * Tokens interpolated via ${...} are invisible to this checker (they become a
 * neutral placeholder), so token-based inline styles pass.
 */
import { readFileSync } from 'node:fs';

const TARGETS = [
  'src/serve/sandbox-viewer/toolbar/script-auth.ts',
  'src/serve/sandbox-viewer/toolbar/script-admin.ts',
  'src/serve/sandbox-viewer/toolbar/script-comments.ts',
  'src/serve/sandbox-viewer/toolbar/script-core.ts',
  'src/pages/home/client-script/artifacts.ts',
  'src/pages/home/client-script/workspace-admin.ts',
  'src/pages/home/client-script/events.ts',
  'src/components/share-modal.ts',
];

// ${...} -> ' 0 ' so token interpolations never look like hex. Mirrors the
// extractor in check-inline-scripts.mjs.
function skipString(s, i, q) {
  i++;
  while (i < s.length) {
    if (s[i] === '\\') { i += 2; continue; }
    if (s[i] === q) return i + 1;
    i++;
  }
  return i;
}
function skipInterp(s, i) {
  let depth = 1;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\') { i += 2; continue; }
    if (c === "'" || c === '"') { i = skipString(s, i, c); continue; }
    if (c === '`') { i = skipTemplate(s, i); continue; }
    if (c === '{') { depth++; i++; continue; }
    if (c === '}') { depth--; i++; if (depth === 0) return i; continue; }
    i++;
  }
  return i;
}
function skipTemplate(s, i) {
  i++;
  while (i < s.length) {
    if (s[i] === '\\') { i += 2; continue; }
    if (s[i] === '`') return i + 1;
    if (s[i] === '$' && s[i + 1] === '{') { i = skipInterp(s, i + 2); continue; }
    i++;
  }
  return i;
}
function stripInterps(src) {
  let i = 0, out = '';
  while (i < src.length) {
    if (src[i] === '`') {
      // walk the template, replacing ${...} with ' 0 '
      out += '`'; i++;
      while (i < src.length && src[i] !== '`') {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] ?? ''); i += 2; continue; }
        if (src[i] === '$' && src[i + 1] === '{') { i = skipInterp(src, i + 2); out += ' 0 '; continue; }
        out += src[i]; i++;
      }
      if (i < src.length) { out += '`'; i++; }
      continue;
    }
    out += src[i]; i++;
  }
  return out;
}

const SMELL = /\bvar\s+(card|lbl|inp)\s*=\s*['"][^'"]*(?:background|border|color|box-shadow|padding)\s*:/;
const HEX = /(?:background|color|border|box-shadow)\s*:\s*#[0-9a-fA-F]{3,8}\b/;

let total = 0;
for (const file of TARGETS) {
  let src;
  try { src = readFileSync(file, 'utf8'); } catch { continue; }
  if (src.includes('ui-allow-hex')) continue;
  const text = stripInterps(src);
  text.split('\n').forEach((line, idx) => {
    if (SMELL.test(line)) {
      total++;
      console.error(`\n✗ ${file}:${idx + 1}: duplicated inline style-string (use .so-c-* classes from design-system/components)\n  ${line.trim().slice(0, 120)}`);
    }
    if (HEX.test(line)) {
      total++;
      console.error(`\n✗ ${file}:${idx + 1}: hardcoded hex in inline style (use a design token / CSS var)\n  ${line.trim().slice(0, 120)}`);
    }
  });
}

if (total > 0) {
  console.error(`\n${total} UI-convention violation(s). Use shared components (src/design-system/components) or add '// ui-allow-hex: <reason>'.`);
  process.exit(1);
}
console.log('UI conventions OK.');
