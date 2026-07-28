import { describe, expect, it } from 'vitest';
import type { Env } from '../../../src/types';
import { resolveArtifactEditorAccess, resolveSlugEditorAccess } from '../../../src/router/helpers/editor-access';

const user = { id: 'usr_member', email: 'member@acme.com', username: 'member' };

function makeEnv(rows: {
  artifact?: Record<string, unknown> | null;
  collab?: { role: string } | null;
  userProfile?: { name: string | null; picture: string | null } | null;
  workspaceMember?: boolean;
}): Env {
  const DB = {
    prepare(sql: string) {
      return {
        bind(..._args: unknown[]) {
          return {
            async first() {
              if (sql.includes('FROM artifacts a') && sql.includes('JOIN deployments')) {
                return rows.artifact ?? null;
              }
              if (sql.includes('FROM artifacts WHERE id')) return rows.artifact ?? null;
              if (sql.includes('FROM collaborators')) return rows.collab ?? null;
              if (sql.includes('FROM users WHERE id')) return rows.userProfile ?? { name: 'Member', picture: null };
              if (sql.includes('FROM workspace_members')) {
                return rows.workspaceMember ? { 1: 1 } : null;
              }
              return null;
            },
            // External-sharing canAccess() runs after the editor ladder; with no
            // grants seeded it must resolve to empty (→ no promotion).
            async all() { return { results: [] }; },
          };
        },
      };
    },
  };
  return { DB } as unknown as Env;
}

const otherArtifact = {
  id: 'art_1',
  slug: 'weekly-report',
  owner_id: 'usr_owner',
  workspace_id: 'wsp_b18a4e39ac4ab82a102914a1',
  visibility: 'workspace',
  name: 'Weekly Report',
  description: null,
  artifact_type: 'html',
};

describe('editor access', () => {
  it('denies workspace members who are not explicit collaborators', async () => {
    const env = makeEnv({ artifact: otherArtifact, collab: null, workspaceMember: true });
    const byId = await resolveArtifactEditorAccess(env, 'art_1', user);
    expect(byId.ok).toBe(false);
    if (!byId.ok) expect(byId.response.status).toBe(403);

    const bySlug = await resolveSlugEditorAccess(env, 'weekly-report', user);
    expect(bySlug.ok).toBe(false);
    if (!bySlug.ok) expect(bySlug.response.status).toBe(403);
  });

  it('allows artifact owner', async () => {
    const env = makeEnv({
      artifact: { ...otherArtifact, owner_id: user.id },
      collab: null,
    });
    const res = await resolveArtifactEditorAccess(env, 'art_1', user);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.role).toBe('owner');
  });

  it('allows collaborators explicitly granted editor', async () => {
    const env = makeEnv({ artifact: otherArtifact, collab: { role: 'editor' } });
    const res = await resolveSlugEditorAccess(env, 'weekly-report', user);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.role).toBe('editor');
  });

  it('denies collaborators with viewer role', async () => {
    const env = makeEnv({ artifact: otherArtifact, collab: { role: 'viewer' } });
    const res = await resolveArtifactEditorAccess(env, 'art_1', user);
    expect(res.ok).toBe(false);
  });
});
