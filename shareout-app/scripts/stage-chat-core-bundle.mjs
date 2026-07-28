#!/usr/bin/env node
/**
 * Builds chat-core/ and stages dist/index.global.js as a Workers Static Asset at
 * public/_bundles/chat-core.js, served at /sdk/chat-core.js for the server-rendered
 * home + create chats. The editor client imports the chat-core TS source directly
 * (npm workspace), so it never loads this asset.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgDir = join(root, 'chat-core');

execSync('npm run build', { cwd: pkgDir, stdio: 'inherit' });

const bundle = readFileSync(join(pkgDir, 'dist/index.global.js'), 'utf8');

const destDir = join(root, 'public/_bundles');
mkdirSync(destDir, { recursive: true });
writeFileSync(join(destDir, 'chat-core.js'), bundle);
console.log('Staged public/_bundles/chat-core.js', (bundle.length / 1024).toFixed(1), 'KB');
