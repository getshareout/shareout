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
import { handleLinkEmailOtpStart, handleLinkEmailOtpVerify } from '../../../src/auth-otp';
import { handleGoogleCallback } from '../../../src/auth/google-oauth';
import { upsertSsoConfig } from '../../../src/auth/sso-config';
import { getLinkedUserIds } from '../../../src/account-links';
import { COOKIE_NAME } from '../../../src/auth/constants';
import { createSessionToken } from '../../../src/token';
import { sha256 } from '../../../src/crypto-utils';
import { createFetchContext } from '../../../src/router/context';

const e = {
  ...baseEnv,
  SESSION_SECRET: 'test-session-secret',
  CREDENTIALS_KEY: 'test-credentials-key-0123456789ab',
  SHAREOUT_BASE_URL: 'https://shareout.test',
  GOOGLE_CLIENT_ID: 'cid',
  GOOGLE_CLIENT_SECRET: 'csec',
  SIGNUPS_PAUSED: '',
} as Env;

let profile: Record<string, unknown>;

beforeAll(applyMigrations);
beforeEach(async () => {
  await e.DB.exec('DELETE FROM workspace_sso_config');
  await e.DB.exec('DELETE FROM email_otp_codes');
  await e.DB.exec("DELETE FROM workspaces WHERE id = 'ws_f13'");
  await e.DB.exec("DELETE FROM users WHERE email IN ('personal@gmail.test','ceo@corp.test','other@gmail.test')");
  await e.DB.exec("INSERT INTO users (id, email, name) VALUES ('usr_p', 'personal@gmail.test', 'P')");
  await e.DB.exec("INSERT INTO workspaces (id, name, slug, owner_id) VALUES ('ws_f13', 'Corp', 'corp', 'usr_p')");
  await upsertSsoConfig(e, 'ws_f13', 'usr_p', {
    issuer: 'https://idp.corp.test/', client_id: 'c', client_secret: 's', email_domains: ['corp.test'], enforced: true,
  });
  profile = { id: 'G_CORP', email: 'ceo@corp.test', verified_email: true, name: 'CEO', picture: null };
  vi.stubGlobal('fetch', vi.fn(async (input: any) => {
    const u = String(typeof input === 'string' ? input : input.url);
    if (u.includes('oauth2.googleapis.com/token')) return Response.json({ access_token: 'at', id_token: 'it' });
    if (u.includes('googleapis.com/oauth2/v2/userinfo')) return Response.json(profile);
    throw new Error(`unexpected fetch ${u}`);
  }));
});
afterEach(() => vi.unstubAllGlobals());

async function asPersonal(path: string, body: unknown) {
  const tok = await createSessionToken('usr_p', 'personal@gmail.test', e);
  return createFetchContext(
    new Request(`https://shareout.test${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `${COOKIE_NAME}=${tok}` },
      body: JSON.stringify(body),
    }),
    e,
  );
}

async function otpFor(email: string): Promise<string> {
  const hash = await sha256(new TextEncoder().encode(`${email}:123456`).buffer as ArrayBuffer);
  await e.DB.prepare('INSERT INTO email_otp_codes (id, email, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(`otp_${email}`, email, hash, new Date(Date.now() + 600_000).toISOString(), new Date().toISOString()).run();
  return '123456';
}

describe('f13 account linking vs enforced SSO', () => {
  it('blocks: link-email verify refuses an enforced-SSO address', async () => {
    const code = await otpFor('ceo@corp.test');
    const res = await handleLinkEmailOtpVerify(await asPersonal('/v1/auth/link/email/verify', { email: 'ceo@corp.test', code }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'SSO_REQUIRED' });
    expect(await getLinkedUserIds(e, 'usr_p')).toEqual(['usr_p']);
  });

  it('blocks: link-email start refuses an enforced-SSO address', async () => {
    const res = await handleLinkEmailOtpStart(await asPersonal('/v1/auth/link/email/start', { email: 'ceo@corp.test' }));
    expect(res.status).toBe(403);
  });

  it('blocks: Google identity-link refuses an enforced-SSO address', async () => {
    const tok = await createSessionToken('usr_p', 'personal@gmail.test', e);
    const state = btoa(JSON.stringify({ redirect: '/', linkUserId: 'usr_p', linkAction: 'identity' }));
    const res = await handleGoogleCallback(
      new Request(`https://shareout.test/auth/callback?code=x&state=${encodeURIComponent(state)}`, { headers: { Cookie: `${COOKIE_NAME}=${tok}` } }),
      e,
    );
    expect(await res.text()).toContain('single sign-on');
    expect(await getLinkedUserIds(e, 'usr_p')).toEqual(['usr_p']);
  });

  it('still links a non-SSO address', async () => {
    const code = await otpFor('other@gmail.test');
    const res = await handleLinkEmailOtpVerify(await asPersonal('/v1/auth/link/email/verify', { email: 'other@gmail.test', code }));
    expect(res.status).toBe(200);
    expect((await getLinkedUserIds(e, 'usr_p')).length).toBe(2);
  });
});
