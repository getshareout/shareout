// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { PERSONAL_KIT, TEAM_KIT } from '../../../src/starter-kit';
import { rewriteSkillOrigin } from '../../../src/skill-origin';
import type { Env } from '../../../src/types';

const selfHosted = { SHAREOUT_BASE_URL: 'https://acme.workers.dev' } as unknown as Env;

const all = [...PERSONAL_KIT, ...TEAM_KIT];

describe('starter kit SDK origin', () => {
  it('has examples to seed', () => {
    expect(all.length).toBeGreaterThan(0);
  });

  // The example HTML is a module constant carrying the founder SDK URL. Seeding
  // rewrites it (src/starter-kit/index.ts); without that, every new account on a
  // self-hosted instance opens to examples fetching their SDK from another server.
  it('every example points at the seeding instance once rewritten', () => {
    for (const art of all) {
      const seeded = rewriteSkillOrigin(art.html, selfHosted);
      expect(seeded, art.slug).not.toContain('shareout.site/sdk');
      if (art.html.includes('/sdk/')) {
        expect(seeded, art.slug).toContain('https://acme.workers.dev/sdk/');
      }
    }
  });

  it('is byte-identical on the hosted instance', () => {
    for (const art of all) {
      expect(rewriteSkillOrigin(art.html, {} as Env), art.slug).toBe(art.html);
    }
  });
});
