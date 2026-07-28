#!/usr/bin/env node
/**
 * Validate the browser JS embedded in server-rendered TS template literals.
 * tsc only checks the OUTER template literal, never the inner JS — so a missing
 * brace in inline code ships as a runtime "Unexpected end of input". This extracts
 * each tagged inline script and runs it through Node's parser (vm.compileFunction),
 * with ${...} interpolations replaced by a neutral placeholder.
 *
 * Targets: every `const <name> = ` + backtick template assigned to a *Script*-ish
 * var, plus explicit known scripts. We keep it simple: scan each target file for
 * template literals and check the ones that look like JS (contain `function ` or
 * `window.` or `var `).
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const TARGETS = [
  { file: 'src/pages/home/client-script/index.ts', marker: 'return preamble' },
  // Toolbar client scripts (HTML wrappers live in toolbar/script.ts and bridge-script.ts)
  { file: 'src/serve/sandbox-viewer/toolbar/script-core.ts', marker: null },
  { file: 'src/serve/sandbox-viewer/toolbar/script-auth.ts', marker: null },
  { file: 'src/serve/sandbox-viewer/toolbar/script-comments.ts', marker: null },
  { file: 'src/serve/sandbox-viewer/toolbar/script-admin.ts', marker: null },
];

// Skip a JS string starting at quote char q (s[i] === q). Returns index after close.
function skipString(s, i, q) {
  i++;
  while (i < s.length) {
    if (s[i] === '\\') { i += 2; continue; }
    if (s[i] === q) return i + 1;
    i++;
  }
  return i;
}
// Skip a ${...} interpolation. s[i] is first char after `${`. Returns index after `}`.
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
// Skip a nested template literal. s[i] === '`'. Returns index after closing backtick.
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

// Extract the literal text of the template starting right after an opening backtick
// at index `start`, with ${...} replaced by ' 0 '. Returns { text, end }.
function extractTemplate(s, start) {
  let i = start;
  let out = '';
  while (i < s.length) {
    const c = s[i];
    if (c === '\\') { out += c + (s[i + 1] ?? ''); i += 2; continue; }
    if (c === '`') return { text: out, end: i + 1 };
    if (c === '$' && s[i + 1] === '{') {
      i = skipInterp(s, i + 2);
      out += ' 0 ';
      continue;
    }
    out += c;
    i++;
  }
  return { text: out, end: i };
}

function check(file, marker) {
  const src = readFileSync(file, 'utf8');
  const blocks = [];
  if (marker) {
    const at = src.indexOf(marker);
    if (at < 0) throw new Error(`${file}: marker not found: ${marker}`);
    blocks.push(extractTemplate(src, at + marker.length).text);
  } else {
    // Scan every backtick-opened template that looks like inline JS.
    let i = 0;
    while (i < src.length) {
      const c = src[i];
      if (c === '`') {
        const { text, end } = extractTemplate(src, i + 1);
        if (/\b(function|window\.|addEventListener|var |document\.)\b/.test(text)) {
          blocks.push(text);
        }
        i = end;
        continue;
      }
      if (c === "'" || c === '"') { i = skipString(src, i, c); continue; }
      i++;
    }
  }

  let errors = 0;
  blocks.forEach((rawText, idx) => {
    // Resolve the template literal exactly as V8 would (\\ -> \, \` -> `, \u… ->
    // char, etc.) so the checked JS matches what the browser actually receives.
    // ${...} were already replaced with the literal text ` 0 `.
    let js;
    try {
      js = eval('`' + rawText + '`');
    } catch (e) {
      errors++;
      console.error(`\n✗ ${file} (inline block ${idx}): template did not evaluate: ${e.message}`);
      return;
    }
    try {
      vm.compileFunction(js, [], { filename: `${file}#inline${idx}` });
    } catch (e) {
      errors++;
      console.error(`\n✗ ${file} (inline block ${idx}): ${e.message}`);
      // Surface the offending region: print a few lines around any line number.
      const m = /<anonymous>:(\d+)/.exec(e.stack || '') || /:(\d+):\d+/.exec(e.stack || '');
      if (m) {
        const ln = Number(m[1]);
        const lines = js.split('\n');
        for (let l = Math.max(0, ln - 3); l < Math.min(lines.length, ln + 2); l++) {
          console.error(`  ${l + 1}: ${lines[l]}`);
        }
      }
    }
  });
  return errors;
}

let total = 0;
for (const t of TARGETS) {
  total += check(t.file, t.marker);
}
if (total > 0) {
  console.error(`\n${total} inline-script syntax error(s).`);
  process.exit(1);
}
console.log('Inline browser scripts parse OK.');
