import type { Env } from '../../types';
import { DATA_ERRORS } from '../../types';
import { createLogger, logError } from '../../logging';
import { successResponse, errorResponse, verifyOwner, type DataContext } from '../middleware';
import { getGoogleAuthUrl, exchangeCodeForTokens } from './google-auth';
import { hasArtifactTokens, storeArtifactTokens } from './artifact-tokens';
import { renderCallbackPage } from './callback-page';
import { userFacingSheetsOAuthError } from './errors';

interface ArtifactOAuthState {
  artifactId: string;
  returnUrl: string;
}

function parseOAuthState(stateParam: string): ArtifactOAuthState | null {
  try {
    return JSON.parse(atob(stateParam));
  } catch {
    return null;
  }
}

function successRedirectUrl(returnUrl: string): string | null {
  return returnUrl ? `${returnUrl}?sheets_connected=true` : null;
}

async function completeArtifactOAuth(
  env: Env,
  artifactId: string,
  code: string,
  redirectPath: string,
  returnUrl: string
): Promise<Response> {
  try {
    const tokens = await exchangeCodeForTokens(code, redirectPath, env);
    await storeArtifactTokens(env, artifactId, tokens);
    return renderCallbackPage(
      true,
      'Google Sheets connected successfully!',
      env.SHAREOUT_BASE_URL,
      successRedirectUrl(returnUrl)
    );
  } catch (err) {
    logError(
      createLogger(env, {
        scope: 'sheets',
        event: 'sheets.oauth_callback.failed',
        artifact_id: artifactId,
      }),
      'sheets oauth callback failed',
      err,
    );
    return renderCallbackPage(false, userFacingSheetsOAuthError(err), env.SHAREOUT_BASE_URL);
  }
}

export async function getAuthUrl(
  request: Request,
  ctx: DataContext
): Promise<Response> {
  const alreadyConnected = await hasArtifactTokens(ctx.env, ctx.artifactId);

  if (alreadyConnected) {
    const isOwner = await verifyOwner(request, ctx);
    if (!isOwner) {
      return errorResponse({
        code: 'OWNER_REQUIRED',
        message: 'Google Sheets is already connected. Only the artifact owner can reconnect.',
        status: 403,
      });
    }
  }

  const url = new URL(request.url);
  const returnUrl = url.searchParams.get('return') || '';

  const state = btoa(JSON.stringify({
    shareoutSheetsAuth: true,
    artifactId: ctx.artifactId,
    returnUrl,
    ts: Date.now(),
  }));

  const authUrl = getGoogleAuthUrl(ctx.env, '/auth/callback', state);

  return successResponse({
    authUrl,
    message: 'Open this URL in a browser to authorize Google Sheets access',
  });
}

export async function handleAuthCallback(
  request: Request,
  ctx: DataContext
): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const stateParam = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) {
    return renderCallbackPage(false, error, ctx.env.SHAREOUT_BASE_URL);
  }

  if (!code || !stateParam) {
    return renderCallbackPage(false, 'Missing code or state', ctx.env.SHAREOUT_BASE_URL);
  }

  const state = parseOAuthState(stateParam);
  if (!state) {
    return renderCallbackPage(false, 'Invalid state', ctx.env.SHAREOUT_BASE_URL);
  }

  return completeArtifactOAuth(
    ctx.env,
    ctx.artifactId,
    code,
    `/v1/data/${ctx.artifactId}/sheets/auth-callback`,
    state.returnUrl
  );
}

export async function handleSheetsOAuthCallback(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const stateParam = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) {
    return renderCallbackPage(false, error, env.SHAREOUT_BASE_URL);
  }

  if (!code || !stateParam) {
    return renderCallbackPage(false, 'Missing code or state', env.SHAREOUT_BASE_URL);
  }

  const state = parseOAuthState(stateParam);
  if (!state) {
    return renderCallbackPage(false, 'Invalid state', env.SHAREOUT_BASE_URL);
  }

  const artifact = await env.DB.prepare(
    'SELECT id FROM artifacts WHERE id = ?'
  ).bind(state.artifactId).first<{ id: string }>();

  if (!artifact) {
    return renderCallbackPage(false, 'Artifact not found', env.SHAREOUT_BASE_URL);
  }

  return completeArtifactOAuth(env, state.artifactId, code, '/auth/callback', state.returnUrl);
}

export async function getTokenStatus(ctx: DataContext): Promise<Response> {
  const connected = await hasArtifactTokens(ctx.env, ctx.artifactId);
  return successResponse({ connected, artifactId: ctx.artifactId });
}
