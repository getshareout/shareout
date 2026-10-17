// Sign in with Microsoft: ID-token validation (multi-tenant issuer, audience, signature,
// expiry, nonce), the email trust rules, and the start → callback flow against a fake
// Microsoft identity platform (fixtures/entra.ts) on the real migrated schema.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';

vi.mock('../../../src/workspaces/access-policy', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  autoJoinWorkspacesByDomain: vi.fn().mockResolvedValue(false),
}));
vi.mock('../../../src/onboarding/welcome-email', () => ({
  scheduleWelcomeEmail: vi.fn(),
  scheduleWorkspaceWelcome: vi.fn(),
}));
vi.mock('../../../src/starter-kit/schedule', () => ({ scheduleSeedStarterKit: vi.fn() }));

import { applyMigrations, e as baseEnv } from '../helpers/migrated-db';
import {
  handleMicrosoftCallback,
  handleMicrosoftLogin,
  microsoftVerifiedEmail,
  verifyMicrosoftIdToken,
} from '../../../src/auth/microsoft-oauth';
import { resetOidcCaches, type IdTokenClaims } from '../../../src/auth/oidc';
import { upsertSsoConfig } from '../../../src/auth/sso-config';
import { microsoftOAuthConfigured } from '../../../src/config/auth-providers';
import { COOKIE_NAME } from '../../../src/auth/constants';
import { appLoginPage, loginPage } from '../../../src/auth/pages';
import {
  breakSignature,
  CONSUMER_TENANT_ID,
  createEntraFixture,
  ENTRA,
  entraClaims,
  OTHER_TENANT_ID,
  TENANT_ID,
  type EntraFixture,
} from './fixtures/entra';

const CLIENT_ID = '11111111-aaaa-4bbb-8ccc-222222222222';
const e = {
  ...baseEnv,
  SESSION_SECRET: 'test-session-secret',
  CREDENTIALS_KEY: 'test-credentials-key-0123456789ab',
  SHAREOUT_BASE_URL: 'https://shareout.test',
  MICROSOFT_CLIENT_ID: CLIENT_ID,
  MICROSOFT_CLIENT_SECRET: 'ms-secret',
  MICROSOFT_TENANT: undefined,
  SIGNUPS_PAUSED: '',
} as Env;
const withTenant = (tenant: string) => ({ ...e, MICROSOFT_TENANT: tenant }) as Env;

let idp: EntraFixture;
const claims = (over: Record<string, unknown> = {}) => entraClaims(CLIENT_ID, over);
const personal = (over: Record<string, unknown> = {}) => claims({
  tid: CONSUMER_TENANT_ID,
  email: 'ana.perez@outlook.example',
  preferred_username: 'ana.perez@outlook.example',
  xms_edov: undefined,
  ...over,
});

beforeAll(async () => {
  await applyMigrations();
  idp = await createEntraFixture();
});

beforeEach(async () => {
  for (const t of ['workspace_sso_config', 'workspace_members', 'workspaces', 'users']) await e.DB.exec(`DELETE FROM ${t}`);
  resetOidcCaches();
  idp.tokenRequests.length = 0;
  vi.spyOn(globalThis, 'fetch').mockImplementation(idp.fetch as typeof fetch);
});

afterEach(() => vi.restoreAllMocks());

describe('microsoftOAuthConfigured', () => {
  it('needs both the client id and secret, and a tenant it can validate', () => {
    expect(microsoftOAuthConfigured(e)).toBe(true);
    expect(microsoftOAuthConfigured({ ...e, MICROSOFT_CLIENT_SECRET: '' } as Env)).toBe(false);
    expect(microsoftOAuthConfigured({ ...e, MICROSOFT_CLIENT_ID: undefined } as Env)).toBe(false);
    expect(microsoftOAuthConfigured(withTenant('organizations'))).toBe(true);
    expect(microsoftOAuthConfigured(withTenant(TENANT_ID))).toBe(true);
    expect(microsoftOAuthConfigured(withTenant('acme.onmicrosoft.com'))).toBe(false);
  });
});

describe('verifyMicrosoftIdToken', () => {
  it('accepts a work token through the templated common issuer', async () => {
    const c = await verifyMicrosoftIdToken(e, await idp.signOrg(claims()), 'n1');
    expect(c.tid).toBe(TENANT_ID);
  });

  it('accepts a personal-account token signed by the consumer key', async () => {
    const c = await verifyMicrosoftIdToken(e, await idp.signConsumer(personal()), 'n1');
    expect(c.tid).toBe(CONSUMER_TENANT_ID);
  });

  it.each([
    ['an issuer for another tenant than tid', { iss: `${ENTRA}/${OTHER_TENANT_ID}/v2.0` }, /issuer/],
    ['a non-GUID tid', { tid: 'common', iss: `${ENTRA}/common/v2.0` }, /issuer/],
    ['a foreign issuer', { iss: 'https://evil.example/v2.0' }, /issuer/],
    ['the v1 issuer', { iss: `https://sts.windows.net/${TENANT_ID}/` }, /issuer/],
    ['the wrong audience', { aud: 'another-app' }, /audience/],
    ['an expired token', { exp: Math.floor(Date.now() / 1000) - 3600 }, /Expired/],
    ['a token not valid yet', { nbf: Math.floor(Date.now() / 1000) + 3600 }, /not yet valid/],
    ['a nonce mismatch', { nonce: 'replayed' }, /Nonce/],
    ['a missing nonce', { nonce: undefined }, /Nonce/],
  ])('rejects %s', async (_name, over, msg) => {
    await expect(verifyMicrosoftIdToken(e, await idp.signOrg(claims(over)), 'n1')).rejects.toThrow(msg);
  });

  it('rejects a bad signature', async () => {
    await expect(verifyMicrosoftIdToken(e, breakSignature(await idp.signOrg(claims())), 'n1')).rejects.toThrow(/signature/);
  });

  it('rejects an unknown signing key', async () => {
    await expect(verifyMicrosoftIdToken(e, await idp.signOrg(claims(), 'rotated-away'), 'n1')).rejects.toThrow(/signing key/);
  });

  it('rejects a work-tenant token signed with the key pinned to the consumer tenant', async () => {
    await expect(verifyMicrosoftIdToken(e, await idp.signConsumer(claims()), 'n1')).rejects.toThrow(/signing key/);
  });

  it('honours a single-tenant MICROSOFT_TENANT', async () => {
    const env = withTenant(TENANT_ID);
    await expect(verifyMicrosoftIdToken(env, await idp.signOrg(claims()), 'n1')).resolves.toMatchObject({ tid: TENANT_ID });
    resetOidcCaches();
    const other = claims({ tid: OTHER_TENANT_ID });
    await expect(verifyMicrosoftIdToken(env, await idp.signOrg(other), 'n1')).rejects.toThrow(/issuer/);
  });

  it('keeps organizations to work accounts', async () => {
    await expect(verifyMicrosoftIdToken(withTenant('organizations'), await idp.signConsumer(personal()), 'n1')).rejects.toThrow();
  });
});

describe('microsoftVerifiedEmail', () => {
  const asClaims = (c: Record<string, unknown>) => c as unknown as IdTokenClaims;

  it('trusts a work email only when xms_edov says the domain owner is verified', () => {
    expect(microsoftVerifiedEmail(asClaims(claims()))).toEqual({ email: 'ana@acme.example' });
    expect(microsoftVerifiedEmail(asClaims(claims({ xms_edov: true })))).toEqual({ email: 'ana@acme.example' });
    expect(microsoftVerifiedEmail(asClaims(claims({ xms_edov: undefined })))).toHaveProperty('error');
    expect(microsoftVerifiedEmail(asClaims(claims({ xms_edov: '0' })))).toHaveProperty('error');
    expect(microsoftVerifiedEmail(asClaims(claims({ xms_edov: false })))).toHaveProperty('error');
  });

  it('never falls back to preferred_username (the UPN) for a work account', () => {
    expect(microsoftVerifiedEmail(asClaims(claims({ email: undefined })))).toHaveProperty('error');
  });

  it('uses a personal account email, falling back to an email-shaped sign-in name', () => {
    expect(microsoftVerifiedEmail(asClaims(personal()))).toEqual({ email: 'ana.perez@outlook.example' });
    expect(microsoftVerifiedEmail(asClaims(personal({ email: undefined })))).toEqual({ email: 'ana.perez@outlook.example' });
    expect(microsoftVerifiedEmail(asClaims(personal({ email: undefined, preferred_username: '+5491100000000' })))).toHaveProperty('error');
    expect(microsoftVerifiedEmail(asClaims(personal({ xms_edov: '0' })))).toHaveProperty('error');
  });
});

describe('Microsoft sign-in flow', () => {
  async function start(query = 'redirect=/home', host = 'acme.shareout.test', env = e) {
    const res = await handleMicrosoftLogin(new Request(`https://${host}/auth/microsoft?${query}`), env);
    const location = new URL(res.headers.get('Location') || 'about:blank');
    const cookie = (res.headers.get('Set-Cookie') || '').split(';')[0];
    const saved = JSON.parse(new TextDecoder().decode(
      Uint8Array.from(atob(cookie.split('=')[1].split('.')[0].replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0)),
    ));
    return { res, location, cookie, saved };
  }

  async function signIn(tokenClaims: (nonce: string) => Promise<string>, env = e) {
    const { location, cookie, saved } = await start(undefined, undefined, env);
    const idToken = await tokenClaims(saved.nonce);
    idp.tokenResponse = async () => Response.json({ token_type: 'Bearer', id_token: idToken, access_token: 'opaque' });
    return handleMicrosoftCallback(
      new Request(`https://shareout.test/auth/microsoft/callback?code=abc&state=${location.searchParams.get('state')}`, { headers: { Cookie: cookie } }),
      env,
    );
  }

  const sessionCookie = (res: Response) => res.headers.getSetCookie().find((c) => c.startsWith(`${COOKIE_NAME}=`));

  it('redirects to the v2.0 authorize endpoint with PKCE, state, nonce and a zone-wide state cookie', async () => {
    const { res, location } = await start('redirect=/home&login_hint=ana@acme.example');
    expect(res.status).toBe(302);
    expect(location.origin + location.pathname).toBe(`${ENTRA}/common/oauth2/v2.0/authorize`);
    expect(location.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(location.searchParams.get('redirect_uri')).toBe('https://shareout.test/auth/microsoft/callback');
    expect(location.searchParams.get('scope')).toBe('openid email profile');
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('nonce')).toBeTruthy();
    expect(location.searchParams.get('login_hint')).toBe('ana@acme.example');
    expect(res.headers.get('Set-Cookie')).toMatch(/so_ms=.*Path=\/auth\/microsoft;.*Domain=\.shareout\.test;.*Max-Age=600/);
  });

  it('uses the configured tenant as the authority', async () => {
    const { location } = await start(undefined, undefined, withTenant(TENANT_ID));
    expect(location.pathname).toBe(`/${TENANT_ID}/oauth2/v2.0/authorize`);
  });

  it('signs a work account in, stores its tid:oid, and returns to the subdomain', async () => {
    const res = await signIn((nonce) => idp.signOrg(claims({ nonce })));
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('https://acme.shareout.test/home');
    expect(sessionCookie(res)).toMatch(/Domain=\.shareout\.test/);

    const body = new URLSearchParams(await idp.tokenRequests[0].text());
    expect(body.get('client_secret')).toBe('ms-secret');
    expect(body.get('code_verifier')).toBeTruthy();
    expect(idp.tokenRequests[0].url).toBe(`${ENTRA}/common/oauth2/v2.0/token`);

    const user = await e.DB.prepare('SELECT email, microsoft_id FROM users').first();
    expect(user).toEqual({ email: 'ana@acme.example', microsoft_id: `${TENANT_ID}:00000000-0000-0000-66f3-3332eca7ea81` });
  });

  it('signs a personal account in', async () => {
    const res = await signIn((nonce) => idp.signConsumer(personal({ nonce })));
    expect(res.status).toBe(302);
    expect(await e.DB.prepare('SELECT email FROM users').first()).toEqual({ email: 'ana.perez@outlook.example' });
  });

  it('refuses an unverified work email and creates no account', async () => {
    const res = await signIn((nonce) => idp.signOrg(claims({ nonce, xms_edov: undefined })));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('could not confirm');
    expect(sessionCookie(res)).toBeUndefined();
    expect(await e.DB.prepare('SELECT COUNT(*) AS n FROM users').first()).toEqual({ n: 0 });
  });

  it('refuses a token whose nonce is not the one this browser started with', async () => {
    const res = await signIn(() => idp.signOrg(claims({ nonce: 'someone-elses' })));
    expect(res.status).toBe(400);
    expect(sessionCookie(res)).toBeUndefined();
  });

  it('links an existing account by verified email', async () => {
    await e.DB.prepare("INSERT INTO users (id, email, name, last_login_at) VALUES ('usr_ana', 'ana@acme.example', 'Ana', '2026-01-01T00:00:00.000Z')").run();
    const res = await signIn((nonce) => idp.signOrg(claims({ nonce })));
    expect(res.status).toBe(302);
    const rows = await e.DB.prepare('SELECT id, microsoft_id FROM users').all();
    expect(rows.results).toEqual([{ id: 'usr_ana', microsoft_id: `${TENANT_ID}:00000000-0000-0000-66f3-3332eca7ea81` }]);
  });

  it('refuses an address already linked to another Microsoft identity', async () => {
    await e.DB.prepare("INSERT INTO users (id, email, microsoft_id) VALUES ('usr_ana', 'ana@acme.example', ?)").bind(`${OTHER_TENANT_ID}:someone`).run();
    const res = await signIn((nonce) => idp.signOrg(claims({ nonce })));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('different Microsoft account');
    expect(sessionCookie(res)).toBeUndefined();
  });

  it('sends an SSO-required domain to its workspace SSO', async () => {
    await e.DB.prepare("INSERT INTO users (id, email) VALUES ('usr_owner', 'owner@acme.example')").run();
    await e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES ('ws_acme', 'Acme', 'acme', 'usr_owner')").run();
    await upsertSsoConfig(e, 'ws_acme', 'usr_owner', {
      issuer: 'https://idp.acme.example/oauth2/default', client_id: 'c', client_secret: 's', email_domains: ['acme.example'], enforced: true,
    });
    const res = await signIn((nonce) => idp.signOrg(claims({ nonce })));
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('https://shareout.test/auth/sso?workspace=acme&redirect=%2Fhome&login_hint=ana%40acme.example');
    expect(sessionCookie(res)).toBeUndefined();
    expect(await e.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE email = 'ana@acme.example'").first()).toEqual({ n: 0 });
  });

  it('refuses a disabled user', async () => {
    await e.DB.prepare("INSERT INTO users (id, email, disabled) VALUES ('usr_ana', 'ana@acme.example', 1)").run();
    const res = await signIn((nonce) => idp.signOrg(claims({ nonce })));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('disabled');
    expect(sessionCookie(res)).toBeUndefined();
  });

  it('refuses a state that does not match the cookie, before redeeming the code', async () => {
    const { cookie } = await start();
    const res = await handleMicrosoftCallback(
      new Request('https://shareout.test/auth/microsoft/callback?code=abc&state=forged', { headers: { Cookie: cookie } }), e,
    );
    expect(res.status).toBe(400);
    expect(idp.tokenRequests).toHaveLength(0);
  });
});

describe('login page button', () => {
  it('shows "Sign in with Microsoft" only when configured', async () => {
    expect(await appLoginPage({ redirect: '/home' }).text()).not.toContain('/auth/microsoft');
    const html = await appLoginPage({ redirect: '/home', microsoftEnabled: true, locale: 'es' }).text();
    expect(html).toContain('/auth/microsoft?redirect=%2Fhome');
    expect(html).toContain('Entrar con Microsoft');
  });

  it('shows it on the private-artifact gate when configured', async () => {
    expect(await loginPage('demo', undefined, undefined, undefined, undefined, false).text()).not.toContain('/auth/microsoft');
    expect(await loginPage('demo', undefined, undefined, undefined, undefined, false, undefined, true).text()).toContain('/auth/microsoft?redirect=');
  });
});
