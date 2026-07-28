// @vitest-environment node
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { handleTransferOwnership } from '../../../src/artifacts';
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

describe('handleTransferOwnership', () => {
  it('returns 404 when artifact is missing', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: () => null }) };

    const response = await handleTransferOwnership(
      new Request('https://shareout.example.com/v1/artifacts/art_missing/transfer', {
        method: 'POST',
        body: JSON.stringify({ email: 'new@example.com' }),
      }),
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
          if (sql.includes('owner_id FROM artifacts WHERE id = ?') && sql.includes('SELECT id')) {
            return { id: 'art_1', owner_id: 'usr_other' };
          }
          if (sql.includes('owner_id FROM artifacts')) return { owner_id: 'usr_other' };
          if (sql.includes('email FROM users')) return { email: 'editor@example.com' };
          if (sql.includes('role FROM collaborators')) return { role: 'editor' };
          return null;
        },
      }),
    };

    const response = await handleTransferOwnership(
      new Request('https://shareout.example.com/v1/artifacts/art_1/transfer', {
        method: 'POST',
        body: JSON.stringify({ email: 'new@example.com' }),
      }),
      env,
      { id: 'usr_2', email: 'editor@example.com', username: null },
      'art_1',
    );

    expect(response.status).toBe(403);
    expect(await jsonBody(response)).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects invalid JSON and email', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('owner_id FROM artifacts WHERE id = ?') && sql.includes('SELECT id')) {
            return { id: 'art_1', owner_id: 'usr_1' };
          }
          if (sql.includes('owner_id FROM artifacts')) return { owner_id: 'usr_1' };
          return null;
        },
      }),
    };

    const badJson = await handleTransferOwnership(
      new Request('https://shareout.example.com/v1/artifacts/art_1/transfer', {
        method: 'POST',
        body: '{',
      }),
      env,
      user,
      'art_1',
    );
    expect(badJson.status).toBe(400);
    expect(await jsonBody(badJson)).toMatchObject({ code: 'INVALID_JSON' });

    const badEmail = await handleTransferOwnership(
      new Request('https://shareout.example.com/v1/artifacts/art_1/transfer', {
        method: 'POST',
        body: JSON.stringify({ email: 'not-valid' }),
      }),
      env,
      user,
      'art_1',
    );
    expect(badEmail.status).toBe(400);
    expect(await jsonBody(badEmail)).toMatchObject({ code: 'INVALID_EMAIL' });
  });

  it('returns 404 when new owner user does not exist', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql, ...args) => {
          if (sql.includes('owner_id FROM artifacts WHERE id = ?') && sql.includes('SELECT id')) {
            return { id: 'art_1', owner_id: 'usr_1' };
          }
          if (sql.includes('owner_id FROM artifacts')) return { owner_id: 'usr_1' };
          if (sql.includes('SELECT id FROM users WHERE email = ?')) {
            expect(args[0]).toBe('new@example.com');
            return null;
          }
          return null;
        },
      }),
    };

    const response = await handleTransferOwnership(
      new Request('https://shareout.example.com/v1/artifacts/art_1/transfer', {
        method: 'POST',
        body: JSON.stringify({ email: 'New@Example.com' }),
      }),
      env,
      user,
      'art_1',
    );

    expect(response.status).toBe(404);
    expect(await jsonBody(response)).toMatchObject({ code: 'USER_NOT_FOUND' });
  });

  it('transfers ownership and promotes existing collaborator to owner', async () => {
    const runs: string[] = [];
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql, ...args) => {
          if (sql.includes('owner_id FROM artifacts WHERE id = ?') && sql.includes('SELECT id')) {
            return { id: 'art_1', owner_id: 'usr_1' };
          }
          if (sql.includes('owner_id FROM artifacts')) return { owner_id: 'usr_1' };
          if (sql.includes('SELECT id FROM users WHERE email = ?')) {
            return { id: 'usr_new' };
          }
          if (sql.includes('email FROM users WHERE id = ?')) {
            return { email: 'owner@example.com' };
          }
          if (sql.includes('SELECT id FROM collaborators WHERE artifact_id = ? AND email = ?')) {
            return { id: 'col_existing' };
          }
          return null;
        },
        run: (sql) => {
          runs.push(sql);
          return { success: true, meta: { changes: 1 } };
        },
      }),
    };

    const response = await handleTransferOwnership(
      new Request('https://shareout.example.com/v1/artifacts/art_1/transfer', {
        method: 'POST',
        body: JSON.stringify({ email: 'newowner@example.com' }),
      }),
      env,
      user,
      'art_1',
    );

    expect(response.status).toBe(200);
    expect(await jsonBody(response)).toEqual({ success: true, new_owner: 'newowner@example.com' });
    expect(runs.some((sql) => sql.includes('UPDATE artifacts SET owner_id'))).toBe(true);
    expect(runs.filter((sql) => sql.includes('UPDATE collaborators SET role = ?')).length).toBe(2);
    expect(runs.some((sql) => sql.includes('INSERT INTO collaborators'))).toBe(false);
  });

  it('transfers ownership and inserts owner collaborator when missing', async () => {
    const runs: string[] = [];
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('owner_id FROM artifacts WHERE id = ?') && sql.includes('SELECT id')) {
            return { id: 'art_1', owner_id: 'usr_1' };
          }
          if (sql.includes('owner_id FROM artifacts')) return { owner_id: 'usr_1' };
          if (sql.includes('SELECT id FROM users WHERE email = ?')) return { id: 'usr_new' };
          if (sql.includes('email FROM users WHERE id = ?')) return { email: 'owner@example.com' };
          if (sql.includes('SELECT id FROM collaborators WHERE artifact_id = ? AND email = ?')) return null;
          return null;
        },
        run: (sql) => {
          runs.push(sql);
          return { success: true, meta: { changes: 1 } };
        },
      }),
    };

    const response = await handleTransferOwnership(
      new Request('https://shareout.example.com/v1/artifacts/art_1/transfer', {
        method: 'POST',
        body: JSON.stringify({ email: 'brandnew@example.com' }),
      }),
      env,
      user,
      'art_1',
    );

    expect(response.status).toBe(200);
    expect(runs.some((sql) => sql.includes('INSERT INTO collaborators'))).toBe(true);
  });

  it('invalidates the cached artifact record on transfer', async () => {
    const slugs = makeSlugsMock();
    const env = {
      ...baseEnv,
      SLUGS: slugs,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('owner_id FROM artifacts WHERE id = ?') && sql.includes('SELECT id')) {
            return { id: 'art_1', owner_id: 'usr_1' };
          }
          if (sql.includes('owner_id FROM artifacts')) return { owner_id: 'usr_1' };
          if (sql.includes('SELECT id FROM users WHERE email = ?')) return { id: 'usr_new' };
          if (sql.includes('email FROM users WHERE id = ?')) return { email: 'owner@example.com' };
          if (sql.includes('SELECT id FROM collaborators WHERE artifact_id = ? AND email = ?')) return { id: 'col_existing' };
          if (sql.includes('slug FROM deployments')) return { slug: 'deploy-slug' };
          return null;
        },
      }),
    };

    const response = await handleTransferOwnership(
      new Request('https://shareout.example.com/v1/artifacts/art_1/transfer', {
        method: 'POST',
        body: JSON.stringify({ email: 'newowner@example.com' }),
      }),
      env,
      user,
      'art_1',
    );

    expect(response.status).toBe(200);
    const deleted = (slugs.delete as ReturnType<typeof vi.fn>).mock.calls.map(([k]) => k);
    expect(deleted).toContain('art:art_1');
    expect(deleted).toContain('art:deploy-slug');
    expect(deleted).toContain('deploy:deploy-slug');
  });
});

