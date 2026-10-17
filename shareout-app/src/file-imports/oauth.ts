/**
 * OAuth 2.0 authorization-code flow for the file consent. This is NOT sign-in: it is a
 * second, read-only consent a member gives inside a workspace, with its own client ids,
 * so the login apps never carry file scopes.
 *
 * Google: drive.readonly, offline access. Microsoft: delegated Files.Read.All (OneDrive +
 * document libraries) and Sites.Read.All (finding SharePoint sites), plus User.Read for
 * the account label and offline_access for a refresh token.
 *   https://developers.google.com/identity/protocols/oauth2/web-server
 *   https://developers.google.com/workspace/drive/api/guides/api-specific-auth
 *   https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
 *   https://learn.microsoft.com/en-us/graph/permissions-reference
 *
 * The state is HMAC-signed (CREDENTIALS_KEY) and names the workspace and user; the
 * callback also requires the signed-in user to be that user. PKCE's verifier is derived
 * from the same key and the state's nonce, so nothing needs storing between the hops.
 */
import type { Env } from '../types';
import type { FileImportProvider } from './types';
import { errorText } from './http';

export const GOOGLE_SCOPES = ['https://www.googleapis.com/auth/drive.readonly'];
export const MICROSOFT_SCOPES = ['Files.Read.All', 'Sites.Read.All', 'User.Read', 'offline_access'];

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE = 'https://oauth2.googleapis.com/revoke';
const STATE_TTL_MS = 10 * 60 * 1000;

interface ProviderConfig {
  clientId: string;
  clientSecret: string;
  authUrl: string;
  tokenUrl: string;
  scopes: string[];
  extraAuthParams: Record<string, string>;
}

function msTenant(env: Env): string {
  const t = (env.MICROSOFT_FILES_TENANT || 'common').trim();
  return /^[A-Za-z0-9.-]{1,100}$/.test(t) ? t : 'common';
}

export function providerConfig(env: Env, provider: FileImportProvider): ProviderConfig | null {
  if (!env.CREDENTIALS_KEY) return null;
  if (provider === 'google_drive') {
    if (!env.GOOGLE_DRIVE_CLIENT_ID || !env.GOOGLE_DRIVE_CLIENT_SECRET) return null;
    return {
      clientId: env.GOOGLE_DRIVE_CLIENT_ID, clientSecret: env.GOOGLE_DRIVE_CLIENT_SECRET,
      authUrl: GOOGLE_AUTH, tokenUrl: GOOGLE_TOKEN, scopes: GOOGLE_SCOPES,
      // offline + consent: Google only returns a refresh token on a fresh consent.
      extraAuthParams: { access_type: 'offline', prompt: 'consent' },
    };
  }
  if (!env.MICROSOFT_FILES_CLIENT_ID || !env.MICROSOFT_FILES_CLIENT_SECRET) return null;
  const base = `https://login.microsoftonline.com/${msTenant(env)}/oauth2/v2.0`;
  return {
    clientId: env.MICROSOFT_FILES_CLIENT_ID, clientSecret: env.MICROSOFT_FILES_CLIENT_SECRET,
    authUrl: `${base}/authorize`, tokenUrl: `${base}/token`, scopes: MICROSOFT_SCOPES,
    extraAuthParams: { response_mode: 'query', prompt: 'select_account' },
  };
}

/** Providers this instance has configured. Empty = the feature is hidden. */
export function configuredProviders(env: Env): FileImportProvider[] {
  return (['google_drive', 'microsoft'] as const).filter((p) => providerConfig(env, p));
}

export function redirectUri(env: Env, provider: FileImportProvider): string {
  return `${(env.SHAREOUT_BASE_URL || '').replace(/\/+$/, '')}/v1/file-imports/oauth/${provider}/callback`;
}

// ---- signed state + PKCE ---------------------------------------------------------

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): string {
  return atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
}

async function hmac(key: string, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', k, new TextEncoder().encode(data));
}

export interface OAuthState {
  p: FileImportProvider;
  ws: string;
  u: string;
  n: string;
  exp: number;
}

export async function signState(env: Env, s: Omit<OAuthState, 'n' | 'exp'>, now = Date.now()): Promise<string> {
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const body = b64url(new TextEncoder().encode(JSON.stringify({ ...s, n: nonce, exp: now + STATE_TTL_MS })));
  return `${body}.${b64url(await hmac(env.CREDENTIALS_KEY!, `state:${body}`))}`;
}

/** The state's claims, or null when tampered with, expired, or malformed. */
export async function verifyState(env: Env, raw: string, now = Date.now()): Promise<OAuthState | null> {
  if (!env.CREDENTIALS_KEY) return null;
  const [body, sig] = raw.split('.');
  if (!body || !sig) return null;
  const want = b64url(await hmac(env.CREDENTIALS_KEY, `state:${body}`));
  if (want.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff) return null;
  try {
    const s = JSON.parse(fromB64url(body)) as OAuthState;
    return typeof s.exp === 'number' && s.exp > now && typeof s.ws === 'string' && typeof s.u === 'string' ? s : null;
  } catch { return null; }
}

async function pkceVerifier(env: Env, nonce: string): Promise<string> {
  return b64url(await hmac(env.CREDENTIALS_KEY!, `pkce:${nonce}`));
}

async function pkceChallenge(verifier: string): Promise<string> {
  return b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
}

function nonceOf(state: string): string {
  try { return (JSON.parse(fromB64url(state.split('.')[0])) as OAuthState).n; } catch { return ''; }
}

export async function authorizationUrl(env: Env, provider: FileImportProvider, workspaceId: string, userId: string): Promise<string | null> {
  const cfg = providerConfig(env, provider);
  if (!cfg) return null;
  const state = await signState(env, { p: provider, ws: workspaceId, u: userId });
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri(env, provider),
    response_type: 'code',
    scope: cfg.scopes.join(' '),
    state,
    code_challenge: await pkceChallenge(await pkceVerifier(env, nonceOf(state))),
    code_challenge_method: 'S256',
    ...cfg.extraAuthParams,
  });
  return `${cfg.authUrl}?${params}`;
}

// ---- token endpoint --------------------------------------------------------------

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  scope: string;
}

interface TokenResponse { access_token: string; refresh_token?: string; expires_in?: number; scope?: string }

export class OAuthGrantError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

async function tokenRequest(cfg: ProviderConfig, form: Record<string, string>): Promise<TokenSet> {
  const res = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, ...form }),
  });
  if (!res.ok) {
    const msg = await errorText(res);
    throw new OAuthGrantError(res.status === 400 || res.status === 401 ? 'INVALID_GRANT' : 'TOKEN_ERROR', msg);
  }
  const t = await res.json() as TokenResponse;
  if (!t.access_token) throw new OAuthGrantError('TOKEN_ERROR', 'No access token in the response');
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token || '',
    expiresAt: new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString(),
    scope: t.scope || cfg.scopes.join(' '),
  };
}

export async function exchangeCode(env: Env, provider: FileImportProvider, code: string, state: string): Promise<TokenSet> {
  const cfg = providerConfig(env, provider);
  if (!cfg) throw new OAuthGrantError('NOT_CONFIGURED', 'This provider is not configured');
  return tokenRequest(cfg, {
    grant_type: 'authorization_code', code, redirect_uri: redirectUri(env, provider),
    code_verifier: await pkceVerifier(env, nonceOf(state)),
  });
}

export async function refreshTokens(env: Env, provider: FileImportProvider, refreshToken: string): Promise<TokenSet> {
  const cfg = providerConfig(env, provider);
  if (!cfg) throw new OAuthGrantError('NOT_CONFIGURED', 'This provider is not configured');
  const t = await tokenRequest(cfg, {
    grant_type: 'refresh_token', refresh_token: refreshToken,
    ...(provider === 'microsoft' ? { scope: cfg.scopes.join(' ') } : {}),
  });
  // Google keeps the refresh token; Microsoft rotates it. Keep the old one when absent.
  return { ...t, refreshToken: t.refreshToken || refreshToken };
}

/** Best-effort revoke at the provider. Microsoft has no per-token revoke for this flow;
 *  deleting our copy is what ends access there. */
export async function revokeAtProvider(provider: FileImportProvider, token: string): Promise<void> {
  if (provider !== 'google_drive' || !token) return;
  await fetch(GOOGLE_REVOKE, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }),
  }).catch(() => {});
}

/** The account's email, for the "Connected as …" label. */
export async function accountEmail(provider: FileImportProvider, accessToken: string): Promise<string | null> {
  const url = provider === 'google_drive'
    ? 'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)'
    : 'https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName';
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } }).catch(() => null);
  if (!res?.ok) return null;
  const j = await res.json().catch(() => null) as { user?: { emailAddress?: string }; mail?: string; userPrincipalName?: string } | null;
  return (j?.user?.emailAddress || j?.mail || j?.userPrincipalName || null)?.slice(0, 320) ?? null;
}
