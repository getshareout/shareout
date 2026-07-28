// @vitest-environment node
import './setup';
import { describe, expect, it, vi } from 'vitest';

// Force the public-transition safety path into a held verdict so the PATCH 202
// MODERATION_HELD body can be pinned. Only the visibility→public branch touches
// these; the other tests here use private/no-visibility and never hit them.
vi.mock('../../../src/moderation/check', () => ({
  classifyAndPersist: vi.fn(async () => 'pending'),
  clearModerationHold: vi.fn(async () => {}),
  findBlockedCdnHosts: vi.fn(async () => []),
}));
vi.mock('../../../src/quota', () => ({
  canAddPublicArtifact: vi.fn(async () => ({ allowed: true, max: 10 })),
}));
vi.mock('../../../src/access/allow-open', () => ({
  resolveAllowOpen: vi.fn(async () => true),
  OPEN_VISIBILITY_PAYWALL_MESSAGE: 'paywall',
}));
vi.mock('../../../src/publish-approval', () => ({
  getWorkspacePublishPolicy: vi.fn(async () => ({ policy: 'allow', approvalsRequired: 0 })),
  hasApprovedPublish: vi.fn(async () => true),
  getArtifactContentHash: vi.fn(async () => 'h'),
}));

import { handleUpdateArtifact } from '../../../src/artifacts';
import { clearModerationHold } from '../../../src/moderation/check';
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

describe('handleUpdateArtifact', () => {
  it('returns 404 when artifact is missing', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({ first: () => null }),
    };

    const response = await handleUpdateArtifact(
      new Request('https://shareout.example.com/v1/artifacts/art_missing', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'New' }),
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
          if (sql.includes('SELECT id, workspace_id FROM artifacts')) return { id: 'art_1', workspace_id: null };
          if (sql.includes('SELECT id FROM artifacts')) return { id: 'art_1' };
          if (sql.includes('owner_id FROM artifacts')) return { owner_id: 'usr_other' };
          if (sql.includes('email FROM users')) return { email: 'viewer@example.com' };
          if (sql.includes('role FROM collaborators')) return { role: 'viewer' };
          return null;
        },
      }),
    };

    const response = await handleUpdateArtifact(
      new Request('https://shareout.example.com/v1/artifacts/art_1', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'New' }),
      }),
      env,
      { id: 'usr_2', email: 'viewer@example.com', username: null },
      'art_1',
    );

    expect(response.status).toBe(403);
    expect(await jsonBody(response)).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects invalid JSON, visibility, and empty updates', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('SELECT id, workspace_id FROM artifacts')) return { id: 'art_1', workspace_id: null };
          if (sql.includes('SELECT id FROM artifacts')) return { id: 'art_1' };
          if (sql.includes('owner_id FROM artifacts')) return { owner_id: 'usr_1' };
          return null;
        },
      }),
    };

    const badJson = await handleUpdateArtifact(
      new Request('https://shareout.example.com/v1/artifacts/art_1', { method: 'PATCH', body: '{' }),
      env,
      user,
      'art_1',
    );
    expect(badJson.status).toBe(400);
    expect(await jsonBody(badJson)).toMatchObject({ code: 'INVALID_JSON' });

    const badVisibility = await handleUpdateArtifact(
      new Request('https://shareout.example.com/v1/artifacts/art_1', {
        method: 'PATCH',
        body: JSON.stringify({ visibility: 'secret' }),
      }),
      env,
      user,
      'art_1',
    );
    expect(badVisibility.status).toBe(400);
    expect(await jsonBody(badVisibility)).toMatchObject({ code: 'INVALID_VISIBILITY' });

    const noUpdates = await handleUpdateArtifact(
      new Request('https://shareout.example.com/v1/artifacts/art_1', {
        method: 'PATCH',
        body: JSON.stringify({}),
      }),
      env,
      user,
      'art_1',
    );
    expect(noUpdates.status).toBe(400);
    expect(await jsonBody(noUpdates)).toMatchObject({ code: 'NO_UPDATES' });
  });

  it('updates fields, clears slug cache, and returns refreshed artifact', async () => {
    const slugs = makeSlugsMock();
    const env = {
      ...baseEnv,
      SLUGS: slugs,
      DB: makeDbMock({
        first: ownerRoleFirst,
        all: () => ({ results: [] }),
        run: () => ({ success: true }),
      }),
    };

    const response = await handleUpdateArtifact(
      new Request('https://shareout.example.com/v1/artifacts/art_1', {
        method: 'PATCH',
        body: JSON.stringify({
          name: 'Updated',
          description: '',
          visibility: 'private',
          paused: true,
          embed_allowed: false,
          embed_origins: null,
        }),
      }),
      env,
      user,
      'art_1',
    );

    expect(response.status).toBe(200);
    expect(slugs.delete).toHaveBeenCalledWith('deploy:deploy-slug');
    expect(env.DB.prepare).toHaveBeenCalled();
    // Explicit non-public choice drops any held-from-public marker (F1).
    expect(vi.mocked(clearModerationHold)).toHaveBeenCalledWith(env, 'art_1');
  });

  it('returns a 202 MODERATION_HELD body when a public transition is held', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('SELECT id, workspace_id, owner_id FROM artifacts')) {
            return { id: 'art_1', workspace_id: null, owner_id: 'usr_1' };
          }
          if (sql.includes('owner_id FROM artifacts')) return { owner_id: 'usr_1' };
          if (sql.includes('reason FROM artifact_moderation')) {
            return { reason: 'unknown domain x.com' };
          }
          return null;
        },
        all: () => ({ results: [] }),
        run: () => ({ success: true }),
      }),
    };

    const response = await handleUpdateArtifact(
      new Request('https://shareout.example.com/v1/artifacts/art_1', {
        method: 'PATCH',
        body: JSON.stringify({ visibility: 'public' }),
      }),
      env,
      user,
      'art_1',
    );

    expect(response.status).toBe(202);
    expect(await jsonBody(response)).toEqual({
      moderation_status: 'pending',
      reason: 'unknown domain x.com',
      message: MODERATION_PENDING_MESSAGE,
      code: 'MODERATION_HELD',
    });
  });
});

