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
import { verifySessionToken } from '../../../src/token';

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
const cookieOf = (r: Response) => r.headers.getSetCookie().find((c) => c.startsWith(`${COOKIE_NAME}=`));
async function sessionUser(r: Response) {
  const c = cookieOf(r)!;
  const tok = c.slice(COOKIE_NAME.length + 1).split(';')[0];
  return verifySessionToken(tok, e as any);
}

beforeAll(applyMigrations);
beforeEach(async () => {
  for (const t of ['users']) await e.DB.exec(`DELETE FROM ${t}`);
  await e.DB.prepare("INSERT INTO users (id, email, name, last_login_at) VALUES ('usr_v', 'victim@corp.test', 'Victim', '2026-01-01T00:00:00.000Z')").run();
  profile = { id: 'G_ATTACKER', email: 'attacker@evil.test', verified_email: true, name: 'Atk', picture: null };
  stubGoogle();
});
afterEach(() => vi.unstubAllGlobals());

describe('f12 unsigned Google link state', () => {
  it('CONFIRMS: forged state linkUserId rewrites victim google_id and later Google login yields victim session', async () => {
    const res = await handleGoogleCallback(cb({ redirect: '/', linkUserId: 'usr_v', linkAction: 'google' }), e);
    const row = await e.DB.prepare("SELECT google_id FROM users WHERE id='usr_v'").first<{ google_id: string }>();
    expect(row?.google_id).toBe('G_ATTACKER');
    expect(cookieOf(res)).toBeUndefined();

    const login = await handleGoogleCallback(cb({ redirect: '/' }), e);
    expect(login.status).toBe(302);
    const sess: any = await sessionUser(login);
    console.log('session payload', JSON.stringify(sess));
    expect(JSON.stringify(sess)).toContain('usr_v');
    const n = await e.DB.prepare("SELECT COUNT(*) c FROM users").first<{ c: number }>();
    expect(n?.c).toBe(1);
  });
});
