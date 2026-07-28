import type { Env } from '../types';
import { createSessionToken } from '../token';
import { autoJoinWorkspacesByDomain } from '../workspaces';
import { linkIdentity } from '../account-links';
import { COOKIE_NAME } from './constants';
import { cookieDomainAttr, isShareoutOrigin } from './cookies';
import { getPlatformHostname } from '../config/origins';
import { errorPage, linkSuccessPage } from './pages';
import { resolveSessionMaxAge } from './session';
import { linkGoogleToUser, upsertUser } from './users';
import { scheduleSeedStarterKit } from '../starter-kit';
import { scheduleWelcomeEmail, scheduleWorkspaceWelcome } from '../onboarding/welcome-email';
import { approveDeviceCode, deviceDonePage } from './device-auth';

interface GoogleTokens {
  access_token: string;
  id_token: string;
}

function buildGoogleAuthUrl(env: Env, state: string, loginHint?: string | null): string {
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', env.GOOGLE_CLIENT_ID || '');
  authUrl.searchParams.set('redirect_uri', `${env.SHAREOUT_BASE_URL}/auth/callback`);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'openid email profile');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('prompt', 'select_account');
  if (loginHint) authUrl.searchParams.set('login_hint', loginHint);
  return authUrl.toString();
}

export async function handleGoogleLogin(request: Request, env: Env): Promise<Response> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    const url = new URL(request.url);
    const redirectTo = url.searchParams.get('redirect') || '/home';
    return Response.redirect(new URL(`/auth/login?redirect=${encodeURIComponent(redirectTo)}`, url.origin).toString(), 302);
  }
  const url = new URL(request.url);
  const redirectTo = url.searchParams.get('redirect') || '/';
  const loginHint = url.searchParams.get('login_hint');
  const platformHost = getPlatformHostname(env);
  const apex = platformHost.replace(/^www\./, '');
  // Only bounce back to workspace subdomains — apex origin is redundant in state.
  const returnOrigin =
    isShareoutOrigin(url.origin, platformHost) &&
    url.hostname !== apex &&
    url.hostname !== `www.${apex}`
      ? url.origin
      : null;

  const state = btoa(JSON.stringify({ redirect: redirectTo, returnOrigin }));
  return Response.redirect(buildGoogleAuthUrl(env, state, loginHint), 302);
}

export async function handleLinkGoogleStart(
  userId: string,
  redirectTo: string,
  env: Env,
  linkAction: 'google' | 'identity' = 'google',
): Promise<Response> {
  const state = btoa(JSON.stringify({
    redirect: redirectTo,
    linkUserId: userId,
    linkAction,
  }));
  return Response.redirect(buildGoogleAuthUrl(env, state), 302);
}

async function exchangeCodeForTokens(code: string, env: Env): Promise<GoogleTokens> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID || '',
      client_secret: env.GOOGLE_CLIENT_SECRET || '',
      code,
      grant_type: 'authorization_code',
      redirect_uri: `${env.SHAREOUT_BASE_URL}/auth/callback`,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error('Google token exchange error:', errorBody);
    throw new Error(`Token exchange failed: ${response.status} - ${errorBody}`);
  }

  return response.json();
}

async function getGoogleUserInfo(accessToken: string): Promise<import('./users').GoogleUserInfo> {
  const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to get user info: ${response.status}`);
  }

  return response.json();
}

export async function handleGoogleCallback(request: Request, env: Env, executionCtx?: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description');

  console.log('OAuth callback received:', {
    hasCode: !!code,
    hasState: !!state,
    error,
    errorDescription,
    fullUrl: url.toString().substring(0, 200)
  });

  if (error) {
    return errorPage(`Login error: ${error} - ${errorDescription || 'cancelled'}`, '/');
  }

  if (!code) {
    return errorPage('Missing authorization code', '/');
  }

  let redirectTo = '/';
  let returnOrigin: string | null = null;
  let linkUserId: string | null = null;
  let linkAction: string | null = null;

  if (state) {
    try {
      const parsed = JSON.parse(atob(state));
      redirectTo = parsed.redirect || '/';
      returnOrigin = parsed.returnOrigin || null;
      linkUserId = parsed.linkUserId || null;
      linkAction = parsed.linkAction || null;
    } catch {}
  }

  // Carry the user back to the subdomain they logged in from. Guarded to same-zone
  // origins + path-only redirects, so this can't become an open redirect.
  const platformHost = getPlatformHostname(env);
  const finalLocation =
    isShareoutOrigin(returnOrigin, platformHost) && redirectTo.startsWith('/')
      ? returnOrigin + redirectTo
      : redirectTo;

  try {
    const tokens = await exchangeCodeForTokens(code, env);
    const userInfo = await getGoogleUserInfo(tokens.access_token);

    if (linkUserId && linkAction === 'google') {
      const result = await linkGoogleToUser(env, linkUserId, userInfo);
      if (!result.success) {
        return errorPage(result.error || 'Failed to link account', redirectTo);
      }
      return linkSuccessPage(userInfo.email, redirectTo);
    }

    // Identity linking: the OAuth'd Google account becomes (or matches) its own user
    // row, then joins the current session user's identity group.
    if (linkUserId && linkAction === 'identity') {
      const other = await upsertUser(env, userInfo);
      const result = await linkIdentity(env, linkUserId, other.id);
      if (!result.success) {
        return errorPage(result.error || 'Failed to link account', redirectTo);
      }
      return linkSuccessPage(userInfo.email, redirectTo);
    }

    const user = await upsertUser(env, userInfo);
    await autoJoinWorkspacesByDomain(env, user.id, user.email);
    // First-ever activation. A true self-signup gets the personal starter kit + generic
    // welcome. A pre-created invitee (row existed but never logged in) instead gets a
    // welcome scoped to the workspace they were invited to — no personal kit.
    if (user.firstActivation) {
      if (user.isNew) {
        scheduleSeedStarterKit(env, { id: user.id, email: user.email, username: null }, { workspaceId: null, tier: 'personal' }, executionCtx);
        scheduleWelcomeEmail(env, user.email, executionCtx);
      } else {
        scheduleWorkspaceWelcome(env, user.id, user.email, executionCtx);
      }
    }
    const maxAge = await resolveSessionMaxAge(env, user.id);
    const sessionToken = await createSessionToken(user.id, user.email, env, maxAge);
    const sessionCookie = `${COOKIE_NAME}=${sessionToken}; Path=/; HttpOnly; Secure; SameSite=Lax;${cookieDomainAttr(url.hostname, platformHost)} Max-Age=${maxAge}`;

    // Device-authorization (CLI) login: the browser was sent here from /auth/device with
    // the CLI's user_code carried in the redirect. We now have the authenticated user, so
    // mint + bind the `so_` token here, then show the "return to your terminal" page.
    const deviceMatch = redirectTo.match(/^\/auth\/device\/done\?code=([^&]+)/);
    if (deviceMatch) {
      const userCode = decodeURIComponent(deviceMatch[1]);
      const result = await approveDeviceCode(env, userCode, user.id, user.email);
      if (!result.ok) return errorPage(result.error, '/');
      const page = deviceDonePage(user.email, result.warn);
      page.headers.set('Set-Cookie', sessionCookie);
      return page;
    }

    return new Response(null, {
      status: 302,
      headers: {
        Location: finalLocation,
        'Set-Cookie': sessionCookie,
      },
    });
  } catch (err: any) {
    console.error('OAuth error:', err?.message || err);
    const errorMsg = err?.message || 'Authentication failed';
    return errorPage(`Auth error: ${errorMsg}`, redirectTo);
  }
}
