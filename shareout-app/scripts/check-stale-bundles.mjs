#!/usr/bin/env node
/**
 * Fails if the committed editor/SDK static-asset bundles are stale relative to
 * source (plan §19 Phase 4 "stale-build CI checks"). Rebuilds them and diffs the
 * staged output against what's committed. Brand assets are excluded — they need
 * Python/Pillow, which isn't available in CI.
 */
import { execSync } from 'node:child_process';

execSync('npm run build:editor', { stdio: 'inherit' });
execSync('npm run build:chat-core', { stdio: 'inherit' });
execSync('npm run build:sdk', { stdio: 'inherit' });
execSync('npm run build:mobile', { stdio: 'inherit' });
execSync('npm run build:skill', { stdio: 'inherit' });

try {
  execSync('git diff --exit-code -- public/_bundles/', { stdio: 'inherit' });
  console.log('✓ committed editor/SDK bundles are up to date');
} catch {
  console.error('\n✗ public/_bundles/* is stale. Run `npm run build:editor && npm run build:chat-core && npm run build:sdk && npm run build:mobile && npm run build:skill` and commit the result.');
  process.exit(1);
}
