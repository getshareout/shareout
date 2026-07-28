// @vitest-environment node
/**
 * Index router integration tests — single Vitest entry file.
 *
 * Vitest only hoists `vi.mock` in files matching `*.test.ts`, so all module mocks
 * and the worker import live here. Individual route areas are split under `suites/`.
 *
 * @module tests/unit/index-router/index.test
 */
import { afterEach, beforeEach, vi } from 'vitest';
import type { HandlerMocks } from './handlers';

const mockResponse = (tag: string, status = 200) =>
  new Response(JSON.stringify({ handler: tag }), {
    status,
    headers: { 'Content-Type': 'application/json', 'X-Mock-Handler': tag },
  });

const handlers: HandlerMocks = vi.hoisted(() => ({
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
}));

vi.mock('../../../src/publish', () => ({ handlePublish: handlers.handlePublish }));
vi.mock('../../../src/serve', () => ({
  handleServe: handlers.handleServe,
  handleServeText: handlers.handleServeText,
  handleServeNamespaced: handlers.handleServeNamespaced,
  handleServeEmbed: handlers.handleServeEmbed,
}));
vi.mock('../../../src/auth', () => ({
  handleGoogleLogin: handlers.handleGoogleLogin,
  handleGoogleCallback: handlers.handleGoogleCallback,
  handleLogout: handlers.handleLogout,
  handlePasswordAuth: handlers.handlePasswordAuth,
  handleCredentialsAuth: handlers.handleCredentialsAuth,
  handleLinkGoogleStart: handlers.handleLinkGoogleStart,
  handleDevLogin: handlers.handleDevLogin,
  getSessionUser: handlers.getSessionUser,
}));
vi.mock('../../../src/api-auth', () => ({
  handleCreateAccount: handlers.handleCreateAccount,
  handleLinkEmail: handlers.handleLinkEmail,
  handleGetProfile: handlers.handleGetProfile,
  handleUpdateProfile: handlers.handleUpdateProfile,
  handleCreateAdminSession: handlers.handleCreateAdminSession,
  validateToken: handlers.validateToken,
}));
vi.mock('../../../src/rate-limit', () => ({
  checkAccountCreation: handlers.checkAccountCreation,
  rateLimitResponse: handlers.rateLimitResponse,
  rateLimitHeaders: handlers.rateLimitHeaders,
  getClientIp: handlers.getClientIp,
}));
vi.mock('../../../src/admin', () => ({ handleAdminPage: handlers.handleAdminPage }));
vi.mock('../../../src/analytics', () => ({
  getAnalytics: handlers.getAnalytics,
  getAccountAnalytics: async () => ({
    range: 30,
    totals: { views: 0, uniques: 0, activeArtifacts: 0 },
    prev: { views: 0, uniques: 0 },
    perf: { samples: 0, lcp_p75: null, fcp_p75: null, dcl_p75: null, ttfb_p75: null },
    series: [],
    topArtifacts: [],
    topCountries: [],
    topReferrers: [],
  }),
}));
vi.mock('../../../src/artifacts', () => ({
  handleListArtifacts: handlers.handleListArtifacts,
  handleGetArtifact: handlers.handleGetArtifact,
  handleUpdateArtifact: handlers.handleUpdateArtifact,
  handleDeleteArtifact: handlers.handleDeleteArtifact,
  handleGetCollaborators: handlers.handleGetCollaborators,
  handleAddCollaborators: handlers.handleAddCollaborators,
  handleRemoveCollaborator: handlers.handleRemoveCollaborator,
  handleTransferOwnership: handlers.handleTransferOwnership,
  handleGetVersions: handlers.handleGetVersions,
  handleRollback: handlers.handleRollback,
  handleGetArtifactFiles: handlers.handleGetArtifactFiles,
}));
vi.mock('../../../src/workspaces', () => ({
  handleListWorkspaces: handlers.handleListWorkspaces,
  handleCreateWorkspace: handlers.handleCreateWorkspace,
  handleGetWorkspace: handlers.handleGetWorkspace,
  handleGetWorkspaceBySlug: handlers.handleGetWorkspaceBySlug,
  handleUpdateWorkspace: handlers.handleUpdateWorkspace,
  handleDeleteWorkspace: handlers.handleDeleteWorkspace,
  handleListWorkspaceMembers: handlers.handleListWorkspaceMembers,
  handleAddWorkspaceMember: handlers.handleAddWorkspaceMember,
  handleRemoveWorkspaceMember: handlers.handleRemoveWorkspaceMember,
  handleTransferWorkspaceOwnership: handlers.handleTransferWorkspaceOwnership,
  parseBranding: () => ({ logo_ext: null, accent_color: null, hide_footer: false }),
}));
vi.mock('../../../src/folders', () => ({
  handleListFolders: handlers.handleListFolders,
  handleCreateFolder: handlers.handleCreateFolder,
  handleGetFolder: handlers.handleGetFolder,
  handleGetFolderByPath: handlers.handleGetFolderByPath,
  handleUpdateFolder: handlers.handleUpdateFolder,
  handleDeleteFolder: handlers.handleDeleteFolder,
  handleMoveArtifactToFolder: handlers.handleMoveArtifactToFolder,
}));
vi.mock('../../../src/data/router', () => ({ handleDataRequest: handlers.handleDataRequest }));
vi.mock('../../../src/data/sheets/handler', () => ({ handleSheetsOAuthCallback: handlers.handleSheetsOAuthCallback }));
vi.mock('../../../src/data/github/handler', () => ({ handleGitHubOAuthCallback: handlers.handleGitHubOAuthCallback }));
vi.mock('../../../src/skill', () => ({
  handleGetSkill: handlers.handleGetSkill,
  handleGetSkillVersion: handlers.handleGetSkillVersion,
  handleGetSkillMeta: handlers.handleGetSkillMeta,
}));
vi.mock('../../../src/sdk-serve', () => ({ handleServeSDK: handlers.handleServeSDK }));
vi.mock('../../../src/editor-serve', () => ({ handleServeEditor: handlers.handleServeEditor }));
vi.mock('../../../src/sdk-mobile-serve', () => ({ handleServeMobileSDK: handlers.handleServeMobileSDK }));
vi.mock('../../../src/sdk-charts-serve', () => ({ handleServeChartsSDK: handlers.handleServeChartsSDK }));
vi.mock('../../../src/css-serve', () => ({ handleServeArtifactCSS: handlers.handleServeArtifactCSS }));
vi.mock('../../../src/ui-serve', () => ({ handleServeArtifactUI: handlers.handleServeArtifactUI }));
vi.mock('../../../src/scheduling/handler', () => ({
  handleCreateJob: handlers.handleCreateJob,
  handleListJobs: handlers.handleListJobs,
  handleGetJob: handlers.handleGetJob,
  handleUpdateJob: handlers.handleUpdateJob,
  handleDeleteJob: handlers.handleDeleteJob,
  handleCreateArtifactEmail: handlers.handleCreateArtifactEmail,
  handleGetArtifactEmail: handlers.handleGetArtifactEmail,
  handleScheduledEvent: handlers.handleScheduledEvent,
}));
vi.mock('../../../src/pwa', () => ({
  handleManifest: handlers.handleManifest,
  handleServiceWorker: handlers.handleServiceWorker,
  handlePWAIcon: handlers.handlePWAIcon,
  handlePWAScreenshot: handlers.handlePWAScreenshot,
}));
vi.mock('../../../src/enterprise', () => ({
  handleGetSubdomain: handlers.handleGetSubdomain,
  handleEnableSubdomain: handlers.handleEnableSubdomain,
  handleDisableSubdomain: handlers.handleDisableSubdomain,
}));
vi.mock('../../../src/proxy', () => ({ handleGlobalProxy: handlers.handleGlobalProxy }));
vi.mock('../../../src/editor/index', () => ({
  handleEditor: handlers.handleEditor,
  serveEditorPage: handlers.serveEditorPage,
}));

import worker from '../../../src/index';
import { registerAccountAuthTests } from './suites/account-auth';
import { registerArtifactServingTests } from './suites/artifact-serving';
import { registerBrowserAuthSdkTests } from './suites/browser-auth-sdk';
import { registerCorsPreflightTests } from './suites/cors-preflight';
import { registerDataApiTests } from './suites/data-api';
import { registerEnterpriseRoutesTests } from './suites/enterprise-routes';
import { registerHealthFallthroughTests } from './suites/health-fallthrough';
import { registerJobsProxyLandingTests } from './suites/jobs-proxy-landing';
import { registerPublishArtifactsTests } from './suites/publish-artifacts';
import { registerScheduledCronTests } from './suites/scheduled-cron';
import { registerSubdomainRoutingTests } from './suites/subdomain-routing';
import { registerWorkspacesFoldersTests } from './suites/workspaces-folders';

export { handlers };
export type { HandlerMocks };

beforeEach(() => {
  vi.clearAllMocks();
  handlers.validateToken.mockImplementation(async (request: Request) => {
    const auth = request.headers.get('Authorization');
    if (auth === 'Bearer valid-token') {
      return { id: 'usr_1', email: 'owner@example.com', username: 'owner' };
    }
    return null;
  });
  handlers.getSessionUser.mockResolvedValue(null);
  handlers.checkAccountCreation.mockResolvedValue({
    allowed: true,
    limit: 10,
    remaining: 9,
    reset: Date.now() + 60_000,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

registerCorsPreflightTests(handlers);
registerHealthFallthroughTests(handlers);
registerDataApiTests(handlers);
registerSubdomainRoutingTests(handlers);
registerAccountAuthTests(handlers);
registerEnterpriseRoutesTests(handlers);
registerPublishArtifactsTests(handlers);
registerWorkspacesFoldersTests(handlers);
registerBrowserAuthSdkTests(handlers);
registerArtifactServingTests(handlers);
registerJobsProxyLandingTests(handlers);
registerScheduledCronTests(handlers);
