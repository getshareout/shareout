#!/usr/bin/env node
/**
 * Builds sdk/src/mobile/ and stages dist/mobile/*.js as a Workers Static Asset at
 * public/_bundles/shareout-mobile.js. Served at /sdk/shareout-mobile.js via the
 * ASSETS binding (keeps generated JS out of the worker script bundle).
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sdkDir = join(root, 'sdk');

execSync('npm run build:mobile', { cwd: sdkDir, stdio: 'inherit' });

const outDir = join(sdkDir, 'dist/mobile');
const files = readdirSync(outDir);
const jsName = files.find((f) => /\.(mjs|js)$/.test(f));
if (!jsName) throw new Error('mobile build produced no JS output');

const bundle = readFileSync(join(outDir, jsName), 'utf8');
const header = `/**\n * ShareOut Mobile SDK\n * Provides mobile-native features for ShareOut artifacts\n * @version 1.0.0\n */\n`;

const destDir = join(root, 'public/_bundles');
mkdirSync(destDir, { recursive: true });
writeFileSync(join(destDir, 'shareout-mobile.js'), header + bundle);
console.log('Staged public/_bundles/shareout-mobile.js', ((header.length + bundle.length) / 1024).toFixed(1), 'KB');
