/**
 * Factory for mocked worker handler stubs used by index router integration tests.
 * The live mock instances are created inside `vi.hoisted()` in `index.test.ts`.
 * @module tests/unit/index-router/handlers
 */
import { vi } from 'vitest';

export const mockResponse = (tag: string, status = 200) =>
  new Response(JSON.stringify({ handler: tag }), {
    status,
    headers: { 'Content-Type': 'application/json', 'X-Mock-Handler': tag },
  });

export type HandlerMocks = ReturnType<typeof createHandlerMocks>;

export function createHandlerMocks() {
  return {
    handlePublish: vi.fn(() => mockResponse('handlePublish', 201)),
    handleServe: vi.fn(() => mockResponse('handleServe')),
    handleServeText: vi.fn(() => mockResponse('handleServeText')),
    handleServeNamespaced: vi.fn(() => mockResponse('handleServeNamespaced')),
    handleServeEmbed: vi.fn(() => mockResponse('handleServeEmbed')),
    handleGoogleLogin: vi.fn(() => new Response(null, { status: 302, headers: { Location: '/auth/google' } })),
    handleGoogleCallback: vi.fn(() => mockResponse('handleGoogleCallback')),
    handleLogout: vi.fn(() => mockResponse('handleLogout')),
    handlePasswordAuth: vi.fn(() => mockResponse('handlePasswordAuth')),
    handleCredentialsAuth: vi.fn(() => mockResponse('handleCredentialsAuth')),
    handleLinkGoogleStart: vi.fn(() => new Response(null, { status: 302, headers: { Location: '/link-google' } })),
    handleDevLogin: vi.fn(() => mockResponse('handleDevLogin')),
    getSessionUser: vi.fn(async () => null),
    handleCreateAccount: vi.fn(() => mockResponse('handleCreateAccount', 201)),
    handleLinkEmail: vi.fn(() => mockResponse('handleLinkEmail')),
    handleGetProfile: vi.fn(() => mockResponse('handleGetProfile')),
    handleUpdateProfile: vi.fn(() => mockResponse('handleUpdateProfile')),
    handleCreateAdminSession: vi.fn(() => mockResponse('handleCreateAdminSession')),
    validateToken: vi.fn(async (request: Request) => {
      const auth = request.headers.get('Authorization');
      if (auth === 'Bearer valid-token') {
        return { id: 'usr_1', email: 'owner@example.com', username: 'owner' };
      }
      return null;
    }),
    checkAccountCreation: vi.fn(async () => ({
      allowed: true,
      limit: 10,
      remaining: 9,
      reset: Date.now() + 60_000,
    })),
    rateLimitResponse: vi.fn(() => new Response(JSON.stringify({ error: 'Rate limited' }), { status: 429 })),
    rateLimitHeaders: vi.fn(() => ({ 'X-RateLimit-Remaining': '0' })),
    getClientIp: vi.fn(() => '203.0.113.10'),
    handleAdminPage: vi.fn(() => mockResponse('handleAdminPage')),
    getAnalytics: vi.fn(async () => ({ views: 42 })),
    handleListArtifacts: vi.fn(() => mockResponse('handleListArtifacts')),
    handleGetArtifact: vi.fn(() => mockResponse('handleGetArtifact')),
    handleUpdateArtifact: vi.fn(() => mockResponse('handleUpdateArtifact')),
    handleDeleteArtifact: vi.fn(() => mockResponse('handleDeleteArtifact')),
    handleGetCollaborators: vi.fn(() => mockResponse('handleGetCollaborators')),
    handleAddCollaborators: vi.fn(() => mockResponse('handleAddCollaborators')),
    handleRemoveCollaborator: vi.fn(() => mockResponse('handleRemoveCollaborator')),
    handleTransferOwnership: vi.fn(() => mockResponse('handleTransferOwnership')),
    handleGetVersions: vi.fn(() => mockResponse('handleGetVersions')),
    handleRollback: vi.fn(() => mockResponse('handleRollback')),
    handleGetArtifactFiles: vi.fn(() => mockResponse('handleGetArtifactFiles')),
    handleListWorkspaces: vi.fn(() => mockResponse('handleListWorkspaces')),
    handleCreateWorkspace: vi.fn(() => mockResponse('handleCreateWorkspace', 201)),
    handleGetWorkspace: vi.fn(() => mockResponse('handleGetWorkspace')),
    handleGetWorkspaceBySlug: vi.fn(() => mockResponse('handleGetWorkspaceBySlug')),
    handleUpdateWorkspace: vi.fn(() => mockResponse('handleUpdateWorkspace')),
    handleDeleteWorkspace: vi.fn(() => mockResponse('handleDeleteWorkspace')),
    handleListWorkspaceMembers: vi.fn(() => mockResponse('handleListWorkspaceMembers')),
    handleAddWorkspaceMember: vi.fn(() => mockResponse('handleAddWorkspaceMember')),
    handleRemoveWorkspaceMember: vi.fn(() => mockResponse('handleRemoveWorkspaceMember')),
    handleTransferWorkspaceOwnership: vi.fn(() => mockResponse('handleTransferWorkspaceOwnership')),
    handleListFolders: vi.fn(() => mockResponse('handleListFolders')),
    handleCreateFolder: vi.fn(() => mockResponse('handleCreateFolder', 201)),
    handleGetFolder: vi.fn(() => mockResponse('handleGetFolder')),
    handleGetFolderByPath: vi.fn(() => mockResponse('handleGetFolderByPath')),
    handleUpdateFolder: vi.fn(() => mockResponse('handleUpdateFolder')),
    handleDeleteFolder: vi.fn(() => mockResponse('handleDeleteFolder')),
    handleMoveArtifactToFolder: vi.fn(() => mockResponse('handleMoveArtifactToFolder')),
    handleDataRequest: vi.fn(() => mockResponse('handleDataRequest')),
    handleSheetsOAuthCallback: vi.fn(() => mockResponse('handleSheetsOAuthCallback')),
    handleGitHubOAuthCallback: vi.fn(() => mockResponse('handleGitHubOAuthCallback')),
    handleGetSkill: vi.fn(() => mockResponse('handleGetSkill')),
    handleGetSkillVersion: vi.fn(() => mockResponse('handleGetSkillVersion')),
    handleGetSkillMeta: vi.fn(() => mockResponse('handleGetSkillMeta')),
    handleServeSDK: vi.fn(() => mockResponse('handleServeSDK')),
    handleServeEditor: vi.fn(() => mockResponse('handleServeEditor')),
    handleServeMobileSDK: vi.fn(() => mockResponse('handleServeMobileSDK')),
    handleServeChartsSDK: vi.fn(() => mockResponse('handleServeChartsSDK')),
    handleServeArtifactCSS: vi.fn(() => mockResponse('handleServeArtifactCSS')),
    handleServeArtifactUI: vi.fn(() => mockResponse('handleServeArtifactUI')),
    handleCreateJob: vi.fn(() => mockResponse('handleCreateJob', 201)),
    handleListJobs: vi.fn(() => mockResponse('handleListJobs')),
    handleGetJob: vi.fn(() => mockResponse('handleGetJob')),
    handleUpdateJob: vi.fn(() => mockResponse('handleUpdateJob')),
    handleDeleteJob: vi.fn(() => mockResponse('handleDeleteJob')),
    handleCreateArtifactEmail: vi.fn(() => mockResponse('handleCreateArtifactEmail', 201)),
    handleGetArtifactEmail: vi.fn(() => mockResponse('handleGetArtifactEmail')),
    handleScheduledEvent: vi.fn(async () => undefined),
    handleManifest: vi.fn(() => mockResponse('handleManifest')),
    handleServiceWorker: vi.fn(() => mockResponse('handleServiceWorker')),
    handlePWAIcon: vi.fn(() => mockResponse('handlePWAIcon')),
    handlePWAScreenshot: vi.fn(() => mockResponse('handlePWAScreenshot')),
    handleGetSubdomain: vi.fn(() => mockResponse('handleGetSubdomain')),
    handleEnableSubdomain: vi.fn(() => mockResponse('handleEnableSubdomain')),
    handleDisableSubdomain: vi.fn(() => mockResponse('handleDisableSubdomain')),
    handleGlobalProxy: vi.fn(() => mockResponse('handleGlobalProxy')),
    handleEditor: vi.fn(() => mockResponse('handleEditor')),
    serveEditorPage: vi.fn(() => mockResponse('serveEditorPage')),
  };
}
