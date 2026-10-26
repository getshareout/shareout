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
import { handleGoogleCallback } from '../../../src/auth/google-oauth';
import { COOKIE_NAME } from '../../../src/auth/constants';
import { createSessionToken } from '../../../src/token';

const e = {
  ...baseEnv,
  SESSION_SECRET: 'test-session-secret',
  SHAREOUT_BASE_URL: 'https://shareout.test',
  GOOGLE_CLIENT_ID: 'cid',
  GOOGLE_CLIENT_SECRET: 'csec',
  SIGNUPS_PAUSED: '',
} as Env;

let profile: Record<string, unknown>;
function stubGoogle() {
  vi.stubGlobal('fetch', vi.fn(async (input: any) => {
    const u = String(typeof input === 'string' ? input : input.url);
    if (u.includes('oauth2.googleapis.com/token')) return Response.json({ access_token: 'at', id_token: 'it' });
    if (u.includes('googleapis.com/oauth2/v2/userinfo')) return Response.json(profile);
    throw new Error(`unexpected fetch ${u}`);
  }));
}
const cb = (state?: Record<string, unknown>) =>
  new Request(`https://shareout.test/auth/callback?code=x${state ? `&state=${encodeURIComponent(btoa(JSON.stringify(state)))}` : ''}`);

beforeAll(applyMigrations);
beforeEach(async () => {
  for (const t of ['users']) await e.DB.exec(`DELETE FROM ${t}`);
  await e.DB.prepare("INSERT INTO users (id, email, name, last_login_at) VALUES ('usr_v', 'victim@corp.test', 'Victim', '2026-01-01T00:00:00.000Z')").run();
  profile = { id: 'G_ATTACKER', email: 'attacker@evil.test', verified_email: true, name: 'Atk', picture: null };
  stubGoogle();
});
afterEach(() => vi.unstubAllGlobals());

const withCookie = (state: Record<string, unknown>, token: string) =>
  new Request(`https://shareout.test/auth/callback?code=x&state=${encodeURIComponent(btoa(JSON.stringify(state)))}`, {
    headers: { Cookie: `${COOKIE_NAME}=${token}` },
  });

describe('f12 unsigned Google link state', () => {
  it('blocks: forged state linkUserId without a matching session does not link', async () => {
    const anon = await handleGoogleCallback(cb({ redirect: '/', linkUserId: 'usr_v', linkAction: 'google' }), e);
    expect(anon.status).toBe(400);
    const other = await createSessionToken('usr_other', 'other@x.test', e);
    const mismatched = await handleGoogleCallback(withCookie({ redirect: '/', linkUserId: 'usr_v', linkAction: 'google' }, other), e);
    expect(mismatched.status).toBe(400);
    const row = await e.DB.prepare("SELECT google_id FROM users WHERE id='usr_v'").first<{ google_id: string | null }>();
    expect(row?.google_id).toBeNull();
  });

  it('still links when the session user matches linkUserId', async () => {
    const own = await createSessionToken('usr_v', 'victim@corp.test', e);
    const res = await handleGoogleCallback(withCookie({ redirect: '/', linkUserId: 'usr_v', linkAction: 'google' }, own), e);
    expect(res.status).toBe(200);
    const row = await e.DB.prepare("SELECT google_id FROM users WHERE id='usr_v'").first<{ google_id: string }>();
    expect(row?.google_id).toBe('G_ATTACKER');
  });
});
