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
import { handleServeText } from '../../../src/serve';

setupServeTestHooks();

describe('handleServeText', () => {
  it('returns plain text extracted from HTML with front matter', async () => {
    const { env } = createServeEnv();
    const response = await handleServeText(serveRequest('text'), env, SLUG);
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/plain');
    expect(text).toContain('title: Demo App');
    expect(text).toContain('slug: demo-app');
    expect(text).toContain('Hello');
    expect(text).not.toContain('<script>');
  });

  it('returns 503 when artifact is paused', async () => {
    const { env } = createServeEnv({
      deployment: { ...defaultDeployment, paused: 1 },
    });
    const response = await handleServeText(serveRequest('text'), env, SLUG);
    expect(response.status).toBe(503);
  });

  it('returns 401 for private artifacts without access', async () => {
    const { env } = createServeEnv({
      deployment: { ...defaultDeployment, visibility: 'private' },
    });
    const response = await handleServeText(serveRequest('text'), env, SLUG);
    expect(response.status).toBe(401);
  });

  it('returns 404 when R2 object is missing', async () => {
    const { env } = createServeEnv({ r2: {} });
    const response = await handleServeText(serveRequest('text'), env, SLUG);
    expect(response.status).toBe(404);
  });
});
