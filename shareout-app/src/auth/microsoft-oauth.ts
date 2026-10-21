/**
 * Sign in with Microsoft — personal accounts and work/school (Entra ID) accounts through
 * the Microsoft identity platform v2.0 (authorization code + PKCE, OpenID Connect).
 *
 * GET /auth/microsoft?redirect=/path   → login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize
 * GET /auth/microsoft/callback         → session cookie
 *
 * `MICROSOFT_TENANT` picks the authority: `common` (default: both account kinds),
 * `organizations`, `consumers`, or one directory's tenant GUID. Tenant-independent
 * authorities publish the templated issuer `https://login.microsoftonline.com/{tenantid}/v2.0`;
 * `verifyIdToken` resolves it against the token's `tid`.
 *
 * Email trust: Microsoft documents `email` as unverified and mutable. Personal accounts'
 * addresses are verified by Microsoft; a work/school address is trusted only when the
 * `xms_edov` optional claim says its domain owner is verified.
 */
import type { Env } from '../types';
import { createSessionToken } from '../token';
import { autoJoinWorkspacesByDomain } from '../workspaces/access-policy';
import { getPlatformHostname } from '../config/origins';
import { microsoftTenant } from '../config/auth-providers';
import { buildSessionCookie, cookieDomainAttr, cookieSecureAttr, isShareoutOrigin } from './cookies';
import { errorPage, safeRedirect } from './pages';
import { resolveSessionMaxAge } from './session';
import { upsertMicrosoftUser } from './users';
import { ssoRequiredFor, ssoStartPath } from './sso-config';
import { scheduleSeedStarterKit } from '../starter-kit/schedule';
import { scheduleWelcomeEmail, scheduleWorkspaceWelcome } from '../onboarding/welcome-email';
import {
  claimFlag,
  decodeState,
  encodeState,
  isGuid,
  pkceChallenge,
  randomToken,
  readCookie,
  TENANT_ID_PLACEHOLDER,
  verifyIdToken,
  type IdTokenClaims,
} from './oidc';

const AUTHORITY = 'https://login.microsoftonline.com';
/** `tid` of every personal Microsoft account. */
export const CONSUMER_TENANT_ID = '9188040d-6c67-4c5b-b112-36a304b66dad';
const STATE_COOKIE = 'so_ms';
const STATE_TTL_SECONDS = 600;
const SCOPE = 'openid email profile';
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface MicrosoftState {
  state: string;
  nonce: string;
  verifier: string;
  redirect: string;
  returnOrigin: string | null;
  exp: number;
}

function callbackUrl(env: Env): string {
  return `${env.SHAREOUT_BASE_URL.replace(/\/$/, '')}/auth/microsoft/callback`;
}

export function microsoftIssuer(tenant: string): string {
  return `${AUTHORITY}/${isGuid(tenant) ? tenant : TENANT_ID_PLACEHOLDER}/v2.0`;
}

function stateCookie(url: URL, env: Env, value: string, maxAge: number): string {
  return `${STATE_COOKIE}=${value}; Path=/auth/microsoft; HttpOnly;${cookieSecureAttr(url)} SameSite=Lax;${cookieDomainAttr(url.hostname, getPlatformHostname(env))} Max-Age=${maxAge}`;
}

/**
 * The address a verified token proves, or the reason it proves none.
 * - personal account (`tid` = consumer tenant): `email`, else an email-shaped
 *   `preferred_username` (the account's sign-in name, verified by Microsoft); refused if
 *   `xms_edov` is explicitly false.
 * - work/school account: `email` only, and only with `xms_edov` true. `preferred_username`
 *   is usually the UPN, which nothing verifies as a mailbox.
 */
export function microsoftVerifiedEmail(claims: IdTokenClaims): { email: string } | { error: string } {
  const personal = claims.tid === CONSUMER_TENANT_ID;
  const edov = claimFlag(claims.xms_edov);
  const email = (claims.email || '').trim().toLowerCase();
  const username = (claims.preferred_username || '').trim().toLowerCase();

  if (personal) {
    if (edov === false) return { error: 'Microsoft reports this email address as unverified.' };
    if (email && EMAIL_SHAPE.test(email)) return { email };
    if (username && EMAIL_SHAPE.test(username)) return { email: username };
    return { error: 'Your Microsoft account did not share an email address.' };
  }
  if (!email || !EMAIL_SHAPE.test(email)) {
    return { error: 'Your work or school account did not share an email address. Ask your administrator to add the "email" claim.' };
  }
  if (edov !== true) {
    return { error: 'Microsoft could not confirm this work or school email address. Sign in with an email code instead, or ask your administrator to verify the domain in Microsoft Entra ID.' };
  }
  return { email };
}

export async function handleMicrosoftLogin(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const tenant = microsoftTenant(env)!;
  const platformHost = getPlatformHostname(env);
  const apex = platformHost.replace(/^www\./, '');
  const returnOrigin =
    isShareoutOrigin(url.origin, platformHost) && url.hostname !== apex && url.hostname !== `www.${apex}`
      ? url.origin
      : null;

  const state: MicrosoftState = {
    state: randomToken(),
    nonce: randomToken(),
    verifier: randomToken(),
    redirect: safeRedirect(url.searchParams.get('redirect')),
    returnOrigin,
    exp: Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS,
  };

  const authUrl = new URL(`${AUTHORITY}/${tenant}/oauth2/v2.0/authorize`);
  authUrl.searchParams.set('client_id', env.MICROSOFT_CLIENT_ID || '');
  authUrl.searchParams.set('redirect_uri', callbackUrl(env));
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('response_mode', 'query');
  authUrl.searchParams.set('scope', SCOPE);
  authUrl.searchParams.set('state', state.state);
  authUrl.searchParams.set('nonce', state.nonce);
  authUrl.searchParams.set('code_challenge', await pkceChallenge(state.verifier));
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('prompt', 'select_account');
  const loginHint = url.searchParams.get('login_hint');
  if (loginHint) authUrl.searchParams.set('login_hint', loginHint);

  return new Response(null, {
    status: 302,
    headers: {
      Location: authUrl.toString(),
      'Set-Cookie': stateCookie(url, env, await encodeState(state, env), STATE_TTL_SECONDS),
    },
  });
}

async function exchangeCode(env: Env, tenant: string, code: string, verifier: string): Promise<string> {
  const res = await fetch(`${AUTHORITY}/${tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      client_id: env.MICROSOFT_CLIENT_ID || '',
      client_secret: env.MICROSOFT_CLIENT_SECRET || '',
      grant_type: 'authorization_code',
      code,
      redirect_uri: callbackUrl(env),
      code_verifier: verifier,
      scope: SCOPE,
    }),
  });
  if (!res.ok) {
    console.error('Microsoft token exchange error:', res.status, (await res.text()).slice(0, 500));
    throw new Error(`Token exchange failed (${res.status})`);
  }
  const tokens = await res.json<{ id_token?: string }>();
  if (!tokens.id_token) throw new Error('Microsoft returned no ID token');
  return tokens.id_token;
}

/** Verify a Microsoft ID token for this instance's app registration and tenant setting. */
export async function verifyMicrosoftIdToken(env: Env, idToken: string, nonce: string): Promise<IdTokenClaims> {
  const tenant = microsoftTenant(env);
  if (!tenant) throw new Error('MICROSOFT_TENANT is not a valid tenant');
  const claims = await verifyIdToken(idToken, {
    issuer: microsoftIssuer(tenant),
    clientId: env.MICROSOFT_CLIENT_ID || '',
    jwksUri: `${AUTHORITY}/${tenant}/discovery/v2.0/keys`,
    nonce,
  });
  if (tenant === 'organizations' && claims.tid === CONSUMER_TENANT_ID) throw new Error('Personal accounts are not allowed');
  if (tenant === 'consumers' && claims.tid !== CONSUMER_TENANT_ID) throw new Error('Only personal accounts are allowed');
  return claims;
}

export async function handleMicrosoftCallback(request: Request, env: Env, executionCtx?: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const clearState = stateCookie(url, env, '', 0);
  const fail = (message: string) => {
    const page = errorPage(message, '/auth/login');
    page.headers.append('Set-Cookie', clearState);
    return page;
  };

  const idpError = url.searchParams.get('error');
  if (idpError) return fail(`Sign-in was not completed: ${url.searchParams.get('error_description') || idpError}`);

  const saved = await decodeState<MicrosoftState>(readCookie(request, STATE_COOKIE), env);
  const code = url.searchParams.get('code');
  if (!saved || !code || url.searchParams.get('state') !== saved.state) {
    return fail('This sign-in link expired or was opened in another browser. Start again.');
  }

  let claims: IdTokenClaims;
  try {
    const idToken = await exchangeCode(env, microsoftTenant(env) || 'common', code, saved.verifier);
    claims = await verifyMicrosoftIdToken(env, idToken, saved.nonce);
  } catch (err: any) {
    console.error('Microsoft sign-in failed:', err?.message || err);
    return fail('Microsoft sign-in failed. Try again, or use another sign-in method.');
  }

  const verified = microsoftVerifiedEmail(claims);
  if ('error' in verified) return fail(verified.error);
  const { email } = verified;

  const sso = await ssoRequiredFor(env, email);
  if (sso) {
    const headers = new Headers({ Location: new URL(ssoStartPath(sso.workspaceSlug, saved.redirect, email), env.SHAREOUT_BASE_URL).toString() });
    headers.append('Set-Cookie', clearState);
    return new Response(null, { status: 302, headers });
  }

  let user: Awaited<ReturnType<typeof upsertMicrosoftUser>>;
  try {
    user = await upsertMicrosoftUser(env, { microsoftId: `${claims.tid}:${claims.oid || claims.sub}`, email, name: claims.name });
  } catch (err: any) {
    return fail(err?.message || 'Sign-in failed');
  }

  const autoJoined = await autoJoinWorkspacesByDomain(env, user.id, user.email);
  if (user.firstActivation) {
    if (user.isNew && !autoJoined) {
      scheduleSeedStarterKit(env, { id: user.id, email: user.email, username: null }, { workspaceId: null, tier: 'personal' }, executionCtx);
      scheduleWelcomeEmail(env, user.email, executionCtx);
    } else {
      scheduleWorkspaceWelcome(env, user.id, user.email, executionCtx);
    }
  }

  const maxAge = await resolveSessionMaxAge(env, user.id);
  const token = await createSessionToken(user.id, user.email, env, maxAge);
  const platformHost = getPlatformHostname(env);
  const sessionCookie = buildSessionCookie(url, token, maxAge, platformHost);

  const location = isShareoutOrigin(saved.returnOrigin, platformHost) ? saved.returnOrigin + saved.redirect : saved.redirect;
  const headers = new Headers({ Location: location });
  headers.append('Set-Cookie', sessionCookie);
  headers.append('Set-Cookie', clearState);
  return new Response(null, { status: 302, headers });
}
