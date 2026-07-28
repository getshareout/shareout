// @vitest-environment node
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { handleGetVersions } from '../../../src/artifacts';
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

describe('handleGetVersions', () => {
  it('returns 404 when artifact is missing', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: () => null }) };

    const response = await handleGetVersions(
      new Request('https://shareout.example.com/v1/artifacts/art_missing/versions'),
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

    const response = await handleGetVersions(
      new Request('https://shareout.example.com/v1/artifacts/art_1/versions'),
      env,
      user,
      'art_1',
    );

    expect(response.status).toBe(403);
    expect(await jsonBody(response)).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('returns version list for viewers and owners', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('SELECT id FROM artifacts WHERE id')) return { id: 'art_1' };
          if (sql.includes('owner_id FROM artifacts')) return { owner_id: 'usr_1' };
          return null;
        },
        all: (sql) => {
          if (sql.includes('FROM versions')) {
            return {
              results: [
                { id: 'ver_2', version_no: 2, entrypoint: 'index.html', created_at: '2024-02-01T00:00:00Z' },
                { id: 'ver_1', version_no: 1, entrypoint: 'index.html', created_at: '2024-01-01T00:00:00Z' },
              ],
            };
          }
          return { results: [] };
        },
      }),
    };

    const response = await handleGetVersions(
      new Request('https://shareout.example.com/v1/artifacts/art_1/versions'),
      env,
      user,
      'art_1',
    );

    expect(response.status).toBe(200);
    expect(await jsonBody(response)).toEqual({
      versions: [
        { id: 'ver_2', version_no: 2, entrypoint: 'index.html', created_at: '2024-02-01T00:00:00Z' },
        { id: 'ver_1', version_no: 1, entrypoint: 'index.html', created_at: '2024-01-01T00:00:00Z' },
      ],
    });
  });
});

