import { describe, expect, it, vi } from 'vitest';
import { OFFICIAL_SKILLS, OFFICIAL_SKILL_SLUGS } from '../../src/official-skills/registry';
import { OFFICIAL_SKILL_CONTENT } from '../../src/official-skills/content.generated';
import { handleListRecommendedSkills } from '../../src/official-skills/list';
import type { AuthUser } from '../../src/api-auth';
import type { Env } from '../../src/types';

const user: AuthUser = { id: 'usr_1', email: 'a@b.com', username: 'a' };

describe('official skills registry', () => {
  it('has unique, url-safe slugs', () => {
    expect(OFFICIAL_SKILL_SLUGS.size).toBe(OFFICIAL_SKILLS.length);
    for (const s of OFFICIAL_SKILLS) expect(s.slug).toMatch(/^[a-z0-9-]+$/);
  });

  it('includes the ShareOut official skill first', () => {
    expect(OFFICIAL_SKILLS[0].slug).toBe('shareout');
    expect(OFFICIAL_SKILLS[0].attribution).toBeUndefined();
  });

  it('has embedded content + a hash for every registry entry', () => {
    for (const s of OFFICIAL_SKILLS) {
      const c = OFFICIAL_SKILL_CONTENT[s.slug];
      expect(c, `content for ${s.slug}`).toBeTruthy();
      expect(c.markdown.length).toBeGreaterThan(50);
      expect(c.hash).toMatch(/^[0-9a-f]{16}$/);
    }
  });

  it('third-party skills carry attribution', () => {
    for (const s of OFFICIAL_SKILLS.slice(1)) expect(s.attribution).toBeTruthy();
  });
});

function makeListDb(rows: Array<Record<string, unknown>>): Env['DB'] {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({ all: vi.fn(async () => ({ results: rows })) })),
      all: vi.fn(async () => ({ results: rows })),
    })),
  } as unknown as Env['DB'];
}

describe('handleListRecommendedSkills', () => {
  const env = { SHAREOUT_BASE_URL: 'https://shareout.site', DB: makeListDb([
    { id: 'art_2', slug: 'tdd-r', display_slug: 'os-tdd', official_rank: 3, use_count: 4 },
    { id: 'art_1', slug: 'shareout-r', display_slug: 'os-shareout', official_rank: 0, use_count: 9 },
  ]) } as unknown as Env;

  it('returns synced official skills in registry order with merged display fields', async () => {
    const res = await handleListRecommendedSkills(env, user);
    const body = await res.json() as { skills: Array<Record<string, unknown>> };
    // Only the two synced slugs come back; ordered by registry order (shareout before tdd).
    expect(body.skills.map(s => s.slug)).toEqual(['shareout', 'tdd']);
    const shareout = body.skills[0];
    expect(shareout.name).toBe('ShareOut');
    expect(shareout.official).toBe(true);
    expect(shareout.url).toBe('https://shareout.site/a/shareout-r/');
    expect(shareout.attribution).toBeNull();
    expect((body.skills[1] as { attribution: string }).attribution).toBe('Matt Pocock');
  });

  it('omits registry skills that are not yet synced', async () => {
    const res = await handleListRecommendedSkills(env, user);
    const body = await res.json() as { skills: Array<{ slug: string }> };
    expect(body.skills.length).toBe(2); // not all 8
  });
});
