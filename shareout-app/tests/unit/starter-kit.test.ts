import { afterEach, describe, expect, it, vi } from 'vitest';

// Stub the publish layer so seeding logic is tested without touching D1/R2.
const publishArtifact = vi.fn(async () => ({ id: 'art_x', slug: 's', url: 'u' }));
vi.mock('../../src/publish', () => ({ publishArtifact: (...a: unknown[]) => publishArtifact(...a) }));

import { PERSONAL_KIT, TEAM_KIT, seedStarterKit } from '../../src/starter-kit';
import type { Env } from '../../src/types';
import type { AuthUser } from '../../src/api-auth';

const env = {} as Env;
const user: AuthUser = { id: 'usr_1', email: 'new@example.com', username: null };

// AI-marketing tells banned by Design/brand/voice.md.
const BANNED = /\b(elevate|seamless|unleash|next-gen|revolutionize|game-changer|delve|leverage|synergy|empower|supercharge)\b/i;

afterEach(() => publishArtifact.mockClear());

describe('starter kit registry', () => {
  it('has 10 personal and 5 team examples', () => {
    expect(PERSONAL_KIT).toHaveLength(10);
    expect(TEAM_KIT).toHaveLength(5);
  });

  it('uses unique, non-overlapping slugs', () => {
    const all = [...PERSONAL_KIT, ...TEAM_KIT].map(a => a.slug);
    expect(new Set(all).size).toBe(all.length);
  });

  it('every artifact is a well-formed, self-explaining HTML document', () => {
    for (const art of [...PERSONAL_KIT, ...TEAM_KIT]) {
      expect(art.html.startsWith('<!DOCTYPE html>'), art.slug).toBe(true);
      // Loads the SDK.
      expect(art.html).toContain('/sdk/shareout.js');
      // Carries the explainer banner (feature pill + "edit or delete" reminder).
      expect(art.html, art.slug).toContain(art.feature);
      expect(art.html.toLowerCase(), art.slug).toContain('edit or delete');
      expect(art.name.length, art.slug).toBeGreaterThan(0);
      expect(art.description.length, art.slug).toBeGreaterThan(0);
    }
  });

  it('stays on-brand (no banned marketing words)', () => {
    for (const art of [...PERSONAL_KIT, ...TEAM_KIT]) {
      const m = art.html.match(BANNED);
      expect(m ? `${art.slug}: ${m[0]}` : null).toBeNull();
    }
  });

  it('enables the visitor agent on the Ask-AI example', () => {
    const ai = PERSONAL_KIT.find(a => a.slug === 'ask-ai');
    expect(ai?.agent?.enabled).toBe(true);
  });
});

describe('seedStarterKit', () => {
  it('personal tier publishes the 10 personal examples as private, no workspace', async () => {
    const res = await seedStarterKit(env, user, { workspaceId: null, tier: 'personal' });
    expect(res.seeded).toHaveLength(10);
    expect(res.failed).toHaveLength(0);
    expect(publishArtifact).toHaveBeenCalledTimes(10);
    const params = publishArtifact.mock.calls[0][2] as { visibility: string; workspaceId: string | null };
    expect(params.visibility).toBe('private');
    expect(params.workspaceId).toBeNull();
  });

  it('team tier publishes all 15 examples into the workspace', async () => {
    const res = await seedStarterKit(env, user, { workspaceId: 'wsp_1', tier: 'team' });
    expect(res.seeded).toHaveLength(15);
    expect(publishArtifact).toHaveBeenCalledTimes(15);
    const params = publishArtifact.mock.calls[0][2] as { visibility: string; workspaceId: string | null };
    expect(params.visibility).toBe('workspace');
    expect(params.workspaceId).toBe('wsp_1');
  });

  it('flags every seeded artifact as an example', async () => {
    await seedStarterKit(env, user, { workspaceId: null, tier: 'team' });
    for (const call of publishArtifact.mock.calls) {
      expect((call[2] as { isExample?: boolean }).isExample).toBe(true);
    }
  });

  it('isolates a single failing publish from the rest of the kit', async () => {
    publishArtifact.mockRejectedValueOnce(new Error('boom'));
    const res = await seedStarterKit(env, user, { workspaceId: null, tier: 'personal' });
    expect(res.seeded).toHaveLength(9);
    expect(res.failed).toHaveLength(1);
    expect(res.failed[0].error).toBe('boom');
  });
});
