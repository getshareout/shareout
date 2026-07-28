import { afterEach, describe, expect, it, vi } from 'vitest';

// Stub the publish layer so sync orchestration is tested without D1/R2.
const publishArtifact = vi.fn(async () => ({ artifact: { id: 'art_new', type: 'markdown' }, version: { id: 'v1', version_no: 1 } }));
vi.mock('../../src/publish', () => ({ publishArtifact: (...a: unknown[]) => publishArtifact(...a) }));

import { syncOfficialSkills, OFFICIAL_SYSTEM_WORKSPACE_ID } from '../../src/official-skills/sync';
import { OFFICIAL_SKILLS } from '../../src/official-skills/registry';
import { OFFICIAL_SKILL_CONTENT } from '../../src/official-skills/content.generated';
import type { Env } from '../../src/types';

afterEach(() => publishArtifact.mockClear());

// Mock DB: workspace bootstrap SELECT returns a row; storedHash SELECT returns the
// per-slug hash from `hashes` (null = never published). Records run() SQL.
function makeDb(hashes: (displaySlug: string) => string | null) {
  const runs: Array<{ sql: string; args: unknown[] }> = [];
  const db = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: async () => {
          if (/FROM workspaces WHERE id = \?/.test(sql)) return { id: OFFICIAL_SYSTEM_WORKSPACE_ID };
          if (/content_hash AS h/.test(sql)) {
            const displaySlug = String(args[1]);
            const h = hashes(displaySlug);
            return h === null ? null : { h };
          }
          return null;
        },
        run: async () => { runs.push({ sql, args }); return { success: true, meta: { changes: 1 } }; },
      }),
    }),
  } as unknown as Env['DB'];
  return { db, runs };
}

const env = (db: Env['DB']) => ({ DB: db, SHAREOUT_BASE_URL: 'https://shareout.site' } as unknown as Env);

describe('syncOfficialSkills', () => {
  it('first run publishes every skill and flags it official', async () => {
    const { db, runs } = makeDb(() => null); // nothing published yet
    const res = await syncOfficialSkills(env(db));

    expect(res.published).toEqual(OFFICIAL_SKILLS.map(s => s.slug));
    expect(res.unchanged).toEqual([]);
    expect(res.failed).toEqual([]);
    expect(publishArtifact).toHaveBeenCalledTimes(OFFICIAL_SKILLS.length);
    // Every skill got an official=1 UPDATE.
    const officialUpdates = runs.filter(r => /SET official = 1, official_rank = \?, content_hash/.test(r.sql));
    expect(officialUpdates.length).toBe(OFFICIAL_SKILLS.length);
  });

  it('skips republish when the content hash is unchanged', async () => {
    // Report every skill as already at its current embedded hash.
    const { db } = makeDb((displaySlug) => {
      const slug = displaySlug.replace(/^os-/, '');
      return OFFICIAL_SKILL_CONTENT[slug]?.hash ?? null;
    });
    const res = await syncOfficialSkills(env(db));

    expect(res.unchanged).toEqual(OFFICIAL_SKILLS.map(s => s.slug));
    expect(res.published).toEqual([]);
    expect(publishArtifact).not.toHaveBeenCalled();
  });

  it('bails without publishing when the system workspace is unavailable', async () => {
    const db = {
      prepare: () => ({ bind: () => ({ first: async () => null, run: async () => ({ success: true, meta: { changes: 0 } }) }) }),
    } as unknown as Env['DB'];
    const res = await syncOfficialSkills(env(db));
    expect(res.failed[0]?.slug).toBe('*');
    expect(publishArtifact).not.toHaveBeenCalled();
  });
});
