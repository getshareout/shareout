// @vitest-environment node
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { handleDeleteArtifact } from '../../../src/artifacts';
import {
  artifactRow,
  baseEnv,
  jsonBody,
  makeDbMock,
  makeR2Mock,
  makeSlugsMock,
  ownerRoleFirst,
  user,
} from './shared';

describe('handleDeleteArtifact', () => {
  it('returns 404 when artifact is missing', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({ first: () => null }),
    };

    const response = await handleDeleteArtifact(
      new Request('https://shareout.example.com/v1/artifacts/art_missing', { method: 'DELETE' }),
      env,
      user,
      'art_missing',
    );

    expect(response.status).toBe(404);
    expect(await jsonBody(response)).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('returns 403 when user is not the owner', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('SELECT id, slug, workspace_id, deleted_at FROM artifacts')) return { id: 'art_1', slug: 'demo', workspace_id: null };
          if (sql.includes('owner_id FROM artifacts')) return { owner_id: 'usr_other' };
          if (sql.includes('email FROM users')) return { email: 'editor@example.com' };
          if (sql.includes('role FROM collaborators')) return { role: 'editor' };
          return null;
        },
      }),
    };

    const response = await handleDeleteArtifact(
      new Request('https://shareout.example.com/v1/artifacts/art_1', { method: 'DELETE' }),
      env,
      { id: 'usr_2', email: 'editor@example.com', username: null },
      'art_1',
    );

    expect(response.status).toBe(403);
    expect(await jsonBody(response)).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('soft-deletes: stamps deleted_at, frees slug cache, keeps R2 bytes', async () => {
    const slugs = makeSlugsMock();
    const artifacts = makeR2Mock();
    const runSql: string[] = [];
    const env = {
      ...baseEnv,
      SLUGS: slugs,
      ARTIFACTS: artifacts,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('SELECT id, slug, workspace_id, deleted_at FROM artifacts')) return { id: 'art_1', slug: 'demo-slug', workspace_id: null };
          if (sql.includes('owner_id FROM artifacts')) return { owner_id: 'usr_1' };
          return null;
        },
        run: (sql) => { runSql.push(sql); return { success: true }; },
      }),
    };

    const response = await handleDeleteArtifact(
      new Request('https://shareout.example.com/v1/artifacts/art_1', { method: 'DELETE' }),
      env,
      user,
      'art_1',
    );

    expect(response.status).toBe(200);
    const body = await jsonBody(response);
    expect(body).toMatchObject({ success: true, deleted: 'art_1', retention_days: 30 });
    expect(body.recoverable_until).toBeTruthy();
    expect(body.restore_url).toContain('/v1/artifacts/art_1/restore');
    // Soft-delete must NOT purge R2 bytes — content stays restorable.
    expect(artifacts.delete).not.toHaveBeenCalled();
    // Stamps deleted_at + tombstones the routing slug, drops the production deployment.
    expect(runSql.some((s) => s.includes('SET deleted_at = ?') && s.includes("'__deleted__'"))).toBe(true);
    expect(runSql.some((s) => s.includes("DELETE FROM deployments WHERE artifact_id = ? AND channel = 'production'"))).toBe(true);
    // Frees the slug caches so a same-slug re-publish works.
    expect(slugs.delete).toHaveBeenCalledWith('deploy:demo-slug');
  });

  it('lets a workspace admin delete a workspace-owned artifact with no owner', async () => {
    const env = {
      ...baseEnv,
      SLUGS: makeSlugsMock(),
      ARTIFACTS: makeR2Mock(),
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('SELECT id, slug, workspace_id, deleted_at FROM artifacts')) return { id: 'art_ws', slug: 'ws-slug', workspace_id: 'wsp_1' };
          if (sql.includes('owner_id FROM artifacts')) return { owner_id: null };
          if (sql.includes('email FROM users')) return { email: 'admin@example.com' };
          if (sql.includes('role FROM collaborators')) return null;
          if (sql.includes('role FROM workspace_members')) return { role: 'admin' };
          return null;
        },
        run: () => ({ success: true }),
      }),
    };

    const response = await handleDeleteArtifact(
      new Request('https://shareout.example.com/v1/artifacts/art_ws', { method: 'DELETE' }),
      env,
      { id: 'usr_admin', email: 'admin@example.com', username: null },
      'art_ws',
    );

    expect(response.status).toBe(200);
    expect(await jsonBody(response)).toMatchObject({ success: true, deleted: 'art_ws', retention_days: 30 });
  });

  it('returns 403 when a workspace member (non-admin) tries to delete a workspace-owned artifact', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('SELECT id, slug, workspace_id, deleted_at FROM artifacts')) return { id: 'art_ws', slug: 'ws-slug', workspace_id: 'wsp_1' };
          if (sql.includes('owner_id FROM artifacts')) return { owner_id: null };
          if (sql.includes('email FROM users')) return { email: 'member@example.com' };
          if (sql.includes('role FROM collaborators')) return null;
          if (sql.includes('role FROM workspace_members')) return { role: 'member' };
          return null;
        },
      }),
    };

    const response = await handleDeleteArtifact(
      new Request('https://shareout.example.com/v1/artifacts/art_ws', { method: 'DELETE' }),
      env,
      { id: 'usr_member', email: 'member@example.com', username: null },
      'art_ws',
    );

    expect(response.status).toBe(403);
    expect(await jsonBody(response)).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('returns 404 for an already soft-deleted artifact', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('SELECT id, slug, workspace_id, deleted_at FROM artifacts')) return { id: 'art_1', slug: 'demo', workspace_id: null, deleted_at: '2026-06-01T00:00:00.000Z' };
          return null;
        },
      }),
    };

    const response = await handleDeleteArtifact(
      new Request('https://shareout.example.com/v1/artifacts/art_1', { method: 'DELETE' }),
      env,
      user,
      'art_1',
    );

    expect(response.status).toBe(404);
  });
});

