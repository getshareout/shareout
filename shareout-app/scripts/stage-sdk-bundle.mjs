#!/usr/bin/env node
/**
 * Builds sdk/ and stages dist/index.global.js (with the global-unwrap fix appended)
 * as a Workers Static Asset at public/_bundles/shareout-sdk.js, so it is served out
 * of the worker script bundle (plan §19 Phase 4).
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

const destDir = join(root, 'public/_bundles');
mkdirSync(destDir, { recursive: true });
writeFileSync(join(destDir, 'shareout-sdk.js'), bundle + footer);
console.log('Staged public/_bundles/shareout-sdk.js', ((bundle.length + footer.length) / 1024).toFixed(1), 'KB');
