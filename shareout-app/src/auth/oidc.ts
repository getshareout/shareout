/**
 * Workspace SSO over OpenID Connect (authorization code + PKCE). Works with any OIDC
 * IdP; Okta is the one it is tested against.
 *
 * GET /auth/sso?workspace=<slug>|login_hint=<email>&redirect=/path  → IdP
 * GET /auth/sso/callback                                           → session cookie
 *
 * State, nonce and the PKCE verifier ride in a short-lived HMAC-signed cookie scoped
 * to the platform apex, so a login started on a workspace subdomain completes at the
 * single registered redirect URI (`$SHAREOUT_BASE_URL/auth/sso/callback`).
 */
import type { Env } from '../types';
import { createSessionToken, signPayload, verifySignature } from '../token';
import { autoJoinWorkspacesByDomain } from '../workspaces/access-policy';
import { invalidateWorkspaceRole } from '../workspaces/roles';
import { generateId } from '../crypto-utils';
import { getPlatformHostname } from '../config/origins';
import { parseSubdomainFromEnv } from '../subdomain';
import { buildSessionCookie, cookieDomainAttr, cookieSecureAttr, isShareoutOrigin } from './cookies';
import { errorPage } from './pages';
import { resolveSessionMaxAge } from './session';
import { upsertUserByEmail } from './users';
import { scheduleWorkspaceWelcome } from '../onboarding/welcome-email';
import {
  emailDomain,
  getSsoClientSecret,
  getSsoConfigBySlug,
  getSsoConfigByWorkspaceId,
  getSsoConfigForEmail,
  type SsoConfig,
} from './sso-config';

const STATE_COOKIE = 'so_sso';
const STATE_TTL_SECONDS = 600;
const CLOCK_SKEW_SECONDS = 60;
const CACHE_TTL_MS = 3600_000;

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

interface SsoState {
  state: string;
  nonce: string;
  verifier: string;
  workspaceId: string;
  redirect: string;
  returnOrigin: string | null;
  exp: number;
}

export interface IdTokenClaims {
  iss: string;
  sub: string;
  aud: string | string[];
  azp?: string;
  exp: number;
  nonce?: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
}

const discoveryCache = new Map<string, { doc: Discovery; expiresAt: number }>();
const jwksCache = new Map<string, { keys: Record<string, CryptoKey>; expiresAt: number }>();

export function resetOidcCaches(): void {
  discoveryCache.clear();
  jwksCache.clear();
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(input: string): Uint8Array {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
  const bin = atob((input + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function randomToken(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

export async function discover(issuer: string): Promise<Discovery> {
  const cached = discoveryCache.get(issuer);
  if (cached && cached.expiresAt > Date.now()) return cached.doc;
  const res = await fetch(`${issuer}/.well-known/openid-configuration`);
  if (!res.ok) throw new Error(`OIDC discovery failed (${res.status}) for ${issuer}`);
  const doc = await res.json<Discovery>();
  if ((doc.issuer || '').replace(/\/$/, '') !== issuer) {
    throw new Error(`OIDC discovery issuer mismatch: expected ${issuer}, got ${doc.issuer}`);
  }
  if (!doc.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri) {
    throw new Error('OIDC discovery document is missing endpoints');
  }
  discoveryCache.set(issuer, { doc, expiresAt: Date.now() + CACHE_TTL_MS });
  return doc;
}

async function signingKey(jwksUri: string, kid: string): Promise<CryptoKey> {
  const cached = jwksCache.get(jwksUri);
  if (cached && cached.expiresAt > Date.now() && cached.keys[kid]) return cached.keys[kid];
  // Unknown kid on a warm cache = the IdP rotated keys; refetch once.
  const res = await fetch(jwksUri);
  if (!res.ok) throw new Error('Failed to fetch IdP signing keys');
  const jwks = await res.json<{ keys: Array<JsonWebKey & { kid?: string; kty?: string; use?: string }> }>();
  const keys: Record<string, CryptoKey> = {};
  for (const jwk of jwks.keys || []) {
    if (jwk.kty !== 'RSA' || !jwk.kid || (jwk.use && jwk.use !== 'sig')) continue;
    keys[jwk.kid] = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
  }
  jwksCache.set(jwksUri, { keys, expiresAt: Date.now() + CACHE_TTL_MS });
  const key = keys[kid];
  if (!key) throw new Error('Unknown signing key');
  return key;
}

export async function verifyIdToken(
  idToken: string,
  expected: { issuer: string; clientId: string; jwksUri: string; nonce: string },
): Promise<IdTokenClaims> {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('Malformed ID token');
  const [headerB64, payloadB64, sigB64] = parts;
  const header = JSON.parse(new TextDecoder().decode(base64UrlDecode(headerB64)));
  if (header.alg !== 'RS256') throw new Error('Unexpected token algorithm');

  const key = await signingKey(expected.jwksUri, header.kid);
  const valid = await crypto.subtle.verify(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    base64UrlDecode(sigB64),
    new TextEncoder().encode(`${headerB64}.${payloadB64}`),
  );
  if (!valid) throw new Error('Invalid ID token signature');

  const claims: IdTokenClaims = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadB64)));
  if ((claims.iss || '').replace(/\/$/, '') !== expected.issuer) throw new Error('Wrong issuer');
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(expected.clientId)) throw new Error('Wrong audience');
  if (aud.length > 1 && claims.azp !== expected.clientId) throw new Error('Wrong authorized party');
  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_SECONDS < Date.now() / 1000) {
    throw new Error('Expired ID token');
  }
  if (!claims.nonce || claims.nonce !== expected.nonce) throw new Error('Nonce mismatch');
  return claims;
}

function callbackUrl(env: Env): string {
  return `${env.SHAREOUT_BASE_URL.replace(/\/$/, '')}/auth/sso/callback`;
}

async function encodeState(state: SsoState, env: Env): Promise<string> {
  const data = base64UrlEncode(new TextEncoder().encode(JSON.stringify(state)));
  const sig = await signPayload(data, env.SESSION_SECRET);
  return `${data}.${base64UrlEncode(Uint8Array.from(atob(sig), (c) => c.charCodeAt(0)))}`;
}

async function decodeState(raw: string | null, env: Env): Promise<SsoState | null> {
  if (!raw) return null;
  const [data, sigB64Url] = raw.split('.');
  if (!data || !sigB64Url) return null;
  const sig = btoa(String.fromCharCode(...base64UrlDecode(sigB64Url)));
  try {
    if (!(await verifySignature(data, sig, env.SESSION_SECRET))) return null;
    const state: SsoState = JSON.parse(new TextDecoder().decode(base64UrlDecode(data)));
    return state.exp > Date.now() / 1000 ? state : null;
  } catch {
    return null;
  }
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

function stateCookie(url: URL, env: Env, value: string, maxAge: number): string {
  return `${STATE_COOKIE}=${value}; Path=/auth/sso; HttpOnly;${cookieSecureAttr(url)} SameSite=Lax;${cookieDomainAttr(url.hostname, getPlatformHostname(env))} Max-Age=${maxAge}`;
}

async function resolveConfig(url: URL, env: Env): Promise<SsoConfig | null> {
  const slug = url.searchParams.get('workspace') || parseSubdomainFromEnv(url.hostname, env).workspaceSlug;
  if (slug) return getSsoConfigBySlug(env, slug);
  const hint = url.searchParams.get('login_hint');
  return hint ? getSsoConfigForEmail(env, hint) : null;
}

export async function handleSsoStart(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const redirectParam = url.searchParams.get('redirect') || '';
  const redirect = redirectParam.startsWith('/') && !redirectParam.startsWith('//') ? redirectParam : '/home';

  const config = await resolveConfig(url, env);
  if (!config) return errorPage('Single sign-on is not set up for this workspace.', '/auth/login');

  let discovery: Discovery;
  try {
    discovery = await discover(config.issuer);
  } catch (err: any) {
    console.error('SSO discovery failed:', err?.message || err);
    return errorPage('Your identity provider could not be reached. Try again in a minute.', '/auth/login');
  }

  const platformHost = getPlatformHostname(env);
  const apex = platformHost.replace(/^www\./, '');
  const returnOrigin =
    isShareoutOrigin(url.origin, platformHost) && url.hostname !== apex && url.hostname !== `www.${apex}`
      ? url.origin
      : null;

  const state: SsoState = {
    state: randomToken(),
    nonce: randomToken(),
    verifier: randomToken(),
    workspaceId: config.workspaceId,
    redirect,
    returnOrigin,
    exp: Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS,
  };

  const authUrl = new URL(discovery.authorization_endpoint);
  authUrl.searchParams.set('client_id', config.clientId);
  authUrl.searchParams.set('redirect_uri', callbackUrl(env));
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'openid email profile');
  authUrl.searchParams.set('state', state.state);
  authUrl.searchParams.set('nonce', state.nonce);
  authUrl.searchParams.set('code_challenge', await pkceChallenge(state.verifier));
  authUrl.searchParams.set('code_challenge_method', 'S256');
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

async function exchangeCode(
  discovery: Discovery,
  config: SsoConfig,
  secret: string,
  code: string,
  verifier: string,
  env: Env,
): Promise<{ id_token: string }> {
  const res = await fetch(discovery.token_endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      Authorization: `Basic ${btoa(`${config.clientId}:${secret}`)}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: callbackUrl(env),
      code_verifier: verifier,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error('SSO token exchange error:', res.status, body.slice(0, 500));
    throw new Error(`Token exchange failed (${res.status})`);
  }
  const tokens = await res.json<{ id_token?: string }>();
  if (!tokens.id_token) throw new Error('IdP returned no ID token');
  return { id_token: tokens.id_token };
}

async function ensureMember(env: Env, workspaceId: string, userId: string): Promise<void> {
  const existing = await env.DB.prepare(
    'SELECT id FROM workspace_members WHERE workspace_id = ? AND user_id = ?',
  ).bind(workspaceId, userId).first();
  if (existing) return;
  await env.DB.prepare(
    "INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES (?, ?, ?, 'member')",
  ).bind(generateId('wsm'), workspaceId, userId).run();
  await invalidateWorkspaceRole(env, workspaceId, userId);
}

export async function handleSsoCallback(request: Request, env: Env, executionCtx?: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const clearState = stateCookie(url, env, '', 0);
  const fail = (message: string) => {
    const page = errorPage(message, '/auth/login');
    page.headers.append('Set-Cookie', clearState);
    return page;
  };

  const idpError = url.searchParams.get('error');
  if (idpError) {
    const description = url.searchParams.get('error_description');
    return fail(`Sign-in was not completed: ${description || idpError}`);
  }

  const saved = await decodeState(readCookie(request, STATE_COOKIE), env);
  const code = url.searchParams.get('code');
  if (!saved || !code || url.searchParams.get('state') !== saved.state) {
    return fail('This sign-in link expired or was opened in another browser. Start again.');
  }

  const config = await getSsoConfigByWorkspaceId(env, saved.workspaceId);
  if (!config) return fail('Single sign-on is no longer set up for this workspace.');

  let claims: IdTokenClaims;
  try {
    const discovery = await discover(config.issuer);
    const secret = await getSsoClientSecret(env, config.workspaceId);
    const { id_token } = await exchangeCode(discovery, config, secret, code, saved.verifier, env);
    claims = await verifyIdToken(id_token, {
      issuer: config.issuer,
      clientId: config.clientId,
      jwksUri: discovery.jwks_uri,
      nonce: saved.nonce,
    });
  } catch (err: any) {
    console.error('SSO callback failed:', err?.message || err);
    return fail('Single sign-on failed. Try again, or contact your administrator.');
  }

  const email = (claims.email || '').trim().toLowerCase();
  if (!email) return fail('Your identity provider did not share an email address. Ask your administrator to grant the "email" scope.');
  if (claims.email_verified === false || claims.email_verified === 'false') {
    return fail('Your identity provider reports this email address as unverified.');
  }
  if (!config.emailDomains.includes(emailDomain(email))) {
    return fail(`${email} cannot sign in through this workspace's single sign-on.`);
  }

  // The instance owner vouched for these domains when configuring SSO: an invitation.
  const user = await upsertUserByEmail(env, email, { invited: true });
  await ensureMember(env, config.workspaceId, user.id);
  await autoJoinWorkspacesByDomain(env, user.id, user.email);
  // SSO people arrive as members of the customer's workspace, so they get its welcome
  // rather than the personal starter kit a self-signup gets.
  if (user.firstActivation) scheduleWorkspaceWelcome(env, user.id, user.email, executionCtx);

  const maxAge = await resolveSessionMaxAge(env, user.id);
  const token = await createSessionToken(user.id, user.email, env, maxAge);
  const platformHost = getPlatformHostname(env);
  const location = isShareoutOrigin(saved.returnOrigin, platformHost) ? saved.returnOrigin + saved.redirect : saved.redirect;

  const headers = new Headers({ Location: location });
  headers.append('Set-Cookie', buildSessionCookie(url, token, maxAge, platformHost));
  headers.append('Set-Cookie', clearState);
  return new Response(null, { status: 302, headers });
}
