// @vitest-environment node
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { handleRemoveCollaborator } from '../../../src/artifacts';
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

describe('handleRemoveCollaborator', () => {
  it('returns 404 when artifact is missing', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: () => null }) };

    const response = await handleRemoveCollaborator(
      new Request('https://shareout.example.com/v1/artifacts/art_missing/collaborators', { method: 'DELETE' }),
      env,
      user,
      'art_missing',
      'viewer@example.com',
    );

    expect(response.status).toBe(404);
    expect(await jsonBody(response)).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('returns 403 when user is only a viewer', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('SELECT id FROM artifacts WHERE id')) return { id: 'art_1' };
          if (sql.includes('owner_id FROM artifacts')) return { owner_id: 'usr_other' };
          if (sql.includes('email FROM users')) return { email: 'viewer@example.com' };
          if (sql.includes('role FROM collaborators')) return { role: 'viewer' };
          return null;
        },
      }),
    };

    const response = await handleRemoveCollaborator(
      new Request('https://shareout.example.com/v1/artifacts/art_1/collaborators', { method: 'DELETE' }),
      env,
      { id: 'usr_2', email: 'viewer@example.com', username: null },
      'art_1',
      'Viewer@Example.com',
    );

    expect(response.status).toBe(403);
    expect(await jsonBody(response)).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects removing the owner', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql, ...args) => {
          if (sql.includes('SELECT id FROM artifacts WHERE id')) return { id: 'art_1' };
          if (sql.includes('owner_id FROM artifacts')) return { owner_id: 'usr_1' };
          if (sql.includes('role FROM collaborators WHERE artifact_id = ? AND email = ?')) {
            expect(args[1]).toBe('owner@example.com');
            return { role: 'owner' };
          }
          return null;
        },
      }),
    };

    const response = await handleRemoveCollaborator(
      new Request('https://shareout.example.com/v1/artifacts/art_1/collaborators', { method: 'DELETE' }),
      env,
      user,
      'art_1',
      'Owner@Example.com',
    );

    expect(response.status).toBe(400);
    expect(await jsonBody(response)).toMatchObject({ code: 'CANNOT_REMOVE_OWNER' });
  });

  it('removes collaborator and returns updated list', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql, ...args) => {
          if (sql.includes('SELECT id FROM artifacts WHERE id')) return { id: 'art_1' };
          if (sql.includes('owner_id FROM artifacts')) return { owner_id: 'usr_1' };
          if (sql.includes('role FROM collaborators WHERE artifact_id = ? AND email = ?')) {
            expect(args[1]).toBe('editor@example.com');
            return { role: 'editor' };
          }
          return null;
        },
        all: () => ({
          results: [{ email: 'viewer@example.com', role: 'viewer', added_at: '2024-01-01T00:00:00Z' }],
        }),
        run: () => ({ success: true, meta: { changes: 1 } }),
      }),
    };

    const response = await handleRemoveCollaborator(
      new Request('https://shareout.example.com/v1/artifacts/art_1/collaborators', { method: 'DELETE' }),
      env,
      user,
      'art_1',
      'Editor@Example.com',
    );

    expect(response.status).toBe(200);
    expect(await jsonBody(response)).toEqual({
      success: true,
      removed: true,
      collaborators: [{ email: 'viewer@example.com', role: 'viewer', added_at: '2024-01-01T00:00:00Z' }],
    });
  });

  it('reports removed false when delete changes nothing', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('SELECT id FROM artifacts WHERE id')) return { id: 'art_1' };
          if (sql.includes('owner_id FROM artifacts')) return { owner_id: 'usr_1' };
          if (sql.includes('role FROM collaborators WHERE artifact_id = ? AND email = ?')) return null;
          return null;
        },
        all: () => ({ results: [] }),
        run: () => ({ success: true, meta: { changes: 0 } }),
      }),
    };

    const response = await handleRemoveCollaborator(
      new Request('https://shareout.example.com/v1/artifacts/art_1/collaborators', { method: 'DELETE' }),
      env,
      user,
      'art_1',
      'missing@example.com',
    );

    expect(response.status).toBe(200);
    expect((await jsonBody(response)).removed).toBe(false);
  });
});

