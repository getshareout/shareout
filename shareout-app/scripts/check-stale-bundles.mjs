#!/usr/bin/env node
/**
 * Fails if the committed generated files are stale relative to source (plan §19 Phase 4
 * "stale-build CI checks"). Rebuilds them and diffs the output against what's committed.
 * Brand assets are excluded — they need Python/Pillow, which isn't available in CI.
 *
 * These files are marked `merge=generated` in .gitattributes, so a rebase keeps one side
 * instead of conflicting; this check is what catches the stale result before push.
 */
import { execSync } from 'node:child_process';

const GENERATED = [
  'public/_bundles/',
  'public/sdk/',
  'src/discovery/',
  'src/official-skills/content.generated.ts',
  'src/data/agent/sdk-reference.generated.ts',
];

execSync('npm run build:editor', { stdio: 'inherit' });
execSync('npm run build:chat-core', { stdio: 'inherit' });
execSync('npm run build:sdk', { stdio: 'inherit' });
execSync('npm run build:mobile', { stdio: 'inherit' });
execSync('npm run build:skill', { stdio: 'inherit' });
execSync('node scripts/stage-comments-agent.mjs && node scripts/stage-bundle-versions.mjs', { stdio: 'inherit' });
execSync('npm run build:official-skills && npm run build:discovery', { stdio: 'inherit' });
execSync('npm run build:sdk-reference', { stdio: 'inherit' });

try {
  execSync(`git diff --exit-code --stat -- ${GENERATED.join(' ')}`, { stdio: 'inherit' });
  console.log('✓ committed generated bundles are up to date');
} catch {
  console.error('\n✗ generated files are stale. Commit the files listed above — this check just regenerated them.');
  process.exit(1);
}
