// @vitest-environment node
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { handleRestoreArtifact, handleRestoreAllDeleted } from '../../../src/artifacts';
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

describe('handleRestoreArtifact', () => {
  it('returns 400 when the artifact is not deleted', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('FROM artifacts WHERE id = ?')) return { id: 'art_1', name: 'Demo', display_slug: 'demo', workspace_id: null, owner_id: 'usr_1', deleted_at: null };
          return null;
        },
      }),
    };

    const response = await handleRestoreArtifact(
      new Request('https://shareout.example.com/v1/artifacts/art_1/restore', { method: 'POST' }),
      env,
      user,
      'art_1',
    );

    expect(response.status).toBe(400);
    expect(await jsonBody(response)).toMatchObject({ code: 'NOT_DELETED' });
  });

  it('clears deleted_at, allocates a fresh slug, and recreates the deployment', async () => {
    const slugs = makeSlugsMock();
    const runSql: string[] = [];
    const env = {
      ...baseEnv,
      SLUGS: slugs,
      ARTIFACTS: makeR2Mock(),
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('name, display_slug, workspace_id, owner_id, deleted_at FROM artifacts')) {
            return { id: 'art_1', name: 'Demo', display_slug: 'demo', workspace_id: null, owner_id: 'usr_1', deleted_at: '2026-06-01T00:00:00.000Z' };
          }
          if (sql.includes('SELECT 1 FROM artifacts WHERE slug = ?')) return null; // slug free
          if (sql.includes('ORDER BY version_no DESC')) return { id: 'ver_9' };
          // handleGetArtifact (final response) — return a minimal detail row
          if (sql.includes('LEFT JOIN deployments d')) return { id: 'art_1', name: 'Demo', slug: 'demo', visibility: 'private', paused: 0, created_at: 'x', auth_method: 'public', owner_id: 'usr_1', workspace_id: null, current_version: 9, artifact_type: 'html', is_favorite: 0, deploy_slug: 'demo' };
          if (sql.includes('owner_id FROM artifacts')) return { owner_id: 'usr_1' };
          return null;
        },
        all: () => ({ results: [] }),
        run: (sql) => { runSql.push(sql); return { success: true }; },
      }),
    };

    const response = await handleRestoreArtifact(
      new Request('https://shareout.example.com/v1/artifacts/art_1/restore', { method: 'POST' }),
      env,
      user,
      'art_1',
    );

    expect(response.status).toBe(200);
    expect(runSql.some((s) => s.includes('SET deleted_at = NULL, slug = ?'))).toBe(true);
    expect(runSql.some((s) => s.includes('INSERT INTO deployments'))).toBe(true);
  });
});

describe('handleRestoreAllDeleted', () => {
  it('restores every row in scope and reports may_have_more', async () => {
    const env = {
      ...baseEnv,
      SLUGS: makeSlugsMock(),
      ARTIFACTS: makeR2Mock(),
      DB: makeDbMock({
        all: (sql) => (sql.includes('SELECT a.id') && !sql.includes('a.name'))
          ? { results: [{ id: 'art_1' }, { id: 'art_2' }] }
          : { results: [] },
        first: (sql) => {
          if (sql.includes('name, display_slug, workspace_id, owner_id, deleted_at FROM artifacts')) {
            return { id: 'art_1', name: 'Demo', display_slug: 'demo', workspace_id: null, owner_id: 'usr_1', deleted_at: '2026-06-01T00:00:00.000Z' };
          }
          if (sql.includes('SELECT 1 FROM artifacts WHERE slug = ?')) return null; // slug free
          if (sql.includes('ORDER BY version_no DESC')) return { id: 'ver_9' };
          if (sql.includes('LEFT JOIN deployments d')) return { id: 'art_1', name: 'Demo', slug: 'demo', visibility: 'private', paused: 0, created_at: 'x', auth_method: 'public', owner_id: 'usr_1', workspace_id: null, current_version: 9, artifact_type: 'html', is_favorite: 0, deploy_slug: 'demo' };
          if (sql.includes('owner_id FROM artifacts')) return { owner_id: 'usr_1' };
          return null;
        },
        run: () => ({ success: true }),
      }),
    };

    const response = await handleRestoreAllDeleted(
      new Request('https://shareout.example.com/v1/artifacts/deleted/restore-all', { method: 'POST' }),
      env,
      user,
    );

    expect(response.status).toBe(200);
    expect(await jsonBody(response)).toMatchObject({ restored: 2, may_have_more: false });
  });
});

