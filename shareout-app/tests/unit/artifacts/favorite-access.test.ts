// @vitest-environment node
// Favorites are per-user bookmarks: anyone who can VIEW the artifact may star it.
import './setup';
import { describe, expect, it } from 'vitest';
import { handleAddFavorite } from '../../../src/artifacts/favorites';
import { artifactRow, baseEnv, makeDbMock } from './shared';
import type { Env } from '../../../src/types';

const member = { id: 'usr_m', email: 'm@x.com', username: null };

function env(visibility: string, opts: { member: boolean; deleted?: boolean }): { env: Env; inserts: string[] } {
  const row = { ...artifactRow, owner_id: 'usr_owner', workspace_id: 'wsp_1', visibility };
  const inserts: string[] = [];
  return {
    inserts,
    env: {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('FROM artifacts')) return sql.includes('deleted_at IS NULL') && opts.deleted ? null : row;
          if (sql.includes('email FROM users')) return { email: member.email };
          if (sql.includes('workspace_members')) return opts.member ? { role: 'member' } : null;
          return null;
        },
        run: (sql) => { if (sql.includes('INSERT')) inserts.push(sql); return { success: true }; },
      }),
    } as unknown as Env,
  };
}

const add = (e: Env) => handleAddFavorite(new Request('https://x', { method: 'POST' }), e, member, 'art_1');

describe('POST /v1/artifacts/{id}/favorite', () => {
  it('a workspace member can favorite a workspace-visible artifact', async () => {
    const { env: e, inserts } = env('workspace', { member: true });
    const res = await add(e);
    expect(res.status).toBe(200);
    expect(inserts).toHaveLength(1);
  });

  it('403 for a non-member on a workspace-visible artifact, and for a member on a private one', async () => {
    for (const e of [env('workspace', { member: false }), env('private', { member: true })]) {
      const res = await add(e.env);
      expect(res.status).toBe(403);
      expect(e.inserts).toHaveLength(0);
    }
  });

  it('404 for a trashed artifact', async () => {
    expect((await add(env('workspace', { member: true, deleted: true }).env)).status).toBe(404);
  });
});
