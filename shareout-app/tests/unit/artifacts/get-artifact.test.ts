// @vitest-environment node
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { handleGetArtifact } from '../../../src/artifacts';
import { MODERATION_PENDING_MESSAGE } from '../../../src/publish/deployment';
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

describe('handleGetArtifact', () => {
  it('returns 404 when artifact is missing', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({ first: () => null }),
    };

    const response = await handleGetArtifact(
      new Request('https://shareout.example.com/v1/artifacts/art_missing'),
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
          if (sql.includes('owner_id FROM artifacts') && !sql.includes('description')) {
            return { owner_id: 'usr_other' };
          }
          if (sql.includes('email FROM users')) return { email: 'owner@example.com' };
          if (sql.includes('is_favorite')) return { ...artifactRow, owner_id: 'usr_other' };
          return null;
        },
      }),
    };

    const response = await handleGetArtifact(
      new Request('https://shareout.example.com/v1/artifacts/art_1'),
      env,
      user,
      'art_1',
    );

    expect(response.status).toBe(403);
    expect(await jsonBody(response)).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('returns artifact detail with deploy and embed URLs', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: ownerRoleFirst,
        all: (sql) => {
          if (sql.includes('collaborators')) {
            return { results: [{ email: 'viewer@example.com', role: 'viewer' }] };
          }
          return { results: [] };
        },
      }),
    };

    const response = await handleGetArtifact(
      new Request('https://shareout.example.com/v1/artifacts/art_1'),
      env,
      user,
      'art_1',
    );

    expect(response.status).toBe(200);
    expect(await jsonBody(response)).toMatchObject({
      id: 'art_1',
      name: 'Demo',
      viewers: ['viewer@example.com'],
      url: 'https://shareout.example.com/a/deploy-slug/',
      embed_url: 'https://shareout.example.com/embed/deploy-slug/',
      embed_allowed: true,
      embed_origins: ['https://example.com'],
    });
  });

  it('ignores invalid embed_origins JSON', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql, ...args) => {
          const row = ownerRoleFirst(sql, ...args);
          if (row && typeof row === 'object' && 'embed_origins' in row) {
            return { ...row, embed_origins: 'not-json' };
          }
          return row;
        },
        all: () => ({ results: [] }),
      }),
    };

    const response = await handleGetArtifact(
      new Request('https://shareout.example.com/v1/artifacts/art_1'),
      env,
      user,
      'art_1',
    );

    expect(response.status).toBe(200);
    expect((await jsonBody(response)).embed_origins).toBeNull();
  });

  it('exposes a moderation object to the owner when the artifact is held pending', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql, ...args) => {
          const row = ownerRoleFirst(sql, ...args);
          if (row === artifactRow) {
            return {
              ...row,
              moderation_status: 'pending',
              moderation_reason: 'unknown domain x.com',
              moderation_checked_at: '2026-07-11T00:00:00Z',
            };
          }
          return row;
        },
        all: () => ({ results: [] }),
      }),
    };

    const response = await handleGetArtifact(
      new Request('https://shareout.example.com/v1/artifacts/art_1'),
      env,
      user,
      'art_1',
    );

    expect(response.status).toBe(200);
    expect((await jsonBody(response)).moderation).toEqual({
      status: 'pending',
      reason: 'unknown domain x.com',
      checked_at: '2026-07-11T00:00:00Z',
      message: MODERATION_PENDING_MESSAGE,
    });
  });

  it('omits moderation for an approved artifact', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql, ...args) => {
          const row = ownerRoleFirst(sql, ...args);
          if (row === artifactRow) return { ...row, moderation_status: 'approved' };
          return row;
        },
        all: () => ({ results: [] }),
      }),
    };

    const response = await handleGetArtifact(
      new Request('https://shareout.example.com/v1/artifacts/art_1'),
      env,
      user,
      'art_1',
    );

    expect(response.status).toBe(200);
    expect((await jsonBody(response)).moderation).toBeUndefined();
  });

  it('hides the moderation object from a plain viewer', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('owner_id FROM artifacts') && !sql.includes('description')) {
            return { owner_id: 'usr_other' };
          }
          if (sql.includes('email FROM users')) return { email: 'viewer@example.com' };
          if (sql.includes('role FROM collaborators')) return { role: 'viewer' };
          if (sql.includes('is_favorite')) {
            return {
              ...artifactRow,
              owner_id: 'usr_other',
              moderation_status: 'pending',
              moderation_reason: 'x',
              moderation_checked_at: 't',
            };
          }
          return null;
        },
        all: () => ({ results: [] }),
      }),
    };

    const response = await handleGetArtifact(
      new Request('https://shareout.example.com/v1/artifacts/art_1'),
      env,
      { id: 'usr_2', email: 'viewer@example.com', username: null },
      'art_1',
    );

    expect(response.status).toBe(200);
    expect((await jsonBody(response)).moderation).toBeUndefined();
  });
});

