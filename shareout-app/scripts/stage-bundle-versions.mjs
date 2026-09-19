#!/usr/bin/env node
/**
 * Writes public/_bundles/versions.json: a short content hash per first-party bundle,
 * keyed by the path it is served at. The worker emits `<path>?v=<hash>` for these and
 * serves a matching hash as immutable. Run after any bundle build (the build:* npm
 * scripts and check:bundles do).
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '../public/_bundles');

const BUNDLES = {
  '/sdk/shareout.js': 'shareout-sdk.js',
  '/sdk/comments-agent.js': 'shareout-comments-agent.js',
  '/sdk/editor.js': 'editor.js',
  '/sdk/chat-core.js': 'chat-core.js',
};

const versions = Object.fromEntries(
  Object.entries(BUNDLES).map(([path, file]) => [
    path,
    createHash('sha256').update(readFileSync(join(dir, file))).digest('hex').slice(0, 12),
  ]),
);

writeFileSync(join(dir, 'versions.json'), `${JSON.stringify(versions, null, 2)}\n`);
console.log('Staged public/_bundles/versions.json');
