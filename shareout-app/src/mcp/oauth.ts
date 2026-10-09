/**
 * OAuth 2.1 authorization server for the remote MCP connector.
 *
 * What AI apps (claude.ai, Claude Desktop, ChatGPT) need to add ShareOut by URL and
 * sign the person in: RFC 8414 metadata, RFC 7591 dynamic registration, an authorization
 * endpoint gated on the normal ShareOut session (PKCE S256 + state mandatory), a token
 * endpoint with refresh-token rotation, and RFC 7009 revocation.
 *
 * Access tokens are plain short-lived `so_` personal tokens (a `tokens` row with
 * `expires_at`), so `validateToken` and every existing authz check apply unchanged.
 * Codes and refresh tokens are stored hashed. Error bodies follow RFC 6749
 * (`{ error, error_description }`) — clients key on those codes, so they deliberately
 * do not use the ShareOut API envelope.
 */
import type { Env } from '../types';
import { generateToken, hashToken } from '../api-auth';
import { generateId } from '../crypto-utils';
import { getSessionUser } from '../auth/session';
import { signPayload, verifySignature } from '../token';
import { checkKVRateLimit, rateLimitClientKey } from '../rate-limit';
import { consentPage, oauthErrorPage, pickLang } from './consent-page';

export const MCP_SCOPE = 'shareout';
const CODE_TTL_MS = 5 * 60_000;
export const ACCESS_TOKEN_TTL_SEC = 3600;
const REFRESH_TTL_MS = 90 * 86_400_000;
const CONSENT_TTL_MS = 15 * 60_000;
const MAX_REDIRECT_URIS = 10;
// Prefix on the `tokens.name` of every access token this server mints — lets the
// cleanup sweep and the token list tell them apart from hand-made API tokens.
export const MCP_TOKEN_NAME_PREFIX = 'mcp:';

const NO_STORE = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };
const PUBLIC_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, MCP-Protocol-Version',
  'Access-Control-Max-Age': '86400',
};

function oauthJson(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...NO_STORE, ...PUBLIC_CORS, ...extra },
  });
}

function oauthError(error: string, description: string, status = 400): Response {
  const extra: Record<string, string> = status === 401 ? { 'WWW-Authenticate': 'Basic realm="oauth"' } : {};
  return oauthJson({ error, error_description: description }, status, extra);
}

export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: PUBLIC_CORS });
}

// ── metadata ────────────────────────────────────────────────────────────────

export function mcpResourceUrl(origin: string): string {
  return `${origin}/mcp`;
}

export function protectedResourceMetadataUrl(origin: string): string {
  return `${origin}/.well-known/oauth-protected-resource/mcp`;
}

/** RFC 9728. `resource` is the exact URL people paste into their AI app. */
export function handleProtectedResourceMetadata(origin: string): Response {
  return oauthJson({
    resource: mcpResourceUrl(origin),
    authorization_servers: [origin],
    scopes_supported: [MCP_SCOPE],
    bearer_methods_supported: ['header'],
    resource_name: 'ShareOut',
    resource_documentation: `${origin}/home?view=connect`,
  }, 200, { 'Cache-Control': 'public, max-age=3600' });
}

/** RFC 8414. */
export function handleAuthServerMetadata(origin: string): Response {
  const authMethods = ['none', 'client_secret_post', 'client_secret_basic'];
  return oauthJson({
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    revocation_endpoint: `${origin}/oauth/revoke`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: authMethods,
    revocation_endpoint_auth_methods_supported: authMethods,
    scopes_supported: [MCP_SCOPE, 'offline_access'],
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${origin}/home?view=connect`,
  }, 200, { 'Cache-Control': 'public, max-age=3600' });
}

// ── helpers ─────────────────────────────────────────────────────────────────

function randomSecret(prefix: string): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return prefix + Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time string equality (length leak only). */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function base64url(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function pkceChallenge(verifier: string): Promise<string> {
  return base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function isLoopback(u: URL): boolean {
  return u.protocol === 'http:' && LOOPBACK_HOSTS.has(u.hostname);
}

/** Registrable redirect URI: https anywhere, or http on a loopback host. No fragments. */
export function isAllowedRedirectUri(raw: string): boolean {
  if (typeof raw !== 'string' || raw.length > 2000) return false;
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (u.hash || u.username || u.password) return false;
  return u.protocol === 'https:' || isLoopback(u);
}

/** Exact match, except loopback redirects match on any port (RFC 8252 §7.3). */
export function redirectUriMatches(registered: string[], candidate: string): boolean {
  if (registered.includes(candidate)) return true;
  let c: URL;
  try { c = new URL(candidate); } catch { return false; }
  if (!isLoopback(c) || c.hash) return false;
  return registered.some((r) => {
    try {
      const u = new URL(r);
      return isLoopback(u) && u.hostname === c.hostname && u.pathname === c.pathname && u.search === c.search;
    } catch { return false; }
  });
}

interface ClientRow {
  id: string;
  client_name: string;
  redirect_uris: string;
  client_secret_hash: string | null;
}

async function getClient(env: Env, clientId: string | null): Promise<(ClientRow & { uris: string[] }) | null> {
  if (!clientId || clientId.length > 100) return null;
  const row = await env.DB.prepare(
    'SELECT id, client_name, redirect_uris, client_secret_hash FROM oauth_clients WHERE id = ?'
  ).bind(clientId).first<ClientRow>();
  if (!row) return null;
  let uris: string[] = [];
  try { uris = JSON.parse(row.redirect_uris); } catch { /* corrupt row → no redirect matches */ }
  return { ...row, uris };
}

/** The resource indicator (RFC 8707) must name this server, if sent at all. */
function resourceOk(origin: string, resource: string | null): boolean {
  if (!resource) return true;
  const r = resource.replace(/\/$/, '');
  return r === mcpResourceUrl(origin) || r === origin;
}

// ── registration (RFC 7591) ─────────────────────────────────────────────────

export async function handleRegister(request: Request, env: Env): Promise<Response> {
  const limit = await checkKVRateLimit(env.RATE_LIMIT_KV, rateLimitClientKey(request), 'oauthRegister');
  if (!limit.allowed) return oauthError('invalid_request', 'Too many registrations, try again later', 429);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return oauthError('invalid_client_metadata', 'Body must be JSON');
  }

  const uris = body.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > MAX_REDIRECT_URIS) {
    return oauthError('invalid_redirect_uri', `redirect_uris must list 1-${MAX_REDIRECT_URIS} URIs`);
  }
  if (!uris.every((u) => isAllowedRedirectUri(u as string))) {
    return oauthError('invalid_redirect_uri', 'Redirect URIs must be https, or http on localhost/127.0.0.1, without a fragment');
  }

  const grantTypes = Array.isArray(body.grant_types) ? body.grant_types : ['authorization_code', 'refresh_token'];
  if (!grantTypes.includes('authorization_code')) {
    return oauthError('invalid_client_metadata', 'grant_types must include authorization_code');
  }

  const authMethod = typeof body.token_endpoint_auth_method === 'string' ? body.token_endpoint_auth_method : 'none';
  if (!['none', 'client_secret_post', 'client_secret_basic'].includes(authMethod)) {
    return oauthError('invalid_client_metadata', 'Unsupported token_endpoint_auth_method');
  }

  const rawName = typeof body.client_name === 'string' ? body.client_name.trim() : '';
  const clientName = (rawName || 'An AI app').replace(/\p{Cc}/gu, '').slice(0, 80);
  const clientId = generateId('mcpc');
  const secret = authMethod === 'none' ? null : randomSecret('mcps_');

  await env.DB.prepare(
    'INSERT INTO oauth_clients (id, client_name, redirect_uris, client_secret_hash) VALUES (?, ?, ?, ?)'
  ).bind(clientId, clientName, JSON.stringify(uris), secret ? await hashToken(secret) : null).run();

  return oauthJson({
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
    client_name: clientName,
    redirect_uris: uris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: authMethod,
    scope: MCP_SCOPE,
  }, 201);
}

// ── authorization ───────────────────────────────────────────────────────────

const AUTHORIZE_PARAMS = [
  'response_type', 'client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method',
  'state', 'scope', 'resource',
] as const;
type AuthorizeParams = Record<(typeof AUTHORIZE_PARAMS)[number], string | null>;

function readParams(source: URLSearchParams | FormData): AuthorizeParams {
  const out = {} as AuthorizeParams;
  for (const k of AUTHORIZE_PARAMS) {
    const v = source.get(k);
    out[k] = typeof v === 'string' && v !== '' ? v : null;
  }
  return out;
}

function redirectWith(redirectUri: string, params: Record<string, string | null>): Response {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v !== null) u.searchParams.set(k, v);
  return new Response(null, { status: 302, headers: { Location: u.toString(), ...NO_STORE } });
}

function consentPayload(userId: string, p: AuthorizeParams, issuedAt: number): string {
  return ['mcp-consent', userId, p.client_id, p.redirect_uri, p.code_challenge, p.state, p.scope ?? '', p.resource ?? '', issuedAt].join('|');
}

/**
 * Validates an authorize request. Returns a Response for anything that must stop here:
 * an error page when the client/redirect can't be trusted (never redirect then), or an
 * error redirect back to the client for everything else.
 */
async function validateAuthorize(
  request: Request,
  env: Env,
  origin: string,
  p: AuthorizeParams,
): Promise<{ client: ClientRow & { uris: string[] } } | { response: Response }> {
  const lang = pickLang(request);
  const client = await getClient(env, p.client_id);
  if (!client) return { response: oauthErrorPage(lang, 'client') };
  if (!p.redirect_uri || !redirectUriMatches(client.uris, p.redirect_uri)) {
    return { response: oauthErrorPage(lang, 'redirect') };
  }

  const fail = (error: string, description: string) => ({
    response: redirectWith(p.redirect_uri!, { error, error_description: description, state: p.state, iss: origin }),
  });
  if (p.response_type !== 'code') return fail('unsupported_response_type', 'response_type must be code');
  if (!p.state) return fail('invalid_request', 'state is required');
  if (!p.code_challenge || p.code_challenge_method !== 'S256') {
    return fail('invalid_request', 'PKCE with code_challenge_method=S256 is required');
  }
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(p.code_challenge)) return fail('invalid_request', 'Malformed code_challenge');
  if (!resourceOk(origin, p.resource)) return fail('invalid_target', 'resource must be this server');
  return { client };
}

/** GET /oauth/authorize — sign-in if needed, then the consent page. */
export async function handleAuthorizeGet(request: Request, env: Env, origin: string): Promise<Response> {
  const url = new URL(request.url);
  const p = readParams(url.searchParams);
  const checked = await validateAuthorize(request, env, origin, p);
  if ('response' in checked) return checked.response;

  const session = await getSessionUser(request, env);
  if (!session) {
    const back = `/oauth/authorize?${url.searchParams.toString()}`;
    return new Response(null, {
      status: 302,
      headers: { Location: `/auth/login?redirect=${encodeURIComponent(back)}`, ...NO_STORE },
    });
  }

  const issuedAt = Date.now();
  const csrf = `${issuedAt}.${await signPayload(consentPayload(session.id, p, issuedAt), env.SESSION_SECRET)}`;
  const fields: Record<string, string> = { csrf };
  for (const k of AUTHORIZE_PARAMS) if (p[k] !== null) fields[k] = p[k]!;

  const redirect = new URL(p.redirect_uri!);
  return consentPage({
    lang: pickLang(request),
    clientName: checked.client.client_name,
    redirectHost: redirect.host,
    isLoopback: isLoopback(redirect),
    email: session.email,
    fields,
  });
}

/** POST /oauth/authorize — the consent form's Allow / Cancel. */
export async function handleAuthorizePost(request: Request, env: Env, origin: string): Promise<Response> {
  // Same-origin form only. SameSite=Lax already keeps the session cookie off a
  // cross-site POST; this rejects it explicitly as well.
  const reqOrigin = request.headers.get('Origin');
  if (reqOrigin && reqOrigin !== origin) return oauthError('invalid_request', 'Cross-origin consent rejected', 403);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return oauthError('invalid_request', 'Expected a form body');
  }
  const p = readParams(form);
  const checked = await validateAuthorize(request, env, origin, p);
  if ('response' in checked) return checked.response;

  const session = await getSessionUser(request, env);
  const lang = pickLang(request);
  if (!session) return oauthErrorPage(lang, 'expired');

  const csrf = String(form.get('csrf') || '');
  const dot = csrf.indexOf('.');
  const issuedAt = Number(csrf.slice(0, dot));
  const sig = csrf.slice(dot + 1);
  let valid = false;
  if (dot > 0 && Number.isFinite(issuedAt) && Date.now() - issuedAt < CONSENT_TTL_MS && sig) {
    try {
      valid = await verifySignature(consentPayload(session.id, p, issuedAt), sig, env.SESSION_SECRET);
    } catch {
      valid = false;
    }
  }
  if (!valid) return oauthErrorPage(lang, 'expired');

  if (form.get('decision') !== 'allow') {
    return redirectWith(p.redirect_uri!, { error: 'access_denied', error_description: 'The person declined', state: p.state, iss: origin });
  }

  const code = randomSecret('mcpcode_');
  await env.DB.prepare(
    `INSERT INTO oauth_codes (code_hash, client_id, user_id, redirect_uri, code_challenge, scope, resource, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    await hashToken(code), checked.client.id, session.id, p.redirect_uri, p.code_challenge,
    p.scope, p.resource, new Date(Date.now() + CODE_TTL_MS).toISOString(),
  ).run();

  return redirectWith(p.redirect_uri!, { code, state: p.state, iss: origin });
}

// ── token endpoint ──────────────────────────────────────────────────────────

async function readBody(request: Request): Promise<Record<string, string>> {
  const type = request.headers.get('Content-Type') || '';
  const out: Record<string, string> = {};
  if (type.includes('application/json')) {
    const json = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    for (const [k, v] of Object.entries(json)) if (typeof v === 'string') out[k] = v;
  } else {
    const form = await request.formData().catch(() => null);
    form?.forEach((v, k) => { if (typeof v === 'string') out[k] = v; });
  }
  return out;
}

/** Authenticates the client: HTTP Basic, client_secret_post, or a public client_id. */
async function authenticateClient(
  request: Request,
  env: Env,
  body: Record<string, string>,
): Promise<(ClientRow & { uris: string[] }) | null> {
  let clientId = body.client_id || null;
  let secret = body.client_secret || null;
  const auth = request.headers.get('Authorization');
  if (auth?.startsWith('Basic ')) {
    try {
      const [id, pw] = atob(auth.slice(6)).split(':');
      clientId = decodeURIComponent(id);
      secret = decodeURIComponent(pw ?? '');
    } catch {
      return null;
    }
  }
  const client = await getClient(env, clientId);
  if (!client) return null;
  if (client.client_secret_hash) {
    if (!secret || !safeEqual(await hashToken(secret), client.client_secret_hash)) return null;
  }
  return client;
}

/** Mints the short-lived `so_` access token row for a grant. */
async function mintAccessToken(env: Env, userId: string, clientName: string): Promise<{ token: string; id: string; stmt: D1PreparedStatement }> {
  const token = generateToken();
  const id = generateId('tok');
  const stmt = env.DB.prepare(
    "INSERT INTO tokens (id, principal_type, principal_id, user_id, token_hash, name, expires_at) VALUES (?, 'user', ?, ?, ?, ?, ?)"
  ).bind(
    id, userId, userId, await hashToken(token), `${MCP_TOKEN_NAME_PREFIX}${clientName}`.slice(0, 80),
    new Date(Date.now() + ACCESS_TOKEN_TTL_SEC * 1000).toISOString(),
  );
  return { token, id, stmt };
}

function tokenResponse(accessToken: string, refreshToken: string, scope: string | null): Response {
  return oauthJson({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_SEC,
    refresh_token: refreshToken,
    scope: scope || MCP_SCOPE,
  });
}

export async function handleToken(request: Request, env: Env, origin: string): Promise<Response> {
  const body = await readBody(request);
  const client = await authenticateClient(request, env, body);
  if (!client) return oauthError('invalid_client', 'Unknown client or bad credentials', 401);

  // Keyed per client, not per IP: hosted AI apps call from a few shared egress IPs,
  // so an IP bucket would throttle every one of their users together.
  const limit = await checkKVRateLimit(env.RATE_LIMIT_KV, client.id, 'oauthToken');
  if (!limit.allowed) return oauthError('invalid_request', 'Too many token requests, try again later', 429);

  if (body.grant_type === 'authorization_code') return exchangeCode(env, origin, client, body);
  if (body.grant_type === 'refresh_token') return refresh(env, origin, client, body);
  return oauthError('unsupported_grant_type', 'grant_type must be authorization_code or refresh_token');
}

interface CodeRow {
  client_id: string;
  user_id: string;
  redirect_uri: string;
  code_challenge: string;
  scope: string | null;
  resource: string | null;
  expires_at: string;
}

async function exchangeCode(env: Env, origin: string, client: ClientRow, body: Record<string, string>): Promise<Response> {
  if (!body.code || !body.code_verifier) return oauthError('invalid_request', 'code and code_verifier are required');
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(body.code_verifier)) return oauthError('invalid_grant', 'Malformed code_verifier');

  // Delete-and-return makes the code single-use even under concurrent redemption.
  const row = await env.DB.prepare(
    `DELETE FROM oauth_codes WHERE code_hash = ?
     RETURNING client_id, user_id, redirect_uri, code_challenge, scope, resource, expires_at`
  ).bind(await hashToken(body.code)).first<CodeRow>();

  if (!row || row.client_id !== client.id) return oauthError('invalid_grant', 'Unknown or already used code');
  if (row.expires_at < new Date().toISOString()) return oauthError('invalid_grant', 'Code expired');
  if (body.redirect_uri !== row.redirect_uri) return oauthError('invalid_grant', 'redirect_uri does not match');
  if (!safeEqual(await pkceChallenge(body.code_verifier), row.code_challenge)) {
    return oauthError('invalid_grant', 'PKCE verification failed');
  }
  if (!resourceOk(origin, body.resource || null)) return oauthError('invalid_target', 'resource must be this server');

  const access = await mintAccessToken(env, row.user_id, client.client_name);
  const refreshToken = randomSecret('mcpr_');
  await env.DB.batch([
    access.stmt,
    env.DB.prepare(
      `INSERT INTO oauth_grants (id, client_id, user_id, refresh_token_hash, access_token_id, scope, resource, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      generateId('ogr'), client.id, row.user_id, await hashToken(refreshToken), access.id,
      row.scope, row.resource ?? body.resource ?? null, new Date(Date.now() + REFRESH_TTL_MS).toISOString(),
    ),
  ]);
  return tokenResponse(access.token, refreshToken, row.scope);
}

interface GrantRow {
  id: string;
  client_id: string;
  user_id: string;
  access_token_id: string | null;
  scope: string | null;
  expires_at: string;
  revoked_at: string | null;
}

async function refresh(env: Env, origin: string, client: ClientRow, body: Record<string, string>): Promise<Response> {
  if (!body.refresh_token) return oauthError('invalid_request', 'refresh_token is required');
  if (!resourceOk(origin, body.resource || null)) return oauthError('invalid_target', 'resource must be this server');
  const oldHash = await hashToken(body.refresh_token);
  const grant = await env.DB.prepare(
    'SELECT id, client_id, user_id, access_token_id, scope, expires_at, revoked_at FROM oauth_grants WHERE refresh_token_hash = ?'
  ).bind(oldHash).first<GrantRow>();
  if (!grant || grant.client_id !== client.id || grant.revoked_at || grant.expires_at < new Date().toISOString()) {
    return oauthError('invalid_grant', 'Refresh token is invalid, expired or revoked');
  }
  const disabled = await env.DB.prepare('SELECT disabled FROM users WHERE id = ?').bind(grant.user_id).first<{ disabled: number }>();
  if (!disabled || disabled.disabled) return oauthError('invalid_grant', 'Account is not active');

  // Rotate: the new access row must exist before the grant points at it (FK), and the
  // conditional UPDATE is what makes a refresh token usable exactly once.
  const access = await mintAccessToken(env, grant.user_id, client.client_name);
  await access.stmt.run();
  const refreshToken = randomSecret('mcpr_');
  const rotated = await env.DB.prepare(
    `UPDATE oauth_grants SET refresh_token_hash = ?, access_token_id = ?, expires_at = ?,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id = ? AND refresh_token_hash = ? AND revoked_at IS NULL`
  ).bind(await hashToken(refreshToken), access.id, new Date(Date.now() + REFRESH_TTL_MS).toISOString(), grant.id, oldHash).run();
  if (!rotated.meta?.changes) {
    await env.DB.prepare('DELETE FROM tokens WHERE id = ?').bind(access.id).run();
    return oauthError('invalid_grant', 'Refresh token was already used');
  }
  if (grant.access_token_id) {
    await env.DB.prepare('DELETE FROM tokens WHERE id = ?').bind(grant.access_token_id).run();
  }
  return tokenResponse(access.token, refreshToken, grant.scope);
}

// ── revocation (RFC 7009) ───────────────────────────────────────────────────

export async function handleRevoke(request: Request, env: Env): Promise<Response> {
  const body = await readBody(request);
  const client = await authenticateClient(request, env, body);
  if (!client) return oauthError('invalid_client', 'Unknown client or bad credentials', 401);
  if (!body.token) return oauthJson({});

  const hash = await hashToken(body.token);
  const byRefresh = await env.DB.prepare(
    'SELECT id, access_token_id FROM oauth_grants WHERE refresh_token_hash = ? AND client_id = ?'
  ).bind(hash, client.id).first<{ id: string; access_token_id: string | null }>();
  if (byRefresh) {
    await env.DB.batch([
      env.DB.prepare("UPDATE oauth_grants SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), access_token_id = NULL WHERE id = ?").bind(byRefresh.id),
      env.DB.prepare('DELETE FROM tokens WHERE id = ?').bind(byRefresh.access_token_id ?? ''),
    ]);
    return oauthJson({});
  }

  // An access token: only one this client was issued.
  await env.DB.prepare(
    `DELETE FROM tokens WHERE token_hash = ?
       AND id IN (SELECT access_token_id FROM oauth_grants WHERE client_id = ?)`
  ).bind(hash, client.id).run();
  return oauthJson({});
}

/** Daily sweep: expired codes, dead grants, and expired MCP access-token rows. */
export async function cleanupMcpOAuth(env: Env): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM oauth_codes WHERE expires_at < ?').bind(now),
    env.DB.prepare('DELETE FROM oauth_grants WHERE expires_at < ? OR revoked_at IS NOT NULL').bind(now),
    env.DB.prepare("DELETE FROM tokens WHERE name LIKE 'mcp:%' AND expires_at IS NOT NULL AND expires_at < ?").bind(now),
  ]);
}
