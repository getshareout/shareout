/**
 * Index router test suite: workspaces folders.
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

export function registerWorkspacesFoldersTests(handlers: HandlerMocks): void {
describe('index router — workspaces and folders', () => {
  it('dispatches workspace collection and member routes', async () => {
    expect(await handlerTag(await fetchPath('/v1/workspaces', authed()))).toBe('handleListWorkspaces');
    expect(await handlerTag(await fetchPath('/v1/workspaces', authed({ method: 'POST', body: '{}' })))).toBe('handleCreateWorkspace');
    expect(await handlerTag(await fetchPath('/v1/workspaces/by-slug/acme', authed()))).toBe('handleGetWorkspaceBySlug');
    expect(await handlerTag(await fetchPath('/v1/workspaces/ws_1', authed()))).toBe('handleGetWorkspace');
    expect(await handlerTag(await fetchPath('/v1/workspaces/ws_1', authed({ method: 'PATCH', body: '{}' })))).toBe('handleUpdateWorkspace');
    expect(await handlerTag(await fetchPath('/v1/workspaces/ws_1', authed({ method: 'DELETE' })))).toBe('handleDeleteWorkspace');
    expect(await handlerTag(await fetchPath('/v1/workspaces/ws_1/members', authed()))).toBe('handleListWorkspaceMembers');
    expect(await handlerTag(await fetchPath('/v1/workspaces/ws_1/members', authed({ method: 'POST', body: '{}' })))).toBe('handleAddWorkspaceMember');
    expect(await handlerTag(await fetchPath('/v1/workspaces/ws_1/members/usr_2', authed({ method: 'DELETE' })))).toBe('handleRemoveWorkspaceMember');
    expect(await handlerTag(await fetchPath('/v1/workspaces/ws_1/transfer-ownership', authed({ method: 'POST', body: '{}' })))).toBe('handleTransferWorkspaceOwnership');
  });

  it('dispatches folder routes and move artifact', async () => {
    expect(await handlerTag(await fetchPath('/v1/workspaces/ws_1/folders', authed()))).toBe('handleListFolders');
    expect(await handlerTag(await fetchPath('/v1/workspaces/ws_1/folders', authed({ method: 'POST', body: '{}' })))).toBe('handleCreateFolder');
    expect(await handlerTag(await fetchPath('/v1/workspaces/ws_1/folders/by-path/docs%2Fguides', authed()))).toBe('handleGetFolderByPath');
    expect(await handlerTag(await fetchPath('/v1/workspaces/ws_1/folders/fol_1', authed()))).toBe('handleGetFolder');
    expect(await handlerTag(await fetchPath('/v1/workspaces/ws_1/folders/fol_1', authed({ method: 'PUT', body: '{}' })))).toBe('handleUpdateFolder');
    expect(await handlerTag(await fetchPath('/v1/workspaces/ws_1/folders/fol_1', authed({ method: 'DELETE' })))).toBe('handleDeleteFolder');
    expect(await handlerTag(await fetchPath('/v1/workspaces/ws_1/artifacts/art_1/move', authed({ method: 'POST', body: '{}' })))).toBe('handleMoveArtifactToFolder');
  });
});
}
