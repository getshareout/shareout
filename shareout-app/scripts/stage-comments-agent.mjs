#!/usr/bin/env node
/**
 * Stages the in-iframe comments agent (sdk/src/comments-agent/agent.js) as a
 * Workers Static Asset at public/_bundles/shareout-comments-agent.js, served via
 * the ASSETS binding and injected into artifact HTML by the worker's HTMLRewriter.
 *
 * The agent is dependency-free vanilla JS, so this is a copy (no bundling step).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'sdk/src/comments-agent/agent.js');
const destDir = join(root, 'public/_bundles');

const code = readFileSync(src, 'utf8');
mkdirSync(destDir, { recursive: true });
writeFileSync(join(destDir, 'shareout-comments-agent.js'), code);
console.log('Staged public/_bundles/shareout-comments-agent.js', (code.length / 1024).toFixed(1), 'KB');
