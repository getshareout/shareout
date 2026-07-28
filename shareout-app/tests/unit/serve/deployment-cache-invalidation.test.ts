import { describe, it, expect, vi } from 'vitest';
import { setArtifactPaused, setArtifactVisibility } from '../../../src/superadmin/artifacts-admin';
import { addCollaboratorEmails } from '../../../src/artifacts/collaborators';
import type { Env } from '../../../src/types';

function makeEnv(opts: { authMethodChanges?: number } = {}) {
  const deleted: string[] = [];
  const env = {
    SLUGS: {
      delete: vi.fn(async (key: string) => { deleted.push(key); }),
    },
    DB: {
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn(() => ({
          first: vi.fn(async () => {
            if (sql.includes('SELECT slug FROM deployments')) return { slug: 'my-slug' };
            // No existing collaborator row ⇒ INSERT path.
            if (sql.includes('FROM collaborators')) return null;
            return null;
          }),
          run: vi.fn(async () => ({
            meta: { changes: sql.includes("auth_method = 'google'") ? (opts.authMethodChanges ?? 1) : 1 },
            success: true,
          })),
        })),
      })),
    },
  } as unknown as Env;
  return { env, deleted };
}

describe('deployment cache invalidation on mutation', () => {
  it('super-admin pause drops the deployment cache for the slug', async () => {
    const { env, deleted } = makeEnv();
    await setArtifactPaused(env, 'art_1', true);
    expect(deleted).toContain('deploy:my-slug');
  });

  it('super-admin visibility change drops the deployment cache for the slug', async () => {
    const { env, deleted } = makeEnv();
    const res = await setArtifactVisibility(env, 'art_1', 'private');
    expect(res.ok).toBe(true);
    expect(deleted).toContain('deploy:my-slug');
  });

  it('adding a collaborator that flips auth_method drops the deployment cache', async () => {
    const { env, deleted } = makeEnv({ authMethodChanges: 1 });
    await addCollaboratorEmails(env, 'art_1', ['user@example.com'], 'viewer', 'usr_owner');
    expect(deleted).toContain('deploy:my-slug');
  });

  it('adding a collaborator that does not change auth_method skips invalidation', async () => {
    const { env, deleted } = makeEnv({ authMethodChanges: 0 });
    await addCollaboratorEmails(env, 'art_1', ['user@example.com'], 'viewer', 'usr_owner');
    expect(deleted).toHaveLength(0);
  });
});
