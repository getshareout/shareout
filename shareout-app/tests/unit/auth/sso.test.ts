// Workspace SSO (OIDC): config validation, domain policy, and the start → callback flow
// against a fake IdP whose ID tokens are signed with a key generated per run.
import { env } from 'cloudflare:test';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';

vi.mock('../../../src/workspaces', async (orig) => {
  const actual = await orig<typeof import('../../../src/workspaces')>();
  return { ...actual, autoJoinWorkspacesByDomain: vi.fn().mockResolvedValue(undefined) };
});
vi.mock('../../../src/rate-limit', async (orig) => {
  const actual = await orig<typeof import('../../../src/rate-limit')>();
  return {
    ...actual,
    checkEmailOtpStartLimit: vi.fn().mockResolvedValue({ allowed: true }),
    checkEmailOtpVerifyLimit: vi.fn().mockResolvedValue({ allowed: true }),
  };
});
vi.mock('../../../src/turnstile', async (orig) => {
  const actual = await orig<typeof import('../../../src/turnstile')>();
  return { ...actual, verifyTurnstile: vi.fn().mockResolvedValue(true) };
});
vi.mock('../../../src/email/gateway', () => ({
  dispatchLifecycleEmail: vi.fn().mockResolvedValue({ sent: true }),
}));
vi.mock('../../../src/onboarding/welcome-email', () => ({
  scheduleWelcomeEmail: vi.fn(),
  scheduleWorkspaceWelcome: vi.fn(),
}));

import {
  getSsoClientSecret,
  ssoRequiredFor,
  upsertSsoConfig,
  deleteSsoConfig,
} from '../../../src/auth/sso-config';
import { handleSsoStart, handleSsoCallback, resetOidcCaches, verifyIdToken } from '../../../src/auth/oidc';
import { handleEmailOtpStart, handleEmailOtpVerify } from '../../../src/auth-otp';
import type { FetchContext } from '../../../src/router/context';

const ISSUER = 'https://acme.okta.test/oauth2/default';
const e = {
  ...(env as unknown as Env),
  CREDENTIALS_KEY: 'test-credentials-key-0123456789ab',
  SESSION_SECRET: 'test-session-secret',
  SHAREOUT_BASE_URL: 'https://shareout.test',
} as Env;

let keyPair: CryptoKeyPair;
let publicJwk: JsonWebKey;

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlJson = (v: unknown) => b64url(new TextEncoder().encode(JSON.stringify(v)));

async function signJwt(claims: Record<string, unknown>, kid = 'k1'): Promise<string> {
  const head = b64urlJson({ alg: 'RS256', kid, typ: 'JWT' });
  const body = b64urlJson(claims);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keyPair.privateKey, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(new Uint8Array(sig))}`;
}

function claims(over: Record<string, unknown> = {}) {
  return {
    iss: ISSUER,
    sub: '00u1',
    aud: 'client-1',
    exp: Math.floor(Date.now() / 1000) + 300,
    nonce: 'n1',
    email: 'Ana@Acme.com',
    email_verified: true,
    ...over,
  };
}

let tokenResponse: () => Promise<Response>;
let tokenRequests: Request[];

function fakeIdp(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  if (url === `${ISSUER}/.well-known/openid-configuration`) {
    return Promise.resolve(Response.json({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/v1/authorize`,
      token_endpoint: `${ISSUER}/v1/token`,
      jwks_uri: `${ISSUER}/v1/keys`,
    }));
  }
  if (url === `${ISSUER}/v1/keys`) {
    return Promise.resolve(Response.json({ keys: [{ ...publicJwk, kid: 'k1', use: 'sig' }] }));
  }
  if (url === `${ISSUER}/v1/token`) {
    tokenRequests.push(new Request(url, init));
    return tokenResponse();
  }
  return Promise.resolve(new Response('not found', { status: 404 }));
}

beforeAll(async () => {
  keyPair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  ) as CryptoKeyPair;
  publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey) as JsonWebKey;

  for (const sql of [
    `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE, name TEXT, last_login_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, slug TEXT UNIQUE, allowed_email_domains TEXT, allowed_emails TEXT, session_max_days INTEGER)`,
    `CREATE TABLE IF NOT EXISTS workspace_members (id TEXT PRIMARY KEY, workspace_id TEXT, user_id TEXT, role TEXT, UNIQUE(workspace_id, user_id))`,
    `CREATE TABLE IF NOT EXISTS collaborators (artifact_id TEXT, email TEXT, role TEXT)`,
    `CREATE TABLE IF NOT EXISTS email_otp_codes (id TEXT PRIMARY KEY, email TEXT NOT NULL, code_hash TEXT NOT NULL, expires_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, consumed_at TEXT, created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS audit_log (id TEXT PRIMARY KEY, workspace_id TEXT, actor_id TEXT, actor_email TEXT, action TEXT, target_type TEXT, target_id TEXT, detail TEXT, created_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS workspace_sso_config (workspace_id TEXT PRIMARY KEY, issuer TEXT NOT NULL, client_id TEXT NOT NULL, encrypted_client_secret TEXT NOT NULL, client_secret_iv TEXT NOT NULL, email_domains TEXT NOT NULL, button_label TEXT, is_enforced INTEGER NOT NULL DEFAULT 0, updated_by TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`,
  ]) await e.DB.exec(sql);
});

beforeEach(async () => {
  for (const t of ['users', 'workspaces', 'workspace_members', 'workspace_sso_config']) await e.DB.exec(`DELETE FROM ${t}`);
  await e.DB.exec(`INSERT INTO workspaces (id, slug) VALUES ('ws_acme', 'acme'), ('ws_other', 'other')`);
  resetOidcCaches();
  tokenRequests = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(fakeIdp as typeof fetch);
});

afterEach(() => vi.restoreAllMocks());

const acmeInput = {
  issuer: `${ISSUER}/`,
  client_id: 'client-1',
  client_secret: 'shh',
  email_domains: ['Acme.com'],
  button_label: 'Sign in with Okta',
};

describe('upsertSsoConfig', () => {
  it('stores a normalized config and an encrypted secret that round-trips', async () => {
    const r = await upsertSsoConfig(e, 'ws_acme', 'usr_admin', acmeInput);
    expect(r).toMatchObject({ ok: true, config: { issuer: ISSUER, emailDomains: ['acme.com'], enforced: false } });
    const row = await e.DB.prepare('SELECT encrypted_client_secret FROM workspace_sso_config').first<{ encrypted_client_secret: string }>();
    expect(row?.encrypted_client_secret).not.toContain('shh');
    expect(await getSsoClientSecret(e, 'ws_acme')).toBe('shh');
  });

  it('rejects a non-https issuer, a missing secret on create, and a bad domain', async () => {
    expect(await upsertSsoConfig(e, 'ws_acme', 'u', { ...acmeInput, issuer: 'http://acme.okta.test' })).toMatchObject({ ok: false, status: 400 });
    expect(await upsertSsoConfig(e, 'ws_acme', 'u', { ...acmeInput, client_secret: '' })).toMatchObject({ ok: false, status: 400 });
    expect(await upsertSsoConfig(e, 'ws_acme', 'u', { ...acmeInput, email_domains: ['not a domain'] })).toMatchObject({ ok: false, status: 400 });
  });

  it('keeps the secret when an update omits it', async () => {
    await upsertSsoConfig(e, 'ws_acme', 'u', acmeInput);
    const r = await upsertSsoConfig(e, 'ws_acme', 'u', { ...acmeInput, client_secret: undefined, enforced: true });
    expect(r).toMatchObject({ ok: true, config: { enforced: true } });
    expect(await getSsoClientSecret(e, 'ws_acme')).toBe('shh');
  });

  it('refuses a domain another workspace already claims', async () => {
    await upsertSsoConfig(e, 'ws_acme', 'u', acmeInput);
    const r = await upsertSsoConfig(e, 'ws_other', 'u', { ...acmeInput, email_domains: ['acme.com'] });
    expect(r).toMatchObject({ ok: false, status: 409, code: 'DOMAIN_CLAIMED' });
  });

  it('503s without CREDENTIALS_KEY', async () => {
    const r = await upsertSsoConfig({ ...e, CREDENTIALS_KEY: undefined } as Env, 'ws_acme', 'u', acmeInput);
    expect(r).toMatchObject({ ok: false, status: 503 });
  });
});

describe('ssoRequiredFor', () => {
  it('only binds addresses on an enforced config', async () => {
    await upsertSsoConfig(e, 'ws_acme', 'u', acmeInput);
    expect(await ssoRequiredFor(e, 'ana@acme.com')).toBeNull();
    await upsertSsoConfig(e, 'ws_acme', 'u', { ...acmeInput, enforced: true });
    expect(await ssoRequiredFor(e, 'ANA@acme.com')).toMatchObject({ workspaceSlug: 'acme' });
    expect(await ssoRequiredFor(e, 'ana@gmail.com')).toBeNull();
    await deleteSsoConfig(e, 'ws_acme');
    expect(await ssoRequiredFor(e, 'ana@acme.com')).toBeNull();
  });
});

describe('verifyIdToken', () => {
  const expected = { issuer: ISSUER, clientId: 'client-1', jwksUri: `${ISSUER}/v1/keys`, nonce: 'n1' };

  it('accepts a well-formed token', async () => {
    const c = await verifyIdToken(await signJwt(claims()), expected);
    expect(c.email).toBe('Ana@Acme.com');
  });

  it.each([
    ['wrong nonce', { nonce: 'other' }, /Nonce/],
    ['wrong audience', { aud: 'someone-else' }, /audience/],
    ['wrong issuer', { iss: 'https://evil.test' }, /issuer/],
    ['expired', { exp: Math.floor(Date.now() / 1000) - 3600 }, /Expired/],
  ])('rejects %s', async (_name, over, msg) => {
    await expect(verifyIdToken(await signJwt(claims(over)), expected)).rejects.toThrow(msg);
  });

  it('rejects a token signed by another key', async () => {
    const token = await signJwt(claims());
    const [h, p] = token.split('.');
    await expect(verifyIdToken(`${h}.${p}.${b64url(new Uint8Array(256))}`, expected)).rejects.toThrow(/signature/);
  });
});

describe('SSO sign-in flow', () => {
  async function start(query: string) {
    const res = await handleSsoStart(new Request(`https://acme.shareout.test/auth/sso?${query}`), e);
    const location = new URL(res.headers.get('Location') || 'about:blank');
    const cookie = (res.headers.get('Set-Cookie') || '').split(';')[0];
    const saved = JSON.parse(new TextDecoder().decode(
      Uint8Array.from(atob(cookie.split('=')[1].split('.')[0].replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0)),
    ));
    return { res, location, cookie, saved };
  }

  function callback(query: string, cookie: string) {
    return handleSsoCallback(new Request(`https://shareout.test/auth/sso/callback?${query}`, { headers: { Cookie: cookie } }), e);
  }

  it('redirects to the IdP with PKCE, state and nonce, and a zone-wide state cookie', async () => {
    await upsertSsoConfig(e, 'ws_acme', 'u', acmeInput);
    const { res, location } = await start('workspace=acme&redirect=/home');
    expect(res.status).toBe(302);
    expect(location.origin + location.pathname).toBe(`${ISSUER}/v1/authorize`);
    expect(location.searchParams.get('redirect_uri')).toBe('https://shareout.test/auth/sso/callback');
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('state')).toBeTruthy();
    expect(location.searchParams.get('nonce')).toBeTruthy();
    expect(res.headers.get('Set-Cookie')).toMatch(/so_sso=.*Domain=\.shareout\.test;.*Max-Age=600/);
  });

  it('signs the person in, joins them to the workspace, and returns them to the subdomain', async () => {
    await upsertSsoConfig(e, 'ws_acme', 'u', acmeInput);
    const { location, cookie, saved } = await start('workspace=acme&redirect=/home');
    tokenResponse = async () => Response.json({ id_token: await signJwt(claims({ nonce: saved.nonce })) });

    const res = await callback(`code=abc&state=${location.searchParams.get('state')}`, cookie);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('https://acme.shareout.test/home');
    expect(res.headers.get('Set-Cookie')).toMatch(/shareout_session|session/i);

    const body = new URLSearchParams(await tokenRequests[0].text());
    expect(body.get('code_verifier')).toBe(saved.verifier);
    expect(tokenRequests[0].headers.get('Authorization')).toBe(`Basic ${btoa('client-1:shh')}`);

    const user = await e.DB.prepare('SELECT id, email FROM users').first<{ id: string; email: string }>();
    expect(user?.email).toBe('ana@acme.com');
    const member = await e.DB.prepare('SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?')
      .bind('ws_acme', user?.id).first<{ role: string }>();
    expect(member?.role).toBe('member');
  });

  it('refuses an email outside the configured domains', async () => {
    await upsertSsoConfig(e, 'ws_acme', 'u', acmeInput);
    const { location, cookie, saved } = await start('workspace=acme');
    tokenResponse = async () => Response.json({ id_token: await signJwt(claims({ nonce: saved.nonce, email: 'ceo@victim.com' })) });
    const res = await callback(`code=abc&state=${location.searchParams.get('state')}`, cookie);
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('cannot sign in');
    expect(await e.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>()).toEqual({ n: 0 });
  });

  it('refuses a state that does not match the cookie', async () => {
    await upsertSsoConfig(e, 'ws_acme', 'u', acmeInput);
    const { cookie } = await start('workspace=acme');
    const res = await callback('code=abc&state=forged', cookie);
    expect(res.status).toBe(400);
    expect(tokenRequests).toHaveLength(0);
  });

  it('refuses a tampered state cookie', async () => {
    await upsertSsoConfig(e, 'ws_acme', 'u', acmeInput);
    const { location, cookie } = await start('workspace=acme');
    const [name, value] = cookie.split('=');
    const [, sig] = value.split('.');
    const forged = `${name}=${b64urlJson({ state: location.searchParams.get('state'), workspaceId: 'ws_other', exp: 9e9 })}.${sig}`;
    const res = await callback(`code=abc&state=${location.searchParams.get('state')}`, forged);
    expect(res.status).toBe(400);
    expect(tokenRequests).toHaveLength(0);
  });

  it('shows an error page when the workspace has no SSO', async () => {
    const res = await handleSsoStart(new Request('https://shareout.test/auth/sso?workspace=other'), e);
    expect(res.status).toBe(400);
  });
});

describe('Okta-only enforcement', () => {
  function otp(path: string, body: unknown) {
    const request = new Request(`https://shareout.test${path}`, { method: 'POST', body: JSON.stringify(body) });
    return { request, env: e, url: new URL(request.url) } as unknown as FetchContext;
  }

  it('sends an enforced domain to SSO instead of emailing a code', async () => {
    await upsertSsoConfig(e, 'ws_acme', 'u', { ...acmeInput, enforced: true });
    const res = await handleEmailOtpStart(otp('/v1/auth/email/start', { email: 'ana@acme.com' }));
    expect(res.status).toBe(403);
    const body = await res.json() as { code: string; redirect_url: string };
    expect(body.code).toBe('SSO_REQUIRED');
    expect(body.redirect_url).toBe('/auth/sso?workspace=acme&login_hint=ana%40acme.com');

    const verify = await handleEmailOtpVerify(otp('/v1/auth/email/verify', { email: 'ana@acme.com', code: '123456' }));
    expect(verify.status).toBe(403);
    expect(verify.headers.get('Set-Cookie')).toBeNull();
  });

  it('leaves other domains and non-enforced configs alone', async () => {
    await upsertSsoConfig(e, 'ws_acme', 'u', acmeInput);
    const res = await handleEmailOtpStart(otp('/v1/auth/email/start', { email: 'ana@acme.com' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });
});
