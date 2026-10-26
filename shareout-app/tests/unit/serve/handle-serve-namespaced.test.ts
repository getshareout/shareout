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
import { handleServeNamespaced } from '../../../src/serve';

setupServeTestHooks();

describe('handleServeNamespaced', () => {
  it('returns 404 when namespaced artifact is not found', async () => {
    const { env } = createServeEnv({ namespaced: null, deployment: null });
    const response = await handleServeNamespaced(
      serveRequest(''),
      env,
      'acme',
      '',
      'missing',
      '',
    );
    expect(response.status).toBe(404);
  });

  it('returns 404 when folder path does not match artifact location', async () => {
    const { env } = createServeEnv({
      namespaced: {
        workspaceSlug: 'acme',
        artifactSlug: 'demo',
        deploySlug: SLUG,
        folderPath: 'reports/q1',
        artifactFolderId: 'folder_leaf',
        folderChain: [{ slug: 'reports', parent_id: null }],
      },
    });

    const response = await handleServeNamespaced(
      serveRequest(''),
      env,
      'acme',
      'reports/q1',
      'demo',
      '',
    );
    expect(response.status).toBe(404);
  });

  it('serves artifact when folder path matches', async () => {
    const { env } = createServeEnv({
      namespaced: {
        workspaceSlug: 'acme',
        artifactSlug: 'demo',
        deploySlug: SLUG,
        folderPath: 'reports',
        artifactFolderId: 'folder_leaf',
        folderChain: [{ slug: 'reports', parent_id: null }],
      },
    });

    const response = await handleServeNamespaced(
      serveRequest(''),
      env,
      'acme',
      'reports',
      'demo',
      '',
    );
    expect(response.status).toBe(200);
  });

  const htmlNav = { headers: { Accept: 'text/html', 'Accept-Language': 'es-AR,es;q=0.9' } };

  it('renders the styled 404 for browser navigations to a missing artifact', async () => {
    const { env } = createServeEnv({ namespaced: null, deployment: null });
    const response = await handleServeNamespaced(serveRequest('', htmlNav), env, 'acme', '', 'missing', '');
    expect(response.status).toBe(404);
    expect(response.headers.get('Content-Type')).toContain('text/html');
    const html = await response.text();
    expect(html).toContain('Esta página se perdió');
    expect(html).not.toContain('missing');
  });

  it('renders the same styled 404 for a wrong folder path (no existence leak)', async () => {
    const { env } = createServeEnv({
      namespaced: {
        workspaceSlug: 'acme', artifactSlug: 'demo', deploySlug: SLUG, folderPath: 'reports/q1',
        artifactFolderId: 'folder_leaf', folderChain: [{ slug: 'reports', parent_id: null }],
      },
    });
    const response = await handleServeNamespaced(serveRequest('', htmlNav), env, 'acme', 'reports/q1', 'demo', '');
    expect(response.status).toBe(404);
    expect(await response.text()).toContain('Esta página se perdió');
  });

  it('keeps plain text for non-HTML fetches', async () => {
    const { env } = createServeEnv({ namespaced: null, deployment: null });
    const response = await handleServeNamespaced(serveRequest(''), env, 'acme', '', 'missing', '');
    expect(await response.text()).toBe('Not Found');
  });
});
