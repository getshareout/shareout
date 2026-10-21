import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';
import { applyMigrations, e as baseEnv } from '../helpers/migrated-db';
import { handleMicrosoftLogin } from '../../../src/auth/microsoft-oauth';
import { handleSsoStart, resetOidcCaches } from '../../../src/auth/oidc';
import { upsertSsoConfig } from '../../../src/auth/sso-config';

const ISSUER = 'https://acme.okta.test/oauth2/default';
const e = {
  ...baseEnv,
  SESSION_SECRET: 'test-session-secret',
  CREDENTIALS_KEY: 'test-credentials-key-0123456789ab',
  SHAREOUT_BASE_URL: 'https://shareout.test',
  MICROSOFT_CLIENT_ID: '11111111-aaaa-4bbb-8ccc-222222222222',
  MICROSOFT_CLIENT_SECRET: 'ms',
} as Env;

const savedRedirect = (res: Response) => {
  const cookie = (res.headers.get('Set-Cookie') || '').split(';')[0];
  const b64 = cookie.split('=')[1].split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))).redirect as string;
};

beforeAll(async () => { await applyMigrations(); });
beforeEach(async () => {
  await e.DB.exec('DELETE FROM workspace_sso_config');
  await e.DB.exec('DELETE FROM workspaces');
  await e.DB.exec('DELETE FROM users');
  await e.DB.exec(`INSERT INTO users (id, email) VALUES ('u', 'u@acme.com')`);
  await e.DB.exec(`INSERT INTO workspaces (id, slug, name, owner_id) VALUES ('ws_acme', 'acme', 'Acme', 'u')`);
  await upsertSsoConfig(e, 'ws_acme', 'u', { issuer: ISSUER, client_id: 'c', client_secret: 's', email_domains: ['acme.com'] });
  resetOidcCaches();
  vi.spyOn(globalThis, 'fetch').mockImplementation((async () => Response.json({
    issuer: ISSUER, authorization_endpoint: `${ISSUER}/a`, token_endpoint: `${ISSUER}/t`, jwks_uri: `${ISSUER}/k`,
  })) as typeof fetch);
});
afterEach(() => vi.restoreAllMocks());

const oidc = async (redirect: string) =>
  savedRedirect(await handleSsoStart(new Request(`https://shareout.test/auth/sso?workspace=acme&redirect=${encodeURIComponent(redirect)}`), e));
const ms = async (redirect: string) =>
  savedRedirect(await handleMicrosoftLogin(new Request(`https://shareout.test/auth/microsoft?redirect=${encodeURIComponent(redirect)}`), e));

describe('h5 post-SSO redirect: backslash open redirect', () => {
  it.each([['oidc', oidc], ['microsoft', ms]] as const)('blocks: %s start rejects /\\evil.example and //evil.example', async (_n, start) => {
    expect(await start('/\\evil.example')).toBe('/home');
    expect(await start('//evil.example')).toBe('/home');
    expect(await start('/\\/evil.example')).toBe('/home');
  });
  it.each([['oidc', oidc], ['microsoft', ms]] as const)('keeps a legitimate path (%s)', async (_n, start) => {
    expect(await start('/a/my-page/?x=1')).toBe('/a/my-page/?x=1');
  });
});
