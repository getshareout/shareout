/**
 * Index router test suite: publish artifacts.
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

export function registerPublishArtifactsTests(handlers: HandlerMocks): void {
describe('index router — publish and artifacts', () => {
  it('dispatches publish POST', async () => {
    const response = await fetchPath('/v1/publish', { method: 'POST', body: '{}' });
    expect(await handlerTag(response)).toBe('handlePublish');
  });

  it('guards artifact routes without auth', async () => {
    const response = await fetchPath('/v1/artifacts/art_1', { method: 'GET' });
    expect(response.status).toBe(401);
  });

  it('dispatches artifact CRUD and nested routes', async () => {
    const id = 'art_1';
    expect(await handlerTag(await fetchPath('/v1/artifacts', authed()))).toBe('handleListArtifacts');
    expect(await handlerTag(await fetchPath(`/v1/artifacts/${id}`, authed()))).toBe('handleGetArtifact');
    expect(await handlerTag(await fetchPath(`/v1/artifacts/${id}`, authed({ method: 'PUT', body: '{}' })))).toBe('handleUpdateArtifact');
    expect(await handlerTag(await fetchPath(`/v1/artifacts/${id}`, authed({ method: 'DELETE' })))).toBe('handleDeleteArtifact');
    expect(await handlerTag(await fetchPath(`/v1/artifacts/${id}/collaborators`, authed()))).toBe('handleGetCollaborators');
    expect(await handlerTag(await fetchPath(`/v1/artifacts/${id}/collaborators`, authed({ method: 'POST', body: '{}' })))).toBe('handleAddCollaborators');
    expect(await handlerTag(await fetchPath(`/v1/artifacts/${id}/collaborators/user%40example.com`, authed({ method: 'DELETE' })))).toBe('handleRemoveCollaborator');
    expect(await handlerTag(await fetchPath(`/v1/artifacts/${id}/transfer-ownership`, authed({ method: 'POST', body: '{}' })))).toBe('handleTransferOwnership');
    expect(await handlerTag(await fetchPath(`/v1/artifacts/${id}/versions`, authed()))).toBe('handleGetVersions');
    expect(await handlerTag(await fetchPath(`/v1/artifacts/${id}/files`, authed()))).toBe('handleGetArtifactFiles');
    expect(await handlerTag(await fetchPath(`/v1/artifacts/${id}/rollback`, authed({ method: 'POST', body: '{}' })))).toBe('handleRollback');
    expect(await handlerTag(await fetchPath(`/v1/artifacts/${id}/email`, authed({ method: 'POST', body: '{}' })))).toBe('handleCreateArtifactEmail');
    expect(await handlerTag(await fetchPath(`/v1/artifacts/${id}/email`, authed()))).toBe('handleGetArtifactEmail');
  });

  it('returns analytics for artifact owners', async () => {
    const env = createEnv((sql) => {
      if (sql.includes('owner_id, workspace_id FROM artifacts')) return { owner_id: 'usr_1', workspace_id: null };
      return null;
    });
    const response = await fetchPath('/v1/artifacts/art_1/analytics?days=90', authed(), APEX, env);
    expect(response.status).toBe(200);
    const body = await response.json() as { views: number };
    expect(body.views).toBe(42);
    expect(handlers.getAnalytics).toHaveBeenCalledWith(env, 'art_1', 30);
  });

  it('returns 404 analytics when artifact missing', async () => {
    const response = await fetchPath('/v1/artifacts/missing/analytics', authed());
    expect(response.status).toBe(404);
  });

  it('returns 403 analytics for non-collaborators', async () => {
    const env = createEnv((sql) => {
      if (sql.includes('owner_id, workspace_id FROM artifacts')) return { owner_id: 'other-user', workspace_id: null };
      if (sql.includes('FROM collaborators')) return null;
      return null;
    });
    const response = await fetchPath('/v1/artifacts/art_1/analytics', authed(), APEX, env);
    expect(response.status).toBe(403);
  });

  it('dispatches editor API when user is owner', async () => {
    const env = createEnv((sql) => {
      if (sql.includes('FROM artifacts WHERE id')) {
        return { id: 'art_1', owner_id: 'usr_1', name: 'Demo', slug: 'demo' };
      }
      if (sql.includes('FROM users WHERE id')) return { name: 'Owner', picture: null };
      return null;
    });
    const response = await fetchPath('/v1/artifacts/art_1/editor/pages', authed(), APEX, env);
    expect(await handlerTag(response)).toBe('handleEditor');
  });

  it('denies editor API for viewers', async () => {
    const env = createEnv((sql) => {
      if (sql.includes('FROM artifacts WHERE id')) {
        return { id: 'art_1', owner_id: 'other', name: 'Demo', slug: 'demo' };
      }
      if (sql.includes('FROM collaborators')) return { role: 'viewer' };
      if (sql.includes('FROM users WHERE id')) return { name: 'Viewer', picture: null };
      return null;
    });
    const response = await fetchPath('/v1/artifacts/art_1/editor/pages', authed(), APEX, env);
    expect(response.status).toBe(403);
  });

  it('accepts session auth for artifact listing via getAuthUser', async () => {
    handlers.validateToken.mockResolvedValueOnce(null);
    handlers.getSessionUser.mockResolvedValueOnce({ id: 'usr_1', email: 'owner@example.com' });
    const response = await fetchPath('/v1/artifacts', { headers: { Cookie: 'session=valid' } });
    expect(await handlerTag(response)).toBe('handleListArtifacts');
  });
});
}
