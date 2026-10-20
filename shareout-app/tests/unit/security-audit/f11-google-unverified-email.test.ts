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

beforeAll(applyMigrations);
beforeEach(async () => {
  await e.DB.exec('DELETE FROM users');
  await e.DB.prepare("INSERT INTO users (id, email, name, last_login_at) VALUES ('usr_v', 'victim@corp.test', 'Victim', '2026-01-01T00:00:00.000Z')").run();
  vi.stubGlobal('fetch', vi.fn(async (input: any) => {
    const u = String(typeof input === 'string' ? input : input.url);
    if (u.includes('oauth2.googleapis.com/token')) return Response.json({ access_token: 'at', id_token: 'it' });
    if (u.includes('oauth2/v2/userinfo')) return Response.json({ id: 'G_X', email: 'victim@corp.test', verified_email: false, name: 'X', picture: null });
    throw new Error(`unexpected fetch ${u}`);
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe('f11 verified_email ignored', () => {
  it('CONFIRMS: verified_email=false Google profile adopts existing account by email and gets a session', async () => {
    const res = await handleGoogleCallback(new Request('https://shareout.test/auth/callback?code=x'), e);
    expect(res.status).toBe(302);
    const c = res.headers.getSetCookie().find((x) => x.startsWith(`${COOKIE_NAME}=`))!;
    expect(c).toBeTruthy();
    const sess = await verifySessionToken(c.slice(COOKIE_NAME.length + 1).split(';')[0], e as any);
    expect(JSON.stringify(sess)).toContain('usr_v');
    const row = await e.DB.prepare("SELECT google_id FROM users WHERE id='usr_v'").first<{ google_id: string }>();
    expect(row?.google_id).toBe('G_X');
  });
});
