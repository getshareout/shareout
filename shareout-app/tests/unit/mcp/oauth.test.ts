// MCP connector OAuth 2.1 server: register → authorize (consent) → token → refresh → revoke,
// plus the guards that matter on an auth surface (PKCE, redirect URIs, CSRF, single use).
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { routeMcp } from '../../../src/mcp';
import { pkceChallenge, redirectUriMatches, isAllowedRedirectUri } from '../../../src/mcp/oauth';
import { createFetchContext } from '../../../src/router/context';
import { createSessionToken } from '../../../src/token';
import { validateToken } from '../../../src/api-auth';
import { createSchema, e, resetData } from './setup';

const ORIGIN = 'https://shareout.test';
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';
const VERIFIER = 'v'.repeat(20) + 'erifier-0123456789-abcdefghijklmnop';

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await routeMcp(createFetchContext(new Request(`${ORIGIN}${path}`, init), e));
  if (!res) throw new Error(`no route for ${path}`);
  return res;
}

async function sessionCookie(): Promise<string> {
  return `shareout_session=${await createSessionToken('usr_1', 'ana@example.com', e, 3600)}`;
}

async function register(redirectUris = [CALLBACK]): Promise<string> {
  const res = await call('/oauth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'Claude', redirect_uris: redirectUris, token_endpoint_auth_method: 'none' }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { client_id: string }).client_id;
}

async function authorizeQuery(clientId: string, overrides: Record<string, string | null> = {}): Promise<string> {
  const params: Record<string, string | null> = {
    response_type: 'code',
    client_id: clientId,
    redirect_uri: CALLBACK,
    code_challenge: await pkceChallenge(VERIFIER),
    code_challenge_method: 'S256',
    state: 'st-123',
    scope: 'shareout',
    resource: `${ORIGIN}/mcp`,
    ...overrides,
  };
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null) qs.set(k, v);
  return qs.toString();
}

/** Renders the consent page and returns its hidden form fields. */
async function consentFields(clientId: string, lang = 'en'): Promise<{ html: string; fields: URLSearchParams }> {
  const res = await call(`/oauth/authorize?${await authorizeQuery(clientId)}`, {
    headers: { Cookie: await sessionCookie(), 'Accept-Language': lang },
  });
  expect(res.status).toBe(200);
  const html = await res.text();
  const fields = new URLSearchParams();
  for (const m of html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)) {
    fields.set(m[1], m[2].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
  }
  return { html, fields };
}

async function approve(clientId: string): Promise<string> {
  const { fields } = await consentFields(clientId);
  fields.set('decision', 'allow');
  const res = await call('/oauth/authorize', {
    method: 'POST',
    headers: { Cookie: await sessionCookie(), Origin: ORIGIN, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: fields.toString(),
  });
  expect(res.status).toBe(302);
  const loc = new URL(res.headers.get('Location')!);
  expect(`${loc.origin}${loc.pathname}`).toBe(CALLBACK);
  expect(loc.searchParams.get('state')).toBe('st-123');
  expect(loc.searchParams.get('iss')).toBe(ORIGIN);
  return loc.searchParams.get('code')!;
}

function tokenRequest(params: Record<string, string>): Promise<Response> {
  return call('/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
}

async function authed(token: string) {
  return validateToken(new Request(`${ORIGIN}/mcp`, { headers: { Authorization: `Bearer ${token}` } }), e);
}

beforeAll(async () => {
  (e as unknown as { SESSION_SECRET: string }).SESSION_SECRET = 'test-session-secret';
  await createSchema();
});

beforeEach(resetData);

describe('metadata', () => {
  it('serves protected-resource and authorization-server metadata', async () => {
    const prm = (await (await call('/.well-known/oauth-protected-resource/mcp')).json()) as Record<string, unknown>;
    expect(prm.resource).toBe(`${ORIGIN}/mcp`);
    expect(prm.authorization_servers).toEqual([ORIGIN]);

    const as = (await (await call('/.well-known/oauth-authorization-server')).json()) as Record<string, unknown>;
    expect(as.issuer).toBe(ORIGIN);
    expect(as.code_challenge_methods_supported).toEqual(['S256']);
    expect(as.registration_endpoint).toBe(`${ORIGIN}/oauth/register`);
    expect(as.token_endpoint_auth_methods_supported).toContain('none');
  });
});

describe('redirect URIs', () => {
  it('allows https and loopback http only', () => {
    expect(isAllowedRedirectUri(CALLBACK)).toBe(true);
    expect(isAllowedRedirectUri('http://localhost:3118/callback')).toBe(true);
    expect(isAllowedRedirectUri('http://127.0.0.1/callback')).toBe(true);
    expect(isAllowedRedirectUri('http://evil.example/callback')).toBe(false);
    expect(isAllowedRedirectUri('https://claude.ai/cb#frag')).toBe(false);
    expect(isAllowedRedirectUri('javascript:alert(1)')).toBe(false);
  });

  it('matches loopback redirects on any port, everything else exactly', () => {
    expect(redirectUriMatches(['http://localhost/callback'], 'http://localhost:51234/callback')).toBe(true);
    expect(redirectUriMatches(['http://localhost/callback'], 'http://localhost:51234/other')).toBe(false);
    expect(redirectUriMatches([CALLBACK], `${CALLBACK}?x=1`)).toBe(false);
    expect(redirectUriMatches([CALLBACK], 'https://claude.ai.evil.example/api/mcp/auth_callback')).toBe(false);
  });

  it('rejects registering a non-loopback http redirect', async () => {
    const res = await call('/oauth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirect_uris: ['http://evil.example/cb'] }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_redirect_uri');
  });
});

describe('authorize', () => {
  it('sends a signed-out person to login and back', async () => {
    const clientId = await register();
    const res = await call(`/oauth/authorize?${await authorizeQuery(clientId)}`);
    expect(res.status).toBe(302);
    const loc = res.headers.get('Location')!;
    expect(loc.startsWith('/auth/login?redirect=')).toBe(true);
    expect(decodeURIComponent(loc.split('redirect=')[1])).toContain('/oauth/authorize?');
  });

  it('never redirects for an unknown client or unregistered redirect_uri', async () => {
    const clientId = await register();
    const unknown = await call(`/oauth/authorize?${await authorizeQuery('mcpc_nope')}`, { headers: { Cookie: await sessionCookie() } });
    expect(unknown.status).toBe(400);
    expect(unknown.headers.get('Location')).toBeNull();

    const badRedirect = await call(`/oauth/authorize?${await authorizeQuery(clientId, { redirect_uri: 'https://evil.example/cb' })}`, {
      headers: { Cookie: await sessionCookie() },
    });
    expect(badRedirect.status).toBe(400);
    expect(badRedirect.headers.get('Location')).toBeNull();
  });

  it('requires PKCE S256 and state', async () => {
    const clientId = await register();
    for (const override of [{ code_challenge: null }, { code_challenge_method: 'plain' }, { state: null }]) {
      const res = await call(`/oauth/authorize?${await authorizeQuery(clientId, override)}`, { headers: { Cookie: await sessionCookie() } });
      expect(res.status).toBe(302);
      expect(new URL(res.headers.get('Location')!).searchParams.get('error')).toBe('invalid_request');
    }
  });

  it('renders the consent page in rioplatense Spanish', async () => {
    const clientId = await register();
    const { html } = await consentFields(clientId, 'es-AR,es;q=0.9');
    expect(html).toContain('quiere publicar páginas en tu cuenta de ShareOut');
    expect(html).toContain('claude.ai');
  });

  it('rejects a tampered consent form', async () => {
    const clientId = await register();
    const { fields } = await consentFields(clientId);
    fields.set('state', 'other-state');
    fields.set('decision', 'allow');
    const res = await call('/oauth/authorize', {
      method: 'POST',
      headers: { Cookie: await sessionCookie(), Origin: ORIGIN, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: fields.toString(),
    });
    expect(res.status).toBe(400);
    expect(res.headers.get('Location')).toBeNull();
  });

  it('returns access_denied when the person cancels', async () => {
    const clientId = await register();
    const { fields } = await consentFields(clientId);
    fields.set('decision', 'deny');
    const res = await call('/oauth/authorize', {
      method: 'POST',
      headers: { Cookie: await sessionCookie(), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: fields.toString(),
    });
    expect(new URL(res.headers.get('Location')!).searchParams.get('error')).toBe('access_denied');
  });
});

describe('token', () => {
  it('runs the full flow: code → tokens → refresh (rotated) → revoke', async () => {
    const clientId = await register();
    const code = await approve(clientId);

    const res = await tokenRequest({ grant_type: 'authorization_code', code, code_verifier: VERIFIER, client_id: clientId, redirect_uri: CALLBACK, resource: `${ORIGIN}/mcp` });
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toContain('no-store');
    const first = (await res.json()) as { access_token: string; refresh_token: string; token_type: string; expires_in: number };
    expect(first.token_type).toBe('Bearer');
    expect(first.expires_in).toBe(3600);
    expect((await authed(first.access_token))?.id).toBe('usr_1');

    // The code is single-use.
    const replay = await tokenRequest({ grant_type: 'authorization_code', code, code_verifier: VERIFIER, client_id: clientId, redirect_uri: CALLBACK });
    expect(((await replay.json()) as { error: string }).error).toBe('invalid_grant');

    const refreshed = await tokenRequest({ grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: clientId });
    expect(refreshed.status).toBe(200);
    const second = (await refreshed.json()) as { access_token: string; refresh_token: string };
    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect((await authed(second.access_token))?.id).toBe('usr_1');
    expect(await authed(first.access_token)).toBeNull();

    const reused = await tokenRequest({ grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: clientId });
    expect(((await reused.json()) as { error: string }).error).toBe('invalid_grant');

    const revoke = await call('/oauth/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: second.refresh_token, client_id: clientId }).toString(),
    });
    expect(revoke.status).toBe(200);
    expect(await authed(second.access_token)).toBeNull();
    const afterRevoke = await tokenRequest({ grant_type: 'refresh_token', refresh_token: second.refresh_token, client_id: clientId });
    expect(((await afterRevoke.json()) as { error: string }).error).toBe('invalid_grant');
  });

  it('fails PKCE with the wrong verifier and burns the code', async () => {
    const clientId = await register();
    const code = await approve(clientId);
    const wrong = await tokenRequest({ grant_type: 'authorization_code', code, code_verifier: 'x'.repeat(50), client_id: clientId, redirect_uri: CALLBACK });
    expect(wrong.status).toBe(400);
    expect(((await wrong.json()) as { error: string }).error).toBe('invalid_grant');

    const right = await tokenRequest({ grant_type: 'authorization_code', code, code_verifier: VERIFIER, client_id: clientId, redirect_uri: CALLBACK });
    expect(((await right.json()) as { error: string }).error).toBe('invalid_grant');
  });

  it('rejects a code redeemed by another client', async () => {
    const clientId = await register();
    const other = await register();
    const code = await approve(clientId);
    const res = await tokenRequest({ grant_type: 'authorization_code', code, code_verifier: VERIFIER, client_id: other, redirect_uri: CALLBACK });
    expect(((await res.json()) as { error: string }).error).toBe('invalid_grant');
  });

  it('answers invalid_client (401) for an unknown client', async () => {
    const res = await tokenRequest({ grant_type: 'refresh_token', refresh_token: 'x', client_id: 'mcpc_gone' });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_client');
  });
});
