#!/usr/bin/env node
/**
 * Bundles page-agent (alibaba's in-page GUI agent, MIT) as a self-hosted IIFE at
 * public/_bundles/page-pilot.js, served at /sdk/page-pilot.js. Mirrors the
 * chat-core / grid bundle pattern (staged Workers Static Asset, edge-cached).
 *
 * Usage: node scripts/build-page-pilot.mjs
 * npm script: build:page-pilot
 */
import { build } from 'esbuild';
import { mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const destDir = join(root, 'public/_bundles');
mkdirSync(destDir, { recursive: true });

const outfile = join(destDir, 'page-pilot.js');

await build({
  entryPoints: [join(root, 'scripts/page-pilot-entry.js')],
  bundle: true,
  format: 'iife',
  globalName: 'PagePilot',
  minify: true,
  target: 'esnext',
  platform: 'browser',
  outfile,
  // page-agent ships CSS injected via JS (no .css imports); a text loader is
  // included defensively in case a transitive dep imports a CSS file.
  loader: { '.css': 'text' },
  define: {
    'process.env.NODE_ENV': '"production"',
  },
});

const size = statSync(outfile).size;
const sizeKB = (size / 1024).toFixed(1);
console.log(`Staged public/_bundles/page-pilot.js  ${sizeKB} KB`);
if (size > 600 * 1024) {
  console.warn(`WARNING: bundle exceeds 600 KB (${sizeKB} KB)`);
}
