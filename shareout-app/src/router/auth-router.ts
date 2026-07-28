import {
  handleGoogleLogin,
  handleGoogleCallback,
  handleGoogleOneTap,
  handleLogout,
  handlePasswordAuth,
  handleCredentialsAuth,
  handleLinkGoogleStart,
  handleDevLogin,
} from '../auth';
import {
  handleCreateAccount,
  handleLinkEmail,
  handleGetProfile,
  handleUpdateProfile,
  validateToken,
  handleCreateAdminSession,
} from '../api-auth';
import {
  checkAccountCreation,
  rateLimitResponse,
  rateLimitHeaders,
  getClientIp,
} from '../rate-limit';
import {
  handlePasswordRegister,
  handlePasswordLogin,
  handlePasswordSet,
  handlePasswordStatus,
} from '../auth/password-routes';
import {
  handleEmailOtpStart,
  handleEmailOtpVerify,
  handleSessionInfo,
  handleLinkEmailOtpStart,
  handleLinkEmailOtpVerify,
  handleListLinkedAccounts,
  handleUnlinkAccount,
} from '../auth-otp';
import { handleClaimInvite } from '../workspaces-invite-email';
import { handleDeviceStart, handleDevicePoll, handleDevicePage, handleDeviceDone } from '../auth/device-auth';
import { handleListMyTokens, handleCreateMyToken } from '../api-me-tokens';
import { handleListMyLibraries } from '../workspace-library';
import { handleCreateLibraryModule } from '../publish';
import { handleSheetsOAuthCallback } from '../data/sheets/handler';
import { handleGitHubOAuthCallback } from '../data/github/handler';
import { unauthorized } from '../cors';
import { createLogger, logError } from '../logging';
import { isSheetsAuthCallback, isGitHubAuthCallback } from '../oauth-callback';
import type { FetchContext } from './context';
import { isLocalRequest } from './helpers/is-local-request';
import { getTokenOrSessionUser } from './helpers/auth-guard';
import { jsonError } from './helpers/json-response';
import { googleOAuthConfigured } from '../config/auth-providers';
import { appLoginPage } from '../auth/pages';

export async function routeAuth(ctx: FetchContext): Promise<Response | null> {
  try {
    return await routeAuthInner(ctx);
  } catch (err) {
    const logger = createLogger(ctx.env, {
      event: 'auth.handler_error',
      method: ctx.request.method,
      path: ctx.path,
    });
    logError(logger, 'auth route handler threw', err);
    return ctx.addCORS(jsonError('Internal server error', 'INTERNAL_ERROR', 500));
  }
}

async function routeAuthInner(ctx: FetchContext): Promise<Response | null> {
  const { request, env, path, url, hostname, addCORS } = ctx;

  if (path === '/v1/auth/email/start' && request.method === 'POST') {
    return addCORS(await handleEmailOtpStart(ctx));
  }

  if (path === '/v1/auth/email/verify' && request.method === 'POST') {
    return addCORS(await handleEmailOtpVerify(ctx));
  }

  if (path === '/v1/auth/session' && request.method === 'GET') {
    return addCORS(await handleSessionInfo(ctx));
  }

  // Password sign-in. `register` is the first-admin bootstrap and 404s once the
  // instance has a user; see auth/password-routes.ts.
  if (path === '/v1/auth/password/register' && request.method === 'POST') {
    return addCORS(await handlePasswordRegister(ctx));
  }

  if (path === '/v1/auth/password/login' && request.method === 'POST') {
    return addCORS(await handlePasswordLogin(ctx));
  }

  if (path === '/v1/auth/password' && request.method === 'POST') {
    return addCORS(await handlePasswordSet(ctx));
  }

  if (path === '/v1/auth/password' && request.method === 'GET') {
    return addCORS(await handlePasswordStatus(ctx));
  }

  if (path === '/v1/invites/claim' && request.method === 'POST') {
    const user = await getTokenOrSessionUser(ctx);
    if (!user) return addCORS(unauthorized());
    return addCORS(await handleClaimInvite(request, env, user));
  }

  if (path === '/v1/auth/create-account' && request.method === 'POST') {
    const isLocal = isLocalRequest(request, hostname);
    const hostHeader = request.headers.get('Host') || '';
    const ip = isLocal ? `dev:${hostHeader || hostname}` : getClientIp(request);
    const accountLimit = isLocal
      ? { allowed: true, limit: 0, remaining: 0, reset: 0 }
      : await checkAccountCreation(env, ip);
    if (!accountLimit.allowed) {
      return addCORS(rateLimitResponse(accountLimit));
    }
    const response = await handleCreateAccount(request, env, ctx.executionCtx);
    const headers = new Headers(response.headers);
    if (!isLocal) {
      for (const [key, value] of Object.entries(rateLimitHeaders(accountLimit))) {
        headers.set(key, value);
      }
    }
    return addCORS(new Response(response.body, { status: response.status, headers }));
  }

  if (path === '/v1/auth/link-email' && request.method === 'POST') {
    const user = await validateToken(request, env);
    if (!user) return addCORS(unauthorized());
    return addCORS(await handleLinkEmail(request, env, user));
  }

  if (path === '/v1/auth/profile' && request.method === 'GET') {
    const user = await validateToken(request, env);
    if (!user) return addCORS(unauthorized());
    return addCORS(await handleGetProfile(request, env, user));
  }

  if (path === '/v1/auth/profile' && (request.method === 'PUT' || request.method === 'PATCH')) {
    const user = await validateToken(request, env);
    if (!user) return addCORS(unauthorized());
    return addCORS(await handleUpdateProfile(request, env, user));
  }

  if (path === '/v1/auth/admin-session' && request.method === 'POST') {
    const user = await validateToken(request, env);
    if (!user) return addCORS(unauthorized());
    return addCORS(await handleCreateAdminSession(request, env, user));
  }

  if (path === '/v1/auth/link-google' && request.method === 'GET') {
    const user = await getTokenOrSessionUser(ctx);
    if (!user) return addCORS(unauthorized());
    const redirectTo = url.searchParams.get('redirect') || '/home';
    return handleLinkGoogleStart(user.id, redirectTo, env, 'identity');
  }

  if (path === '/v1/auth/linked-accounts' && request.method === 'GET') {
    return addCORS(await handleListLinkedAccounts(ctx));
  }

  if (path === '/v1/me/tokens' && request.method === 'GET') {
    const user = await getTokenOrSessionUser(ctx);
    if (!user) return addCORS(unauthorized());
    return addCORS(await handleListMyTokens(env, user));
  }

  if (path === '/v1/me/tokens' && request.method === 'POST') {
    const user = await getTokenOrSessionUser(ctx);
    if (!user) return addCORS(unauthorized());
    return addCORS(await handleCreateMyToken(request, env, user));
  }

  // Personal Workspace Library catalog ("my modules").
  if (path === '/v1/me/libraries' && request.method === 'GET') {
    const user = await getTokenOrSessionUser(ctx);
    if (!user) return addCORS(unauthorized());
    return addCORS(await handleListMyLibraries(env, user));
  }

  // Publish a library module from the in-app authoring form (session-authed). Handles
  // both scopes via the body (scope + workspace_id).
  if (path === '/v1/me/libraries' && request.method === 'POST') {
    const user = await getTokenOrSessionUser(ctx);
    if (!user) return addCORS(unauthorized());
    return addCORS(await handleCreateLibraryModule(env, user, request));
  }

  if (path.startsWith('/v1/auth/linked-accounts/') && request.method === 'DELETE') {
    const targetId = decodeURIComponent(path.slice('/v1/auth/linked-accounts/'.length));
    return addCORS(await handleUnlinkAccount(ctx, targetId));
  }

  if (path === '/v1/auth/link-email/start' && request.method === 'POST') {
    return addCORS(await handleLinkEmailOtpStart(ctx));
  }

  if (path === '/v1/auth/link-email/verify' && request.method === 'POST') {
    return addCORS(await handleLinkEmailOtpVerify(ctx));
  }

  if (path === '/auth/google/onetap' && request.method === 'POST') {
    if (!googleOAuthConfigured(env)) {
      return addCORS(jsonError('Google sign-in is not configured', 'GOOGLE_DISABLED', 404));
    }
    return handleGoogleOneTap(request, env);
  }

  // Device-authorization (CLI/agent login). start/token are unauthed —
  // the device_code itself is the secret; browser step proves identity via /auth/login.
  if (path === '/v1/auth/device/start' && request.method === 'POST') {
    return addCORS(await handleDeviceStart(request, env));
  }

  if (path === '/v1/auth/device/token' && request.method === 'POST') {
    return addCORS(await handleDevicePoll(request, env));
  }

  if (path === '/auth/device' && request.method === 'GET') {
    return await handleDevicePage(request, env);
  }

  if (path === '/auth/device/done' && request.method === 'GET') {
    return await handleDeviceDone(request, env);
  }

  if (path === '/auth/login' && request.method === 'GET') {
    const redirect = url.searchParams.get('redirect') || '/home';
    return appLoginPage({
      redirect,
      turnstileSiteKey: env.TURNSTILE_CLOUDFLARE_SITEKEY,
      googleEnabled: googleOAuthConfigured(env),
      loginHint: url.searchParams.get('login_hint'),
      emailConfigured: Boolean(env.EMAIL),
    });
  }

  if (path === '/auth/google') {
    if (!googleOAuthConfigured(env)) {
      const redirect = url.searchParams.get('redirect') || '/home';
      return Response.redirect(new URL(`/auth/login?redirect=${encodeURIComponent(redirect)}`, url.origin).toString(), 302);
    }
    return handleGoogleLogin(request, env);
  }

  if (path === '/auth/dev' && request.method === 'GET') {
    return handleDevLogin(request, env);
  }

  if (path === '/auth/callback') {
    if (isSheetsAuthCallback(request)) {
      return handleSheetsOAuthCallback(request, env);
    }
    if (isGitHubAuthCallback(request)) {
      return handleGitHubOAuthCallback(request, env);
    }
    return handleGoogleCallback(request, env, ctx.executionCtx);
  }

  if (path === '/auth/logout') {
    return handleLogout(request, env);
  }

  if (path === '/auth/password' && request.method === 'POST') {
    return handlePasswordAuth(request, env);
  }

  if (path === '/auth/credentials' && request.method === 'POST') {
    return handleCredentialsAuth(request, env);
  }

  return null;
}
