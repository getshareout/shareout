// @vitest-environment node
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { handleGetCollaborators } from '../../../src/artifacts';
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

describe('handleGetCollaborators', () => {
  it('returns 404 when artifact is missing', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: () => null }) };

    const response = await handleGetCollaborators(
      new Request('https://shareout.example.com/v1/artifacts/art_missing/collaborators'),
      env,
      user,
      'art_missing',
    );

    expect(response.status).toBe(404);
    expect(await jsonBody(response)).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('returns 403 when user lacks viewer access', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('SELECT id FROM artifacts WHERE id')) return { id: 'art_1' };
          if (sql.includes('owner_id FROM artifacts')) return { owner_id: 'usr_other' };
          if (sql.includes('email FROM users')) return { email: 'stranger@example.com' };
          return null;
        },
      }),
    };

    const response = await handleGetCollaborators(
      new Request('https://shareout.example.com/v1/artifacts/art_1/collaborators'),
      env,
      user,
      'art_1',
    );

    expect(response.status).toBe(403);
    expect(await jsonBody(response)).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('returns collaborators ordered by added_at', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('SELECT id FROM artifacts WHERE id')) return { id: 'art_1' };
          if (sql.includes('owner_id FROM artifacts')) return { owner_id: 'usr_1' };
          return null;
        },
        all: (sql) => {
          if (sql.includes('added_at FROM collaborators')) {
            return {
              results: [
                { email: 'editor@example.com', role: 'editor', added_at: '2024-02-01T00:00:00Z' },
                { email: 'viewer@example.com', role: 'viewer', added_at: '2024-01-01T00:00:00Z' },
              ],
            };
          }
          return { results: [] };
        },
      }),
    };

    const response = await handleGetCollaborators(
      new Request('https://shareout.example.com/v1/artifacts/art_1/collaborators'),
      env,
      user,
      'art_1',
    );

    expect(response.status).toBe(200);
    expect(await jsonBody(response)).toEqual({
      collaborators: [
        { email: 'editor@example.com', role: 'editor', added_at: '2024-02-01T00:00:00Z' },
        { email: 'viewer@example.com', role: 'viewer', added_at: '2024-01-01T00:00:00Z' },
      ],
    });
  });
});

