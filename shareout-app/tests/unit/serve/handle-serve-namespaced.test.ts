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
});
