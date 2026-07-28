/**
 * Index router test suite: artifact serving.
 * Registered from `index.test.ts` so Vitest hoists `vi.mock` in the entry file.
 */
import { describe, expect, it, vi } from 'vitest';
import type { HandlerMocks } from '../handlers';
import {
  APEX,
  SUB,
  authed,
  createEnv,
  fetchPath,
  handlerTag,
  githubState,
  sheetsState,
} from '../fixtures';

export function registerArtifactServingTests(handlers: HandlerMocks): void {
describe('index router — artifact serving paths', () => {
  it('dispatches text extraction and admin routes', async () => {
    expect(await handlerTag(await fetchPath('/a/demo/_text'))).toBe('handleServeText');
    expect(await handlerTag(await fetchPath('/a/demo/admin'))).toBe('handleAdminPage');
  });

  it('dispatches PWA asset routes under /a/{slug}', async () => {
    expect(await handlerTag(await fetchPath('/a/demo/manifest.json'))).toBe('handleManifest');
    expect(await handlerTag(await fetchPath('/a/demo/sw.js'))).toBe('handleServiceWorker');
    expect(await handlerTag(await fetchPath('/a/demo/_pwa/icon-192.png'))).toBe('handlePWAIcon');
    expect(await handlerTag(await fetchPath('/a/demo/_pwa/screenshot-mobile.png'))).toBe('handlePWAScreenshot');
  });

  it('redirects unauthenticated visual editor to Google login', async () => {
    const env = createEnv((sql) => {
      if (sql.includes('JOIN deployments')) {
        return { id: 'art_1', slug: 'demo', owner_id: 'usr_9', visibility: 'private', name: 'Demo', description: null };
      }
      return null;
    });
    const response = await fetchPath('/a/demo/edit', undefined, APEX, env);
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toContain('/auth/login?redirect=/a/demo/edit');
  });

  it('serves editor page for authorized owners', async () => {
    handlers.getSessionUser.mockResolvedValueOnce({ id: 'usr_1', email: 'owner@example.com' });
    const env = createEnv((sql) => {
      if (sql.includes('JOIN deployments')) {
        return { id: 'art_1', slug: 'demo', owner_id: 'usr_1', visibility: 'private', name: 'Demo', description: 'Desc' };
      }
      if (sql.includes('FROM users WHERE id')) return { name: 'Owner', picture: 'pic.png' };
      return null;
    });
    const response = await fetchPath('/a/demo/edit', {
      headers: { Cookie: 'session=valid' },
    }, APEX, env);
    expect(await handlerTag(response)).toBe('serveEditorPage');
  });

  it('serves editor page via session cookie when bearer token is absent', async () => {
    handlers.validateToken.mockResolvedValueOnce(null);
    handlers.getSessionUser.mockResolvedValueOnce({ id: 'usr_1', email: 'owner@example.com' });
    const env = createEnv((sql) => {
      if (sql.includes('JOIN deployments')) {
        return { id: 'art_1', slug: 'demo', owner_id: 'usr_1', visibility: 'private', name: 'Demo', description: null };
      }
      if (sql.includes('FROM users WHERE id')) return { name: 'Owner', picture: null };
      return null;
    });
    const response = await fetchPath('/a/demo/edit', {
      headers: { Cookie: 'session=valid' },
    }, APEX, env);
    expect(await handlerTag(response)).toBe('serveEditorPage');
  });

  it('dispatches /a/, /p/, and /embed/ slug serving', async () => {
    expect(await handlerTag(await fetchPath('/a/demo/assets/app.js'))).toBe('handleServe');
    expect(await handlerTag(await fetchPath('/p/demo/slide-1'))).toBe('handleServe');
    expect(await handlerTag(await fetchPath('/embed/demo/view'))).toBe('handleServeEmbed');
  });

  it('parses namespaced /@ workspace paths', async () => {
    expect(await handlerTag(await fetchPath('/@acme/reports/q4'))).toBe('handleServeNamespaced');
    expect(handlers.handleServeNamespaced).toHaveBeenLastCalledWith(
      expect.any(Request),
      expect.any(Object),
      'acme',
      'reports',
      'q4',
      '',
      undefined,
    );

    expect(await handlerTag(await fetchPath('/@acme/docs/guide.html'))).toBe('handleServeNamespaced');
    expect(handlers.handleServeNamespaced).toHaveBeenLastCalledWith(
      expect.any(Request),
      expect.any(Object),
      'acme',
      '',
      'docs',
      'guide.html',
      undefined,
    );

    expect(await handlerTag(await fetchPath('/@acme/guide.html'))).toBe('handleServeNamespaced');
    expect(handlers.handleServeNamespaced).toHaveBeenLastCalledWith(
      expect.any(Request),
      expect.any(Object),
      'acme',
      '',
      'guide.html',
      '',
      undefined,
    );
  });

  it('returns 404 for visual editor when artifact is missing', async () => {
    const response = await fetchPath('/a/missing/edit', authed());
    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe('Artifact not found');
  });

  it('allows visual editor for collaborator with owner role via email', async () => {
    handlers.validateToken.mockResolvedValueOnce({
      id: 'usr_2',
      email: 'collab@example.com',
      username: 'collab',
    });
    const env = createEnv((sql) => {
      if (sql.includes('JOIN deployments')) {
        return { id: 'art_1', slug: 'demo', owner_id: 'usr_9', visibility: 'private', name: 'Demo', description: null };
      }
      if (sql.includes('FROM collaborators')) return { role: 'owner' };
      if (sql.includes('FROM users WHERE id')) return { name: 'Collab', picture: null };
      return null;
    });
    const response = await fetchPath('/a/demo/edit', authed(), APEX, env);
    expect(await handlerTag(response)).toBe('serveEditorPage');
  });
});
}
