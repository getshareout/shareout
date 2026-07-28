#!/usr/bin/env node
/**
 * Builds the lazy editable-grid UI (Tabulator wrapper + ShareOut theme) and
 * stages it as Workers Static Assets at public/_bundles/grid.js and
 * public/_bundles/grid.css. Served at /sdk/grid.js + /sdk/grid.css and
 * dynamically imported by Grid.render() — kept out of the core SDK bundle so
 * non-grid artifacts download zero bytes of Tabulator. See specs/editable-grid.md.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sdkDir = join(root, 'sdk');

execSync('npm run build:grid', { cwd: sdkDir, stdio: 'inherit' });

const outDir = join(sdkDir, 'dist/grid');
const files = readdirSync(outDir);
const jsName = files.find((f) => /\.(mjs|js)$/.test(f));
const cssName = files.find((f) => f.endsWith('.css'));
if (!jsName) throw new Error('grid build produced no JS output');

const destDir = join(root, 'public/_bundles');
mkdirSync(destDir, { recursive: true });

const js = readFileSync(join(outDir, jsName), 'utf8');
writeFileSync(join(destDir, 'grid.js'), js);

let cssSize = 0;
if (cssName) {
  const css = readFileSync(join(outDir, cssName), 'utf8');
  writeFileSync(join(destDir, 'grid.css'), css);
  cssSize = css.length;
}

console.log(
  'Staged public/_bundles/grid.js',
  (js.length / 1024).toFixed(1),
  'KB + grid.css',
  (cssSize / 1024).toFixed(1),
  'KB'
);
