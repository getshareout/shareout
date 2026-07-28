// @vitest-environment node
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { handleAddCollaborators } from '../../../src/artifacts';
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

describe('handleAddCollaborators', () => {
  it('returns 404 when artifact is missing', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: () => null }) };

    const response = await handleAddCollaborators(
      new Request('https://shareout.example.com/v1/artifacts/art_missing/collaborators', {
        method: 'POST',
        body: JSON.stringify({ emails: ['a@b.com'] }),
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
          if (sql.includes('auth_method FROM artifacts')) return { id: 'art_1', auth_method: 'none' };
          if (sql.includes('owner_id FROM artifacts')) return { owner_id: 'usr_other' };
          if (sql.includes('email FROM users')) return { email: 'viewer@example.com' };
          if (sql.includes('role FROM collaborators')) return { role: 'viewer' };
          return null;
        },
      }),
    };

    const response = await handleAddCollaborators(
      new Request('https://shareout.example.com/v1/artifacts/art_1/collaborators', {
        method: 'POST',
        body: JSON.stringify({ emails: ['new@example.com'] }),
      }),
      env,
      { id: 'usr_2', email: 'viewer@example.com', username: null },
      'art_1',
    );

    expect(response.status).toBe(403);
    expect(await jsonBody(response)).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects invalid JSON, emails array, and role', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('auth_method FROM artifacts')) return { id: 'art_1', auth_method: 'none' };
          if (sql.includes('owner_id FROM artifacts')) return { owner_id: 'usr_1' };
          return null;
        },
        all: () => ({ results: [] }),
      }),
    };

    const badJson = await handleAddCollaborators(
      new Request('https://shareout.example.com/v1/artifacts/art_1/collaborators', {
        method: 'POST',
        body: '{',
      }),
      env,
      user,
      'art_1',
    );
    expect(badJson.status).toBe(400);
    expect(await jsonBody(badJson)).toMatchObject({ code: 'INVALID_JSON' });

    const badEmails = await handleAddCollaborators(
      new Request('https://shareout.example.com/v1/artifacts/art_1/collaborators', {
        method: 'POST',
        body: JSON.stringify({ emails: 'not-array' }),
      }),
      env,
      user,
      'art_1',
    );
    expect(badEmails.status).toBe(400);
    expect(await jsonBody(badEmails)).toMatchObject({ code: 'INVALID_EMAILS' });

    const badRole = await handleAddCollaborators(
      new Request('https://shareout.example.com/v1/artifacts/art_1/collaborators', {
        method: 'POST',
        body: JSON.stringify({ emails: ['a@b.com'], role: 'owner' }),
      }),
      env,
      user,
      'art_1',
    );
    expect(badRole.status).toBe(400);
    expect(await jsonBody(badRole)).toMatchObject({ code: 'INVALID_ROLE' });
  });

  it('inserts new collaborators, filters invalid emails, and sets auth_method to google', async () => {
    const runs: string[] = [];
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql, ...args) => {
          if (sql.includes('auth_method FROM artifacts')) return { id: 'art_1', auth_method: 'none' };
          if (sql.includes('owner_id FROM artifacts')) return { owner_id: 'usr_1' };
          if (sql.includes('collaborators WHERE artifact_id = ? AND email = ?')) {
            const email = args[1];
            if (email === 'existing@example.com') return { id: 'col_1', role: 'viewer' };
            return null;
          }
          return null;
        },
        all: (sql) => {
          if (sql.includes('FROM collaborators WHERE artifact_id = ?') && !sql.includes('AND email')) {
            return {
              results: [
                { email: 'new@example.com', role: 'editor', added_at: '2024-03-01T00:00:00Z' },
                { email: 'existing@example.com', role: 'editor', added_at: '2024-01-01T00:00:00Z' },
              ],
            };
          }
          return { results: [] };
        },
        run: (sql) => {
          runs.push(sql);
          return { success: true, meta: { changes: 1 } };
        },
      }),
    };

    const response = await handleAddCollaborators(
      new Request('https://shareout.example.com/v1/artifacts/art_1/collaborators', {
        method: 'POST',
        body: JSON.stringify({
          emails: ['not-an-email', 'New@Example.com', 'existing@example.com'],
          role: 'editor',
        }),
      }),
      env,
      user,
      'art_1',
    );

    expect(response.status).toBe(200);
    const body = await jsonBody(response);
    expect(body.success).toBe(true);
    expect(body.added).toEqual(['new@example.com', 'existing@example.com']);
    expect(body.collaborators).toHaveLength(2);
    expect(runs.some((sql) => sql.includes('INSERT INTO collaborators'))).toBe(true);
    expect(runs.some((sql) => sql.includes('UPDATE collaborators SET role'))).toBe(true);
    expect(runs.some((sql) => sql.includes("auth_method = 'google'") || sql.includes('auth_method = ?'))).toBe(true);
  });

  it('does not count unchanged collaborator roles in added', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql, ...args) => {
          if (sql.includes('auth_method FROM artifacts')) return { id: 'art_1', auth_method: 'google' };
          if (sql.includes('owner_id FROM artifacts')) return { owner_id: 'usr_1' };
          if (sql.includes('collaborators WHERE artifact_id = ? AND email = ?')) {
            return { id: 'col_1', role: 'viewer' };
          }
          return null;
        },
        all: () => ({
          results: [{ email: 'same@example.com', role: 'viewer', added_at: '2024-01-01T00:00:00Z' }],
        }),
      }),
    };

    const response = await handleAddCollaborators(
      new Request('https://shareout.example.com/v1/artifacts/art_1/collaborators', {
        method: 'POST',
        body: JSON.stringify({ emails: ['same@example.com'], role: 'viewer' }),
      }),
      env,
      user,
      'art_1',
    );

    expect(response.status).toBe(200);
    expect((await jsonBody(response)).added).toEqual([]);
  });
});

