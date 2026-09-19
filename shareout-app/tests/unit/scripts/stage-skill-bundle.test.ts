// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Regression test for a real bug: fflate encodes each zip entry's DOS timestamp
// via Date's local-timezone getters, so a "fixed mtime" alone does not make the
// build reproducible — the process's timezone at build time still leaks into the
// output bytes. That made check:bundles (which rebuilds and diffs against
// committed bytes) flaky depending on the invocation's TZ. The fix re-execs the
// script with TZ=UTC pinned before Node starts; this test drives it through
// exactly the invocation shapes that used to disagree.

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const scriptPath = join(appRoot, 'scripts/stage-skill-bundle.mjs');
const zipPath = join(appRoot, 'public/_bundles/skill.zip');

function buildAndHash(env: Record<string, string | undefined>): string {
  execFileSync(process.execPath, [scriptPath], { env, stdio: 'pipe' });
  return createHash('sha1').update(readFileSync(zipPath)).digest('hex');
}

describe('stage-skill-bundle determinism', () => {
  it('produces byte-identical output regardless of the caller\'s TZ', () => {
    const base = { ...process.env };

    const withNonUtcTz = buildAndHash({ ...base, TZ: 'America/New_York' });
    const withNoTz = buildAndHash((() => {
      const { TZ, ...rest } = base;
      return rest;
    })());
    const withUtcTz = buildAndHash({ ...base, TZ: 'UTC' });
    const withAnotherNonUtcTz = buildAndHash({ ...base, TZ: 'Asia/Tokyo' });

    expect(withNonUtcTz).toBe(withUtcTz);
    expect(withNoTz).toBe(withUtcTz);
    expect(withAnotherNonUtcTz).toBe(withUtcTz);
  }, 30_000);

  it('is stable across repeated builds with the same env', () => {
    const env = { ...process.env, TZ: 'UTC' };
    const first = buildAndHash(env);
    const second = buildAndHash(env);
    expect(first).toBe(second);
  }, 30_000);
});
