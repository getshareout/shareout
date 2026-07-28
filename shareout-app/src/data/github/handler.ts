import type { Env } from '../../types';
import { DATA_ERRORS } from '../../types';
import { googleFontsPreconnect, standalonePageStyles } from '../../design-system/standalone-page';
import { colors } from '../../design-system/tokens';
import { createLogger, logError } from '../../logging';
import {
  successResponse,
  errorResponse,
  type DataContext,
} from '../middleware';
import {
  getGitHubAuthUrl,
  exchangeCodeForToken,
  getGitHubUser,
  storeArtifactToken,
  getArtifactToken,
  getArtifactTokenStatus,
  removeArtifactToken,
} from './github-auth';
import {
  createRepo,
  getRepo,
  getFile,
  createOrUpdateFile,
  listUserRepos,
  parseRepoString,
} from './github-api';
import {
  userFacingExportError,
  userFacingOAuthError,
  userFacingReposError,
} from './errors';

export async function handleGitHub(
  request: Request,
  ctx: DataContext,
  path: string
): Promise<Response> {
  const parts = path.split('/').filter(Boolean);
  const [action] = parts;
  const method = request.method;

  if (action === 'auth-url' && method === 'GET') {
    return getAuthUrl(request, ctx);
  }

  if (action === 'auth-callback' && method === 'GET') {
    return handleAuthCallback(request, ctx);
  }

  if (action === 'token-status' && method === 'GET') {
    return getTokenStatus(ctx);
  }

  if (action === 'disconnect' && method === 'POST') {
    return disconnect(ctx);
  }

  if (action === 'export' && method === 'POST') {
    return exportToGitHub(request, ctx);
  }

  if (action === 'repos' && method === 'GET') {
    return listRepos(request, ctx);
  }

  return errorResponse(DATA_ERRORS.NOT_FOUND);
}

async function getAuthUrl(
  request: Request,
  ctx: DataContext
): Promise<Response> {
  if (!ctx.env.GITHUB_CLIENT_ID) {
    return errorResponse({
      code: 'GITHUB_NOT_CONFIGURED',
      message: 'GitHub OAuth not configured',
      status: 500,
    });
  }

  const url = new URL(request.url);
  const returnUrl = url.searchParams.get('return') || '';

  const state = btoa(JSON.stringify({
    shareoutGitHubAuth: true,
    artifactId: ctx.artifactId,
    returnUrl,
    ts: Date.now(),
  }));

  const authUrl = getGitHubAuthUrl(ctx.env, '/auth/callback', state);

  return successResponse({
    authUrl,
    message: 'Open this URL in a browser to authorize GitHub access',
  });
}

async function handleAuthCallback(
  request: Request,
  ctx: DataContext
): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const stateParam = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description');

  if (error) {
    return renderCallbackPage(false, errorDescription || error, ctx.env.SHAREOUT_BASE_URL);
  }

  if (!code || !stateParam) {
    return renderCallbackPage(false, 'Missing code or state', ctx.env.SHAREOUT_BASE_URL);
  }

  let state: { artifactId: string; returnUrl: string };
  try {
    state = JSON.parse(atob(stateParam));
  } catch {
    return renderCallbackPage(false, 'Invalid state', ctx.env.SHAREOUT_BASE_URL);
  }

  try {
    const { access_token } = await exchangeCodeForToken(code, ctx.env);
    const user = await getGitHubUser(access_token);
    await storeArtifactToken(ctx.env, ctx.artifactId, access_token, user);

    const redirectUrl = state.returnUrl
      ? `${state.returnUrl}?github_connected=true`
      : null;

    return renderCallbackPage(
      true,
      `Connected as ${user.login}`,
      ctx.env.SHAREOUT_BASE_URL,
      user.login,
      redirectUrl
    );
  } catch (err) {
    logError(
      createLogger(ctx.env, {
        scope: 'github',
        event: 'github.oauth_callback.failed',
        artifact_id: ctx.artifactId,
      }),
      'github oauth callback failed',
      err,
    );
    return renderCallbackPage(false, userFacingOAuthError(err), ctx.env.SHAREOUT_BASE_URL);
  }
}

export async function handleGitHubOAuthCallback(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const stateParam = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description');

  if (error) {
    return renderCallbackPage(false, errorDescription || error, env.SHAREOUT_BASE_URL);
  }

  if (!code || !stateParam) {
    return renderCallbackPage(false, 'Missing code or state', env.SHAREOUT_BASE_URL);
  }

  let state: { artifactId: string; returnUrl: string };
  try {
    state = JSON.parse(atob(stateParam));
  } catch {
    return renderCallbackPage(false, 'Invalid state', env.SHAREOUT_BASE_URL);
  }

  const artifact = await env.DB.prepare(
    'SELECT id FROM artifacts WHERE id = ?'
  ).bind(state.artifactId).first<{ id: string }>();

  if (!artifact) {
    return renderCallbackPage(false, 'Artifact not found', env.SHAREOUT_BASE_URL);
  }

  try {
    const { access_token } = await exchangeCodeForToken(code, env);
    const user = await getGitHubUser(access_token);
    await storeArtifactToken(env, state.artifactId, access_token, user);

    const redirectUrl = state.returnUrl
      ? `${state.returnUrl}?github_connected=true`
      : null;

    return renderCallbackPage(
      true,
      `Connected as ${user.login}`,
      env.SHAREOUT_BASE_URL,
      user.login,
      redirectUrl
    );
  } catch (err) {
    logError(
      createLogger(env, {
        scope: 'github',
        event: 'github.oauth_callback.failed',
        artifact_id: state.artifactId,
      }),
      'github oauth callback failed',
      err,
    );
    return renderCallbackPage(false, userFacingOAuthError(err), env.SHAREOUT_BASE_URL);
  }
}

async function getTokenStatus(ctx: DataContext): Promise<Response> {
  const status = await getArtifactTokenStatus(ctx.env, ctx.artifactId);
  return successResponse({ ...status, artifactId: ctx.artifactId });
}

async function disconnect(ctx: DataContext): Promise<Response> {
  await removeArtifactToken(ctx.env, ctx.artifactId);
  return successResponse({ success: true });
}

async function listRepos(
  request: Request,
  ctx: DataContext
): Promise<Response> {
  const tokenInfo = await getArtifactToken(ctx.env, ctx.artifactId);
  if (!tokenInfo) {
    return errorResponse({
      code: 'GITHUB_NOT_CONNECTED',
      message: 'GitHub not connected. Get auth URL from /github/auth-url first.',
      status: 401,
    });
  }

  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get('page') || '1', 10);
  const perPage = parseInt(url.searchParams.get('per_page') || '30', 10);

  try {
    const repos = await listUserRepos(tokenInfo.token, { page, perPage });
    return successResponse({
      repos: repos.map(r => ({
        name: r.name,
        full_name: r.full_name,
        private: r.private,
        html_url: r.html_url,
        default_branch: r.default_branch,
      })),
      page,
      perPage,
    });
  } catch (err) {
    logError(
      createLogger(ctx.env, {
        scope: 'github',
        event: 'github.repos.failed',
        artifact_id: ctx.artifactId,
      }),
      'github list repos failed',
      err,
    );
    return errorResponse({
      code: 'GITHUB_ERROR',
      message: userFacingReposError(err),
      status: 500,
    });
  }
}

interface ExportRequest {
  repo?: string;
  newRepo?: {
    name: string;
    description?: string;
    private?: boolean;
  };
  branch?: string;
  commitMessage?: string;
  includeReadme?: boolean;
  pathPrefix?: string;
}

async function exportToGitHub(
  request: Request,
  ctx: DataContext
): Promise<Response> {
  const tokenInfo = await getArtifactToken(ctx.env, ctx.artifactId);
  if (!tokenInfo) {
    return errorResponse({
      code: 'GITHUB_NOT_CONNECTED',
      message: 'GitHub not connected',
      status: 401,
    });
  }

  let body: ExportRequest;
  try {
    body = await request.json();
  } catch {
    return errorResponse({ ...DATA_ERRORS.INVALID_REQUEST, message: 'Invalid JSON' });
  }

  if (!body.repo && !body.newRepo) {
    return errorResponse({
      ...DATA_ERRORS.INVALID_REQUEST,
      message: 'Provide repo (owner/repo) or newRepo to create',
    });
  }

  let owner: string;
  let repoName: string;
  let repoUrl: string;

  try {
    if (body.newRepo) {
      const created = await createRepo(tokenInfo.token, body.newRepo);
      owner = tokenInfo.username;
      repoName = created.name;
      repoUrl = created.html_url;
    } else {
      const parsed = parseRepoString(body.repo!);
      if (!parsed) {
        return errorResponse({
          ...DATA_ERRORS.INVALID_REQUEST,
          message: 'Invalid repo format. Use owner/repo',
        });
      }
      owner = parsed.owner;
      repoName = parsed.repo;

      const repo = await getRepo(tokenInfo.token, owner, repoName);
      if (!repo) {
        return errorResponse({
          code: 'REPO_NOT_FOUND',
          message: `Repository ${body.repo} not found or not accessible`,
          status: 404,
        });
      }
      repoUrl = repo.html_url;
    }

    const deployment = await ctx.env.DB.prepare(`
      SELECT v.id as version_id, v.version_no, v.entrypoint
      FROM deployments d
      JOIN versions v ON d.version_id = v.id
      WHERE d.artifact_id = ? AND d.channel = 'production'
    `).bind(ctx.artifactId).first<{
      version_id: string;
      version_no: number;
      entrypoint: string;
    }>();

    if (!deployment) {
      return errorResponse({
        code: 'NO_DEPLOYMENT',
        message: 'No published version found',
        status: 404,
      });
    }

    const assets = await ctx.env.DB.prepare(`
      SELECT path, r2_key, mime FROM assets WHERE version_id = ?
    `).bind(deployment.version_id).all<{
      path: string;
      r2_key: string;
      mime: string;
    }>();

    if (!assets.results || assets.results.length === 0) {
      return errorResponse({
        code: 'NO_ASSETS',
        message: 'No assets found in deployment',
        status: 404,
      });
    }

    const branch = body.branch || 'main';
    const prefix = body.pathPrefix || '';
    const baseMessage = body.commitMessage || `ShareOut export v${deployment.version_no}`;

    const committed: string[] = [];
    let lastCommit: { sha: string } | null = null;

    for (const asset of assets.results) {
      const r2Object = await ctx.env.ARTIFACTS.get(asset.r2_key);
      if (!r2Object) continue;

      const arrayBuffer = await r2Object.arrayBuffer();
      const base64Content = arrayBufferToBase64(arrayBuffer);
      const filePath = prefix ? `${prefix}${asset.path}` : asset.path;

      const existing = await getFile(tokenInfo.token, owner, repoName, filePath, branch);
      const sha = existing?.sha;

      const result = await createOrUpdateFile(
        tokenInfo.token,
        owner,
        repoName,
        filePath,
        base64Content,
        `${baseMessage}: ${asset.path}`,
        { sha, branch }
      );

      committed.push(filePath);
      lastCommit = result.commit;
    }

    if (body.includeReadme !== false) {
      const artifact = await ctx.env.DB.prepare(
        'SELECT name FROM artifacts WHERE id = ?'
      ).bind(ctx.artifactId).first<{ name: string }>();

      const readmePath = prefix ? `${prefix}README.md` : 'README.md';
      const readmeContent = generateReadme(
        artifact?.name || 'ShareOut Artifact',
        deployment.version_no,
        ctx.env.SHAREOUT_BASE_URL,
        ctx.artifactId
      );

      const existing = await getFile(tokenInfo.token, owner, repoName, readmePath, branch);
      const sha = existing?.sha;

      const result = await createOrUpdateFile(
        tokenInfo.token,
        owner,
        repoName,
        readmePath,
        btoa(readmeContent),
        `${baseMessage}: README`,
        { sha, branch }
      );

      committed.push(readmePath);
      lastCommit = result.commit;
    }

    return successResponse({
      success: true,
      repoUrl,
      repo: `${owner}/${repoName}`,
      branch,
      filesCommitted: committed.length,
      files: committed,
      commitSha: lastCommit?.sha,
      version: deployment.version_no,
    });
  } catch (err) {
    logError(
      createLogger(ctx.env, {
        scope: 'github',
        event: 'github.export.failed',
        artifact_id: ctx.artifactId,
      }),
      'github export failed',
      err,
    );
    return errorResponse({
      code: 'EXPORT_ERROR',
      message: userFacingExportError(err),
      status: 500,
    });
  }
}

function generateReadme(
  name: string,
  version: number,
  baseUrl: string,
  artifactId: string
): string {
  const timestamp = new Date().toISOString();
  return `# ${name}

Published via [ShareOut](${baseUrl})

**Version:** ${version}
**Exported:** ${timestamp}

## Source

This site was created and published using ShareOut.

---

*Exported from ShareOut*
`;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function renderCallbackPage(
  success: boolean,
  message: string,
  baseUrl: string,
  username?: string,
  redirectUrl?: string | null
): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${success ? 'Connected' : 'Error'} - ShareOut</title>
  ${googleFontsPreconnect}
  <style>
    ${standalonePageStyles}
    .github-logo { width: 48px; height: 48px; margin-bottom: 16px; }
    .username { font-weight: 600; color: ${colors.text}; }
  </style>
</head>
<body>
  <div class="card">
    <svg class="github-logo" viewBox="0 0 16 16" fill="${colors.text}">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
    </svg>
    <div class="icon ${success ? 'success' : 'error'}">${success ? '&#10003;' : '&#10005;'}</div>
    <h1>${success ? 'GitHub Connected!' : 'Connection Failed'}</h1>
    <p>${success && username ? `Signed in as <span class="username">@${username}</span>` : message}</p>
    <p class="close-hint">${success ? 'You can close this window and return to your app.' : 'Please try again.'}</p>
  </div>
  <script>
    ${redirectUrl ? `setTimeout(() => window.location.href = '${redirectUrl}', 2000);` : ''}
    window.opener?.postMessage({ type: 'shareout_github_${success ? 'connected' : 'error'}', message: '${message}'${success && username ? `, username: '${username}'` : ''} }, '*');
  </script>
</body>
</html>`;

  return new Response(html, {
    status: success ? 200 : 400,
    headers: { 'Content-Type': 'text/html' },
  });
}
