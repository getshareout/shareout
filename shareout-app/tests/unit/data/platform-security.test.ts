import { afterEach, describe, expect, it, vi } from 'vitest';
import { handlePlatformRequest } from '../../../src/data/platform';
import * as middleware from '../../../src/data/middleware';
import type { DataContext } from '../../../src/data/middleware';
import type { Env } from '../../../src/types';

function makeCtx(): DataContext {
  return {
    artifactId: 'art_test',
    workspaceId: 'wsp_test',
    artifact: {
      id: 'art_test',
      name: 'Test Artifact',
      visibility: 'public',
      auth_method: null,
      workspace_id: 'wsp_test',
    },
    env: {
      DB: {
        prepare: vi.fn(),
      },
    } as unknown as Env,
    origin: 'https://example.com',
  } as DataContext;
}

function request(path: string, body?: unknown): Request {
  return new Request(`https://shareout.example.com/v1/data/art_test/platform/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('platform credential routes', () => {
  it('requires owner auth before listing platform connections', async () => {
    vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(false);

    const response = await handlePlatformRequest(
      new Request('https://shareout.example.com/v1/data/art_test/platform/connections'),
      makeCtx(),
      ['connections'],
    );

    expect(response.status).toBe(403);
  });

  it('forbids preparing direct credentials for a non-owner, non-member', async () => {
    vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(false);
    vi.spyOn(middleware, 'verifyWorkspaceConnectionAccess').mockResolvedValue(false);
    vi.spyOn(middleware, 'verifyPerUserPlatformConnectionQuery').mockResolvedValue('denied');

    const response = await handlePlatformRequest(
      request('google-sheets/prepare', { connectionId: 'conn_1', endpoint: 'spreadsheets.get' }),
      makeCtx(),
      ['google-sheets', 'prepare'],
    );

    expect(response.status).toBe(403);
  });

  it('forbids direct provider execution for a non-owner, non-member', async () => {
    vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(false);
    vi.spyOn(middleware, 'verifyWorkspaceConnectionAccess').mockResolvedValue(false);
    vi.spyOn(middleware, 'verifyPerUserPlatformConnectionQuery').mockResolvedValue('denied');

    const response = await handlePlatformRequest(
      request('google-sheets/spreadsheets.get/execute', { connectionId: 'conn_1', params: {} }),
      makeCtx(),
      ['google-sheets', 'spreadsheets.get', 'execute'],
    );

    expect(response.status).toBe(403);
  });
});
