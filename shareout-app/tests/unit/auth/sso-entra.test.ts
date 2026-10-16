// Workspace OIDC SSO with Microsoft Entra ID as the IdP: issuer rules for the
// configured tenant, discovery, and the xms_edov email check, against the fake Entra
// identity platform in fixtures/entra.ts.
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

import { applyMigrations, e as baseEnv } from '../helpers/migrated-db';
import { handleSsoCallback, handleSsoStart, resetOidcCaches } from '../../../src/auth/oidc';
import { upsertSsoConfig } from '../../../src/auth/sso-config';
import { createEntraFixture, ENTRA, entraClaims, OTHER_TENANT_ID, TENANT_ID, type EntraFixture } from './fixtures/entra';

const CLIENT_ID = '33333333-bbbb-4ccc-8ddd-444444444444';
const ISSUER = `${ENTRA}/${TENANT_ID}/v2.0`;
const e = {
  ...baseEnv,
  SESSION_SECRET: 'test-session-secret',
  CREDENTIALS_KEY: 'test-credentials-key-0123456789ab',
  SHAREOUT_BASE_URL: 'https://shareout.test',
} as Env;
const input = { issuer: ISSUER, client_id: CLIENT_ID, client_secret: 'entra~secret', email_domains: ['acme.example'], button_label: 'Sign in with Microsoft' };

let idp: EntraFixture;

beforeAll(async () => {
  await applyMigrations();
  idp = await createEntraFixture();
});

beforeEach(async () => {
  for (const t of ['workspace_sso_config', 'workspace_members', 'workspaces', 'users']) await e.DB.exec(`DELETE FROM ${t}`);
  await e.DB.prepare("INSERT INTO users (id, email) VALUES ('usr_owner', 'owner@shareout.test')").run();
  await e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES ('ws_acme', 'Acme', 'acme', 'usr_owner')").run();
  resetOidcCaches();
  idp.tokenRequests.length = 0;
  vi.spyOn(globalThis, 'fetch').mockImplementation(idp.fetch as typeof fetch);
});

afterEach(() => vi.restoreAllMocks());

describe('Entra issuer validation', () => {
  it('accepts the tenant-specific v2.0 issuer', async () => {
    expect(await upsertSsoConfig(e, 'ws_acme', 'usr_owner', input)).toMatchObject({ ok: true, config: { issuer: ISSUER } });
  });

  it.each([
    `${ENTRA}/common/v2.0`,
    `${ENTRA}/organizations/v2.0`,
    `${ENTRA}/consumers/v2.0`,
    `${ENTRA}/acme.onmicrosoft.com/v2.0`,
    `${ENTRA}/${TENANT_ID}`,
  ])('refuses %s', async (issuer) => {
    const r = await upsertSsoConfig(e, 'ws_acme', 'usr_owner', { ...input, issuer });
    expect(r).toMatchObject({ ok: false, status: 400 });
    expect((r as { error: string }).error).toContain('tenant-specific v2.0 issuer');
  });
});

describe('SSO sign-in through Entra ID', () => {
  async function signIn(tokenClaims: (nonce: string) => Record<string, unknown>) {
    await upsertSsoConfig(e, 'ws_acme', 'usr_owner', input);
    const start = await handleSsoStart(new Request('https://acme.shareout.test/auth/sso?workspace=acme&redirect=/home'), e);
    const location = new URL(start.headers.get('Location') || 'about:blank');
    const cookie = (start.headers.get('Set-Cookie') || '').split(';')[0];
    const saved = JSON.parse(new TextDecoder().decode(
      Uint8Array.from(atob(cookie.split('=')[1].split('.')[0].replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0)),
    ));
    const idToken = await idp.signOrg(tokenClaims(saved.nonce));
    idp.tokenResponse = async () => Response.json({ token_type: 'Bearer', id_token: idToken });
    const res = await handleSsoCallback(
      new Request(`https://shareout.test/auth/sso/callback?code=abc&state=${location.searchParams.get('state')}`, { headers: { Cookie: cookie } }), e,
    );
    return { start, location, res };
  }

  it('discovers the tenant endpoints and signs a member in', async () => {
    const { location, res } = await signIn((nonce) => entraClaims(CLIENT_ID, { nonce }));
    expect(location.origin + location.pathname).toBe(`${ENTRA}/${TENANT_ID}/oauth2/v2.0/authorize`);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('https://acme.shareout.test/home');
    expect(idp.tokenRequests[0].url).toBe(`${ENTRA}/${TENANT_ID}/oauth2/v2.0/token`);
    expect(idp.tokenRequests[0].headers.get('Authorization')).toBe(`Basic ${btoa(`${CLIENT_ID}:entra~secret`)}`);
    const member = await e.DB.prepare(
      "SELECT m.role FROM workspace_members m JOIN users u ON u.id = m.user_id WHERE u.email = 'ana@acme.example'",
    ).first();
    expect(member).toEqual({ role: 'member' });
  });

  it('refuses an email Entra did not mark as domain-verified (no xms_edov)', async () => {
    const { res } = await signIn((nonce) => entraClaims(CLIENT_ID, { nonce, xms_edov: undefined }));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('xms_edov');
    expect(await e.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE email = 'ana@acme.example'").first()).toEqual({ n: 0 });
  });

  it('refuses a token from another tenant', async () => {
    const { res } = await signIn((nonce) => entraClaims(CLIENT_ID, { nonce, tid: OTHER_TENANT_ID }));
    expect(res.status).toBe(400);
    expect(await e.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE email = 'ana@acme.example'").first()).toEqual({ n: 0 });
  });

  it('refuses a token minted for another app registration', async () => {
    const { res } = await signIn((nonce) => entraClaims(CLIENT_ID, { nonce, aud: 'another-app' }));
    expect(res.status).toBe(400);
  });

  it('ignores groups and roles claims: membership comes from email_domains', async () => {
    const { res } = await signIn((nonce) => entraClaims(CLIENT_ID, { nonce, groups: ['g-admins'], roles: ['Admin'] }));
    expect(res.status).toBe(302);
    const member = await e.DB.prepare(
      "SELECT m.role FROM workspace_members m JOIN users u ON u.id = m.user_id WHERE u.email = 'ana@acme.example'",
    ).first();
    expect(member).toEqual({ role: 'member' });
  });
});
