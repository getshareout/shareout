import { describe, expect, it, vi } from 'vitest';
import './helpers/mocks';
import {
  ARTIFACT_ID,
  BASE_URL,
  SLUG,
  assetsEntry,
  createServeEnv,
  defaultDeployment,
  readStreamResponse,
  serveRequest,
} from './helpers/env';
import { cacheStore, setupServeTestHooks } from './helpers/hooks';
import { handleServe } from '../../../src/serve';
import type { Env } from '../../../src/types';
import { createAccessToken } from '../../../src/token';

setupServeTestHooks();

describe('handleServe content origin (ADR 30)', () => {
  const SESSION_SECRET = 'session-secret';

  it('serves private bytes with a valid content capability token and no-store', async () => {
    const { env } = createServeEnv({
      deployment: { ...defaultDeployment, visibility: 'private' },
    });
    const ct = await createAccessToken(ARTIFACT_ID, 'content', { SESSION_SECRET } as Env, 600);
    const response = await handleServe(serveRequest('?_raw'), env, SLUG, '', {
      contentOrigin: true,
      ct,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.text()).toContain('<h1>Hello</h1>');
  });

  it('rejects private bytes when the capability token is missing', async () => {
    const { env } = createServeEnv({
      deployment: { ...defaultDeployment, visibility: 'private' },
    });
    const response = await handleServe(serveRequest('?_raw'), env, SLUG, '', {
      contentOrigin: true,
      ct: null,
    });
    expect(response.status).toBe(403);
  });

  it('rejects a token whose authType is not "content" (e.g. a viewer/data token)', async () => {
    const { env } = createServeEnv({
      deployment: { ...defaultDeployment, visibility: 'private' },
    });
    const viewerToken = await createAccessToken(ARTIFACT_ID, 'viewer', { SESSION_SECRET } as Env, 600);
    const response = await handleServe(serveRequest('?_raw'), env, SLUG, '', {
      contentOrigin: true,
      ct: viewerToken,
    });
    expect(response.status).toBe(403);
  });

  it('fail-closed: gates legacy "workspace" visibility on the content origin (needs a token)', async () => {
    const { env } = createServeEnv({
      deployment: { ...defaultDeployment, visibility: 'workspace' as unknown as 'private' },
    });
    const denied = await handleServe(serveRequest('?_raw'), env, SLUG, '', { contentOrigin: true, ct: null });
    expect(denied.status).toBe(403);

    const ct = await createAccessToken(ARTIFACT_ID, 'content', { SESSION_SECRET } as Env, 600);
    const allowed = await handleServe(serveRequest('?_raw'), env, SLUG, '', { contentOrigin: true, ct });
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('serves public bytes on the content origin without any token', async () => {
    const { env } = createServeEnv();
    const response = await handleServe(serveRequest('?_raw'), env, SLUG, '', {
      contentOrigin: true,
    });
    expect(response.status).toBe(200);
    // Public artifacts may cache freely (a perf win of the cutover).
    expect(response.headers.get('Cache-Control')).not.toBe('private, no-store');
  });
});
