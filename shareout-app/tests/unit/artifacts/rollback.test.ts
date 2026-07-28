// @vitest-environment node
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { handleRollback } from '../../../src/artifacts';
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

describe('handleRollback', () => {
  it('returns 404 when artifact is missing', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: () => null }) };

    const response = await handleRollback(
      new Request('https://shareout.example.com/v1/artifacts/art_missing/rollback', {
        method: 'POST',
        body: JSON.stringify({ version_no: 1 }),
      }),
      env,
      user,
      'art_missing',
    );

    expect(response.status).toBe(404);
    expect(await jsonBody(response)).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('returns 403 when user is only a viewer', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('SELECT id, slug FROM artifacts')) return { id: 'art_1', slug: 'demo-slug' };
          if (sql.includes('owner_id FROM artifacts')) return { owner_id: 'usr_other' };
          if (sql.includes('email FROM users')) return { email: 'viewer@example.com' };
          if (sql.includes('role FROM collaborators')) return { role: 'viewer' };
          return null;
        },
      }),
    };

    const response = await handleRollback(
      new Request('https://shareout.example.com/v1/artifacts/art_1/rollback', {
        method: 'POST',
        body: JSON.stringify({ version_no: 1 }),
      }),
      env,
      { id: 'usr_2', email: 'viewer@example.com', username: null },
      'art_1',
    );

    expect(response.status).toBe(403);
    expect(await jsonBody(response)).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects invalid JSON and missing version', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('SELECT id, slug FROM artifacts')) return { id: 'art_1', slug: 'demo-slug' };
          if (sql.includes('owner_id FROM artifacts')) return { owner_id: 'usr_1' };
          return null;
        },
        run: () => ({ success: true, meta: { changes: 1 } }),
      }),
    };

    const badJson = await handleRollback(
      new Request('https://shareout.example.com/v1/artifacts/art_1/rollback', {
        method: 'POST',
        body: '{',
      }),
      env,
      user,
      'art_1',
    );
    expect(badJson.status).toBe(400);
    expect(await jsonBody(badJson)).toMatchObject({ code: 'INVALID_JSON' });

    const missing = await handleRollback(
      new Request('https://shareout.example.com/v1/artifacts/art_1/rollback', {
        method: 'POST',
        body: JSON.stringify({ version_no: 99 }),
      }),
      env,
      user,
      'art_1',
    );
    expect(missing.status).toBe(404);
    expect(await jsonBody(missing)).toMatchObject({ code: 'VERSION_NOT_FOUND' });
  });

  it('rolls back production deployment by version_id and clears slug cache', async () => {
    const slugs = makeSlugsMock();
    const runs: string[] = [];
    const env = {
      ...baseEnv,
      SLUGS: slugs,
      DB: makeDbMock({
        first: (sql, ...args) => {
          if (sql.includes('SELECT id, slug FROM artifacts')) return { id: 'art_1', slug: 'demo-slug' };
          if (sql.includes('owner_id FROM artifacts')) return { owner_id: 'usr_1' };
          if (sql.includes('versions WHERE id = ? AND artifact_id = ?')) {
            expect(args[0]).toBe('ver_target');
            return { id: 'ver_target', version_no: 4 };
          }
          return null;
        },
        run: (sql) => {
          runs.push(sql);
          return { success: true, meta: { changes: 1 } };
        },
      }),
    };

    const response = await handleRollback(
      new Request('https://shareout.example.com/v1/artifacts/art_1/rollback', {
        method: 'POST',
        body: JSON.stringify({ version_id: 'ver_target' }),
      }),
      env,
      user,
      'art_1',
    );

    expect(response.status).toBe(200);
    expect(await jsonBody(response)).toEqual({
      success: true,
      deployed_version: 4,
      version_id: 'ver_target',
    });
    expect(runs.some((sql) => sql.includes('UPDATE deployments') && sql.includes('production'))).toBe(true);
    expect(slugs.delete).toHaveBeenCalledWith('deploy:demo-slug');
  });

  it('rolls back production deployment by version_no', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql, ...args) => {
          if (sql.includes('SELECT id, slug FROM artifacts')) return { id: 'art_1', slug: 'demo-slug' };
          if (sql.includes('owner_id FROM artifacts')) return { owner_id: 'usr_1' };
          if (sql.includes('version_no = ? AND artifact_id = ?')) {
            expect(args[0]).toBe(2);
            return { id: 'ver_2', version_no: 2 };
          }
          return null;
        },
        run: () => ({ success: true, meta: { changes: 1 } }),
      }),
    };

    const response = await handleRollback(
      new Request('https://shareout.example.com/v1/artifacts/art_1/rollback', {
        method: 'POST',
        body: JSON.stringify({ version_no: 2 }),
      }),
      env,
      user,
      'art_1',
    );

    expect(response.status).toBe(200);
    expect(await jsonBody(response)).toMatchObject({
      success: true,
      deployed_version: 2,
      version_id: 'ver_2',
    });
  });
});

