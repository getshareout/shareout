#!/usr/bin/env node
/**
 * Stages editor-client/dist/editor.js as a Workers Static Asset
 * (public/_bundles/editor.js) so it is served out of the worker script bundle
 * (plan §19 Phase 4). Run after: npm run build --prefix editor-client
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'editor-client/dist/editor.js');
const destDir = join(root, 'public/_bundles');
const dest = join(destDir, 'editor.js');

let code;
try {
  code = readFileSync(src, 'utf8');
} catch {
  console.error(`Missing ${src}. Run: npm run build --prefix editor-client`);
  process.exit(1);
}

mkdirSync(destDir, { recursive: true });
writeFileSync(dest, code);
console.log(`Staged public/_bundles/editor.js (${code.length} bytes)`);
