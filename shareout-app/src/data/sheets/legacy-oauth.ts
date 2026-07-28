import { DATA_ERRORS } from '../../types';
import { getSessionUser } from '../../auth';
import { createLogger, logError } from '../../logging';
import { successResponse, errorResponse, type DataContext } from '../middleware';
import {
  getGoogleAuthUrl,
  exchangeCodeForTokens,
  storeUserTokens,
  hasGoogleConnection,
  revokeGoogleConnection,
} from './google-auth';
import { userFacingSheetsOAuthError } from './errors';

export async function initiateGoogleConnect(
  request: Request,
  ctx: DataContext
): Promise<Response> {
  const user = await getSessionUser(request, ctx.env);
  if (!user) {
    return errorResponse({ ...DATA_ERRORS.UNAUTHORIZED, message: 'Login required' });
  }

  const url = new URL(request.url);
  const returnUrl = url.searchParams.get('return') || `/v1/data/${ctx.artifactId}/sheets/status`;

  const state = btoa(JSON.stringify({
    artifactId: ctx.artifactId,
    userId: user.id,
    returnUrl,
  }));

  const authUrl = getGoogleAuthUrl(
    ctx.env,
    `/v1/data/${ctx.artifactId}/sheets/callback`,
    state
  );

  return Response.redirect(authUrl, 302);
}

export async function handleGoogleCallback(
  request: Request,
  ctx: DataContext
): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const stateParam = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) {
    return errorResponse({ code: 'OAUTH_ERROR', message: error, status: 400 });
  }

  if (!code || !stateParam) {
    return errorResponse({ ...DATA_ERRORS.INVALID_REQUEST, message: 'Missing code or state' });
  }

  let state: { artifactId: string; userId: string; returnUrl: string };
  try {
    state = JSON.parse(atob(stateParam));
  } catch {
    return errorResponse({ ...DATA_ERRORS.INVALID_REQUEST, message: 'Invalid state' });
  }

  try {
    const tokens = await exchangeCodeForTokens(
      code,
      `/v1/data/${ctx.artifactId}/sheets/callback`,
      ctx.env
    );

    await storeUserTokens(ctx.env, state.userId, tokens);

    return Response.redirect(`${ctx.env.SHAREOUT_BASE_URL}${state.returnUrl}?connected=true`, 302);
  } catch (err) {
    logError(
      createLogger(ctx.env, {
        scope: 'sheets',
        event: 'sheets.legacy_oauth_callback.failed',
        artifact_id: ctx.artifactId,
        user_id: state.userId,
      }),
      'sheets legacy oauth callback failed',
      err,
    );
    return errorResponse({
      code: 'OAUTH_ERROR',
      message: userFacingSheetsOAuthError(err),
      status: 500,
    });
  }
}

export async function getConnectionStatus(
  request: Request,
  ctx: DataContext
): Promise<Response> {
  const user = await getSessionUser(request, ctx.env);
  if (!user) {
    return successResponse({ connected: false, reason: 'not_logged_in' });
  }

  const connected = await hasGoogleConnection(ctx.env, user.id);
  return successResponse({ connected, userId: user.id });
}

export async function disconnectGoogle(
  request: Request,
  ctx: DataContext
): Promise<Response> {
  const user = await getSessionUser(request, ctx.env);
  if (!user) {
    return errorResponse(DATA_ERRORS.UNAUTHORIZED);
  }

  await revokeGoogleConnection(ctx.env, user.id);
  return successResponse({ disconnected: true });
}
