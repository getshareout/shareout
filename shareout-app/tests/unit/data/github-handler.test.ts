// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DataContext } from '../../../src/data/middleware';
import type { Env } from '../../../src/types';
import {
  handleGitHub,
  handleGitHubOAuthCallback,
} from '../../../src/data/github/handler';

const ARTIFACT_ID = 'art_test';
const BASE_URL = 'https://shareout.example.com';
const ORIGIN = 'https://app.example.com';

const githubAuth = vi.hoisted(() => ({
  getGitHubAuthUrl: vi.fn(() => 'https://github.com/login/oauth/authorize?mock=1'),
  exchangeCodeForToken: vi.fn(async () => ({
    access_token: 'gho_token',
    token_type: 'bearer',
    scope: 'repo',
  })),
  getGitHubUser: vi.fn(async () => ({ login: 'octocat', id: 1, name: 'Octo Cat' })),
  storeArtifactToken: vi.fn(async () => undefined),
  getArtifactToken: vi.fn(async () => ({
    token: 'gho_token',
    username: 'octocat',
    userId: 1,
  })),
  getArtifactTokenStatus: vi.fn(async () => ({
    connected: true,
    username: 'octocat',
    connectedAt: '2026-05-30T14:00:00.000Z',
  })),
  removeArtifactToken: vi.fn(async () => undefined),
}));

const githubApi = vi.hoisted(() => ({
  createRepo: vi.fn(async () => ({
    name: 'new-repo',
    full_name: 'octocat/new-repo',
    html_url: 'https://github.com/octocat/new-repo',
    default_branch: 'main',
    private: false,
  })),
  getRepo: vi.fn(async () => ({
    name: 'existing',
    full_name: 'octocat/existing',
    html_url: 'https://github.com/octocat/existing',
    default_branch: 'main',
    private: false,
  })),
  getFile: vi.fn(async () => null),
  createOrUpdateFile: vi.fn(async () => ({
    sha: 'file-sha',
    commit: { sha: 'commit-sha', html_url: 'https://github.com/octocat/repo/commit/sha' },
  })),
  listUserRepos: vi.fn(async () => ([
    {
      name: 'existing',
      full_name: 'octocat/existing',
      private: false,
      html_url: 'https://github.com/octocat/existing',
      default_branch: 'main',
    },
  ])),
  parseRepoString: vi.fn((repo: string) => {
    const [owner, name] = repo.split('/');
    if (!owner || !name) return null;
    return { owner, repo: name };
  }),
}));

vi.mock('../../../src/data/github/github-auth', () => githubAuth);
vi.mock('../../../src/data/github/github-api', () => githubApi);

type DbScenario = {
  artifact?: { id: string; name?: string } | null;
  deployment?: {
    version_id: string;
    version_no: number;
    entrypoint: string;
  } | null;
  assets?: Array<{ path: string; r2_key: string; mime: string }>;
};

function makeGithubEnv(
  scenario: DbScenario = {},
  r2Content: Record<string, string> = {},
): Env {
  const DB = {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...args: unknown[]) => ({
        first: vi.fn(async () => {
          if (sql.includes('FROM artifacts WHERE id = ?')) {
            return scenario.artifact === undefined ? { id: ARTIFACT_ID, name: 'Demo Site' } : scenario.artifact;
          }
          if (sql.includes('FROM deployments d')) {
            return scenario.deployment ?? null;
          }
          return null;
        }),
        all: vi.fn(async () => ({
          results: scenario.assets ?? [],
        })),
      })),
    })),
  } as unknown as Env['DB'];

  return {
    DB,
    ARTIFACTS: {
      get: vi.fn(async (key: string) => {
        const content = r2Content[key];
        if (!content) return null;
        return {
          arrayBuffer: async () => new TextEncoder().encode(content).buffer,
        } as unknown as R2ObjectBody;
      }),
    } as unknown as Env['ARTIFACTS'],
    GITHUB_CLIENT_ID: 'gh_client_id',
    GITHUB_CLIENT_SECRET: 'gh_client_secret',
    SHAREOUT_BASE_URL: BASE_URL,
  } as Env;
}

function makeCtx(env: Env, origin: string | null = ORIGIN): DataContext {
  return {
    artifactId: ARTIFACT_ID,
    artifact: {
      id: ARTIFACT_ID,
      name: 'Demo Site',
      visibility: 'public',
      auth_method: null,
    },
    env,
    origin,
  };
}

function encodeState(payload: Record<string, unknown>): string {
  return btoa(JSON.stringify(payload));
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('handleGitHub routing', () => {
  it('returns 404 for unknown routes', async () => {
    const env = makeGithubEnv();
    const ctx = makeCtx(env);
    const response = await handleGitHub(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/github/unknown`, { method: 'GET' }),
      ctx,
      'unknown',
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('auth-url', () => {
  it('returns 500 when GitHub OAuth is not configured', async () => {
    const env = makeGithubEnv();
    delete (env as { GITHUB_CLIENT_ID?: string }).GITHUB_CLIENT_ID;
    const ctx = makeCtx(env);
    const response = await handleGitHub(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/github/auth-url`, { method: 'GET' }),
      ctx,
      'auth-url',
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ code: 'GITHUB_NOT_CONFIGURED' });
  });

  it('returns auth URL with encoded state', async () => {
    const env = makeGithubEnv();
    const ctx = makeCtx(env);
    const response = await handleGitHub(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/github/auth-url?return=https%3A%2F%2Fapp.example.com%2Fdone`, {
        method: 'GET',
      }),
      ctx,
      'auth-url',
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { data: { authUrl: string } };
    expect(body.data.authUrl).toBe('https://github.com/login/oauth/authorize?mock=1');
    expect(githubAuth.getGitHubAuthUrl).toHaveBeenCalledWith(
      env,
      '/auth/callback',
      expect.any(String),
    );
  });
});

describe('auth-callback', () => {
  it('renders error page when GitHub returns an error', async () => {
    const env = makeGithubEnv();
    const ctx = makeCtx(env);
    const response = await handleGitHub(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/github/auth-callback?error=access_denied&error_description=User%20denied`, {
        method: 'GET',
      }),
      ctx,
      'auth-callback',
    );

    expect(response.status).toBe(400);
    expect(response.headers.get('Content-Type')).toBe('text/html');
    const html = await response.text();
    expect(html).toContain('Connection Failed');
    expect(html).toContain('User denied');
  });

  it('renders error page for missing code or invalid state', async () => {
    const env = makeGithubEnv();
    const ctx = makeCtx(env);

    const missing = await handleGitHub(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/github/auth-callback`, { method: 'GET' }),
      ctx,
      'auth-callback',
    );
    expect(missing.status).toBe(400);
    await expect(missing.text()).resolves.toContain('Missing code or state');

    const invalidState = await handleGitHub(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/github/auth-callback?code=abc&state=not-base64`, {
        method: 'GET',
      }),
      ctx,
      'auth-callback',
    );
    expect(invalidState.status).toBe(400);
    await expect(invalidState.text()).resolves.toContain('Invalid state');
  });

  it('stores token and renders success page with redirect script', async () => {
    const env = makeGithubEnv();
    const ctx = makeCtx(env);
    const state = encodeState({
      artifactId: ARTIFACT_ID,
      returnUrl: 'https://app.example.com/done',
    });
    const response = await handleGitHub(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/github/auth-callback?code=oauth_code&state=${encodeURIComponent(state)}`, {
        method: 'GET',
      }),
      ctx,
      'auth-callback',
    );

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('GitHub Connected!');
    expect(html).toContain('@octocat');
    expect(html).toContain('https://app.example.com/done?github_connected=true');
    expect(githubAuth.exchangeCodeForToken).toHaveBeenCalledWith('oauth_code', env);
    expect(githubAuth.storeArtifactToken).toHaveBeenCalled();
  });

  it('renders failure page when OAuth exchange throws without leaking internals', async () => {
    githubAuth.exchangeCodeForToken.mockRejectedValueOnce(
      new Error('GitHub token exchange failed: {"error":"bad_verification_code"}'),
    );
    const env = makeGithubEnv();
    const ctx = makeCtx(env);
    const state = encodeState({ artifactId: ARTIFACT_ID, returnUrl: '' });
    const response = await handleGitHub(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/github/auth-callback?code=bad&state=${encodeURIComponent(state)}`, {
        method: 'GET',
      }),
      ctx,
      'auth-callback',
    );

    expect(response.status).toBe(400);
    const html = await response.text();
    expect(html).toContain('GitHub authorization failed');
    expect(html).not.toContain('bad_verification_code');
    expect(html).not.toContain('token exchange failed');
  });
});

describe('handleGitHubOAuthCallback', () => {
  it('returns artifact-not-found when state references missing artifact', async () => {
    const env = makeGithubEnv({ artifact: null });
    const state = encodeState({ artifactId: 'art_missing', returnUrl: '' });
    const response = await handleGitHubOAuthCallback(
      new Request(`${BASE_URL}/auth/callback?code=oauth_code&state=${encodeURIComponent(state)}`),
      env,
    );

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toContain('Artifact not found');
  });

  it('completes OAuth callback for a valid artifact', async () => {
    const env = makeGithubEnv({ artifact: { id: ARTIFACT_ID, name: 'Demo Site' } });
    const state = encodeState({ artifactId: ARTIFACT_ID, returnUrl: 'https://app.example.com/return' });
    const response = await handleGitHubOAuthCallback(
      new Request(`${BASE_URL}/auth/callback?code=oauth_code&state=${encodeURIComponent(state)}`),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain('Connected as');
    expect(githubAuth.storeArtifactToken).toHaveBeenCalledWith(env, ARTIFACT_ID, 'gho_token', expect.any(Object));
  });

  it('handles OAuth callback errors from GitHub', async () => {
    const env = makeGithubEnv();
    const response = await handleGitHubOAuthCallback(
      new Request(`${BASE_URL}/auth/callback?error=bad_verification_code`),
      env,
    );

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toContain('Connection Failed');
  });

  it('returns missing-code error for incomplete OAuth callback', async () => {
    const env = makeGithubEnv();
    const response = await handleGitHubOAuthCallback(
      new Request(`${BASE_URL}/auth/callback?code=only-code`),
      env,
    );

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toContain('Missing code or state');
  });

  it('returns invalid-state error for malformed OAuth state', async () => {
    const env = makeGithubEnv();
    const response = await handleGitHubOAuthCallback(
      new Request(`${BASE_URL}/auth/callback?code=oauth_code&state=not-valid-base64`),
      env,
    );

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toContain('Invalid state');
  });

  it('handles non-Error throws during token exchange with generic message', async () => {
    githubAuth.exchangeCodeForToken.mockRejectedValueOnce('boom');
    const env = makeGithubEnv({ artifact: { id: ARTIFACT_ID } });
    const state = encodeState({ artifactId: ARTIFACT_ID, returnUrl: '' });
    const response = await handleGitHubOAuthCallback(
      new Request(`${BASE_URL}/auth/callback?code=oauth_code&state=${encodeURIComponent(state)}`),
      env,
    );

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toContain('GitHub authorization failed');
  });

  it('does not leak CREDENTIALS_KEY or D1 errors during OAuth callback', async () => {
    githubAuth.storeArtifactToken.mockRejectedValueOnce(new Error('D1_ERROR: no such table'));
    const env = makeGithubEnv({ artifact: { id: ARTIFACT_ID } });
    const state = encodeState({ artifactId: ARTIFACT_ID, returnUrl: '' });
    const response = await handleGitHubOAuthCallback(
      new Request(`${BASE_URL}/auth/callback?code=oauth_code&state=${encodeURIComponent(state)}`),
      env,
    );

    expect(response.status).toBe(400);
    const html = await response.text();
    expect(html).toContain('GitHub authorization failed');
    expect(html).not.toContain('D1_ERROR');
  });
});

describe('token-status and disconnect', () => {
  it('returns token status for the artifact', async () => {
    const env = makeGithubEnv();
    const ctx = makeCtx(env);
    const response = await handleGitHub(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/github/token-status`, { method: 'GET' }),
      ctx,
      'token-status',
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        connected: true,
        username: 'octocat',
        artifactId: ARTIFACT_ID,
      },
    });
  });

  it('disconnects GitHub integration', async () => {
    const env = makeGithubEnv();
    const ctx = makeCtx(env);
    const response = await handleGitHub(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/github/disconnect`, { method: 'POST' }),
      ctx,
      'disconnect',
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true, data: { success: true } });
    expect(githubAuth.removeArtifactToken).toHaveBeenCalledWith(env, ARTIFACT_ID);
  });
});

describe('listRepos', () => {
  it('returns 401 when GitHub is not connected', async () => {
    githubAuth.getArtifactToken.mockResolvedValueOnce(null);
    const env = makeGithubEnv();
    const ctx = makeCtx(env);
    const response = await handleGitHub(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/github/repos`, { method: 'GET' }),
      ctx,
      'repos',
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: 'GITHUB_NOT_CONNECTED' });
  });

  it('returns paginated repo list', async () => {
    const env = makeGithubEnv();
    const ctx = makeCtx(env);
    const response = await handleGitHub(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/github/repos?page=2&per_page=10`, { method: 'GET' }),
      ctx,
      'repos',
    );

    expect(response.status).toBe(200);
    const body = await response.json() as {
      data: { repos: Array<{ full_name: string }>; page: number; perPage: number };
    };
    expect(body.data.page).toBe(2);
    expect(body.data.perPage).toBe(10);
    expect(body.data.repos[0].full_name).toBe('octocat/existing');
    expect(githubApi.listUserRepos).toHaveBeenCalledWith('gho_token', { page: 2, perPage: 10 });
  });

  it('returns 500 with generic message when GitHub repo listing fails', async () => {
    githubApi.listUserRepos.mockRejectedValueOnce(new Error('rate limited'));
    const env = makeGithubEnv();
    const ctx = makeCtx(env);
    const response = await handleGitHub(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/github/repos`, { method: 'GET' }),
      ctx,
      'repos',
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      code: 'GITHUB_ERROR',
      error: 'Failed to list repositories',
    });
  });

  it('does not leak internal errors while listing repos', async () => {
    githubApi.listUserRepos.mockRejectedValueOnce(new Error('D1_ERROR: disk I/O error'));
    const env = makeGithubEnv();
    const ctx = makeCtx(env);
    const response = await handleGitHub(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/github/repos`, { method: 'GET' }),
      ctx,
      'repos',
    );

    expect(response.status).toBe(500);
    const body = await response.json() as { error: string };
    expect(body.error).toBe('Failed to list repositories');
    expect(body.error).not.toContain('D1_ERROR');
  });

  it('handles non-Error failures while listing repos', async () => {
    githubApi.listUserRepos.mockRejectedValueOnce('nope');
    const env = makeGithubEnv();
    const ctx = makeCtx(env);
    const response = await handleGitHub(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/github/repos`, { method: 'GET' }),
      ctx,
      'repos',
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      code: 'GITHUB_ERROR',
      error: 'Failed to list repositories',
    });
  });
});

describe('exportToGitHub', () => {
  const deployment = {
    version_id: 'ver_1',
    version_no: 7,
    entrypoint: 'index.html',
  };
  const assets = [
    { path: 'index.html', r2_key: 'art_test/ver_1/index.html', mime: 'text/html' },
    { path: 'app.js', r2_key: 'art_test/ver_1/app.js', mime: 'application/javascript' },
  ];

  function exportRequest(body: unknown): Request {
    return new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/github/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('returns 401 when GitHub is not connected', async () => {
    githubAuth.getArtifactToken.mockResolvedValueOnce(null);
    const env = makeGithubEnv();
    const ctx = makeCtx(env);
    const response = await handleGitHub(exportRequest({ repo: 'octocat/existing' }), ctx, 'export');

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: 'GITHUB_NOT_CONNECTED' });
  });

  it('returns 400 for invalid JSON and missing repo/newRepo', async () => {
    const env = makeGithubEnv();
    const ctx = makeCtx(env);

    const invalidJson = await handleGitHub(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/github/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
      }),
      ctx,
      'export',
    );
    expect(invalidJson.status).toBe(400);

    const missingTarget = await handleGitHub(exportRequest({}), ctx, 'export');
    expect(missingTarget.status).toBe(400);
    await expect(missingTarget.json()).resolves.toMatchObject({
      code: 'INVALID_REQUEST',
      error: 'Provide repo (owner/repo) or newRepo to create',
    });
  });

  it('returns 400 for invalid repo format', async () => {
    githubApi.parseRepoString.mockReturnValueOnce(null);
    const env = makeGithubEnv();
    const ctx = makeCtx(env);
    const response = await handleGitHub(exportRequest({ repo: 'invalid' }), ctx, 'export');

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'INVALID_REQUEST',
      error: 'Invalid repo format. Use owner/repo',
    });
  });

  it('returns 404 when existing repo is not accessible', async () => {
    githubApi.getRepo.mockResolvedValueOnce(null);
    const env = makeGithubEnv();
    const ctx = makeCtx(env);
    const response = await handleGitHub(exportRequest({ repo: 'octocat/missing' }), ctx, 'export');

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: 'REPO_NOT_FOUND' });
  });

  it('returns 404 when no deployment exists', async () => {
    const env = makeGithubEnv({ deployment: null });
    const ctx = makeCtx(env);
    const response = await handleGitHub(exportRequest({ repo: 'octocat/existing' }), ctx, 'export');

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: 'NO_DEPLOYMENT' });
  });

  it('returns 404 when deployment has no assets', async () => {
    const env = makeGithubEnv({ deployment, assets: [] });
    const ctx = makeCtx(env);
    const response = await handleGitHub(exportRequest({ repo: 'octocat/existing' }), ctx, 'export');

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: 'NO_ASSETS' });
  });

  it('exports assets to an existing repo and writes README by default', async () => {
    githubApi.getFile.mockResolvedValueOnce({ sha: 'existing-sha', content: 'old' });
    const env = makeGithubEnv(
      { deployment, assets, artifact: { id: ARTIFACT_ID, name: 'Demo Site' } },
      {
        'art_test/ver_1/index.html': '<html></html>',
        'art_test/ver_1/app.js': 'console.log(1)',
      },
    );
    const ctx = makeCtx(env);
    const response = await handleGitHub(
      exportRequest({
        repo: 'octocat/existing',
        branch: 'main',
        pathPrefix: 'dist/',
        commitMessage: 'Export test',
      }),
      ctx,
      'export',
    );

    expect(response.status).toBe(200);
    const body = await response.json() as {
      data: {
        success: boolean;
        repo: string;
        filesCommitted: number;
        commitSha: string;
        version: number;
      };
    };
    expect(body.data.success).toBe(true);
    expect(body.data.repo).toBe('octocat/existing');
    expect(body.data.filesCommitted).toBe(3);
    expect(body.data.commitSha).toBe('commit-sha');
    expect(body.data.version).toBe(7);
    expect(githubApi.createOrUpdateFile).toHaveBeenCalledWith(
      'gho_token',
      'octocat',
      'existing',
      'dist/index.html',
      expect.any(String),
      expect.stringContaining('Export test'),
      expect.objectContaining({ branch: 'main', sha: 'existing-sha' }),
    );
    expect(githubApi.createOrUpdateFile).toHaveBeenCalledWith(
      'gho_token',
      'octocat',
      'existing',
      'dist/README.md',
      expect.any(String),
      expect.stringContaining('README'),
      expect.any(Object),
    );
  });

  it('creates a new repo when newRepo is provided', async () => {
    const env = makeGithubEnv(
      { deployment, assets, artifact: { id: ARTIFACT_ID, name: 'Demo Site' } },
      { 'art_test/ver_1/index.html': '<html></html>' },
    );
    const ctx = makeCtx(env);
    const response = await handleGitHub(
      exportRequest({
        newRepo: { name: 'fresh-export', description: 'From ShareOut', private: true },
        includeReadme: false,
      }),
      ctx,
      'export',
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { data: { repoUrl: string; files: string[] } };
    expect(body.data.repoUrl).toBe('https://github.com/octocat/new-repo');
    expect(body.data.files).toEqual(['index.html']);
    expect(githubApi.createRepo).toHaveBeenCalledWith('gho_token', {
      name: 'fresh-export',
      description: 'From ShareOut',
      private: true,
    });
  });

  it('skips missing R2 assets and still commits available files', async () => {
    const env = makeGithubEnv(
      { deployment, assets, artifact: { id: ARTIFACT_ID, name: 'Demo Site' } },
      { 'art_test/ver_1/index.html': '<html></html>' },
    );
    const ctx = makeCtx(env);
    const response = await handleGitHub(
      exportRequest({ repo: 'octocat/existing', includeReadme: false }),
      ctx,
      'export',
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { data: { filesCommitted: number; files: string[] } };
    expect(body.data.filesCommitted).toBe(1);
    expect(body.data.files).toEqual(['index.html']);
  });

  it('returns 500 with generic message when export throws', async () => {
    githubApi.createRepo.mockRejectedValueOnce(new Error('create failed'));
    const env = makeGithubEnv({ deployment, assets });
    const ctx = makeCtx(env);
    const response = await handleGitHub(
      exportRequest({ newRepo: { name: 'broken' } }),
      ctx,
      'export',
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      code: 'EXPORT_ERROR',
      error: 'Export failed',
    });
  });

  it('does not leak GitHub API or internal errors on export failure', async () => {
    githubApi.createOrUpdateFile.mockRejectedValueOnce(
      new Error('Validation Failed: resource already exists'),
    );
    const env = makeGithubEnv(
      { deployment, assets, artifact: { id: ARTIFACT_ID, name: 'Demo Site' } },
      { 'art_test/ver_1/index.html': '<html></html>' },
    );
    const ctx = makeCtx(env);
    const response = await handleGitHub(exportRequest({ repo: 'octocat/existing' }), ctx, 'export');

    expect(response.status).toBe(500);
    const body = await response.json() as { error: string };
    expect(body.error).toBe('Export failed');
    expect(body.error).not.toContain('Validation Failed');
  });

  it('handles non-Error export failures', async () => {
    githubApi.getRepo.mockRejectedValueOnce('broken');
    const env = makeGithubEnv({ deployment, assets });
    const ctx = makeCtx(env);
    const response = await handleGitHub(exportRequest({ repo: 'octocat/existing' }), ctx, 'export');

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ code: 'EXPORT_ERROR', error: 'Export failed' });
  });
});
