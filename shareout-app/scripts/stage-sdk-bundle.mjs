#!/usr/bin/env node
/**
 * Builds sdk/ and stages dist/index.global.js (with the global-unwrap fix appended)
 * as Workers Static Assets: public/_bundles/shareout-sdk.js, which the Worker's
 * /sdk/shareout.js route reads through ASSETS (plan §19 Phase 4), and copies at the
 * paths artifacts load — public/sdk/shareout.js and public/sdk/v1/shareout.js — which
 * the assets layer answers before the Worker runs (their headers live in public/_headers).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sdkDir = join(root, 'sdk');

execSync('npm run build', { cwd: sdkDir, stdio: 'inherit' });

const bundle = readFileSync(join(sdkDir, 'dist/index.global.js'), 'utf8');
// tsup IIFE assigns a namespace; unwrap so `new ShareOut()` works in artifacts.
const footer = `;if(typeof ShareOut==="object"&&ShareOut){var _ShareOutCtor=ShareOut.ShareOut||ShareOut.default;if(typeof _ShareOutCtor==="function")ShareOut=_ShareOutCtor;}`;

for (const rel of ['_bundles/shareout-sdk.js', 'sdk/shareout.js', 'sdk/v1/shareout.js']) {
  const dest = join(root, 'public', rel);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, bundle + footer);
}
console.log('Staged public/_bundles/shareout-sdk.js (+ public/sdk/shareout.js, public/sdk/v1/shareout.js)', ((bundle.length + footer.length) / 1024).toFixed(1), 'KB');
