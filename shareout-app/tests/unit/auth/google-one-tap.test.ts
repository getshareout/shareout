// P0 robustness: One Tap HTTP handler gates (body, verify, email verified).
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';

const verifyGoogleIdToken = vi.hoisted(() => vi.fn());
const upsertUser = vi.hoisted(() => vi.fn());
const autoJoinWorkspacesByDomain = vi.hoisted(() => vi.fn());
const createSessionToken = vi.hoisted(() => vi.fn());
const resolveSessionMaxAge = vi.hoisted(() => vi.fn());

vi.mock('../../../src/auth/google-id-token', () => ({ verifyGoogleIdToken }));
vi.mock('../../../src/auth/users', () => ({ upsertUser }));
vi.mock('../../../src/workspaces', () => ({ autoJoinWorkspacesByDomain }));
vi.mock('../../../src/token', () => ({ createSessionToken }));
vi.mock('../../../src/auth/session', () => ({ resolveSessionMaxAge }));

import { handleGoogleOneTap } from '../../../src/auth/google-one-tap';

const env = {
  GOOGLE_CLIENT_ID: 'client-id',
  SESSION_SECRET: 'secret',
  SHAREOUT_BASE_URL: 'https://shareout.site',
} as Env;

function post(body: unknown) {
  return handleGoogleOneTap(
    new Request('https://shareout.site/auth/google/one-tap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    env,
  );
}

afterEach(() => vi.restoreAllMocks());

describe('handleGoogleOneTap', () => {
  it('400s on invalid / missing credential', async () => {
    expect((await post('not-json')).status).toBe(400);
    expect((await post({})).status).toBe(400);
    const j = await (await post({})).json() as { error: string };
    expect(j.error).toMatch(/Missing credential/i);
  });

  it('401s when token verification fails', async () => {
    verifyGoogleIdToken.mockRejectedValueOnce(new Error('Invalid signature'));
    const res = await post({ credential: 'bad.jwt' });
    expect(res.status).toBe(401);
  });

  it('403s when Google email is not verified', async () => {
    verifyGoogleIdToken.mockResolvedValueOnce({
      sub: 'g1', email: 'u@x.com', email_verified: false,
      aud: 'client-id', iss: 'https://accounts.google.com', exp: 9e9,
    });
    const res = await post({ credential: 'tok' });
    expect(res.status).toBe(403);
    expect((await res.json() as { error: string }).error).toMatch(/not verified/i);
  });

  it('mints a session cookie on success', async () => {
    verifyGoogleIdToken.mockResolvedValueOnce({
      sub: 'g1', email: 'u@x.com', email_verified: true, name: 'U', picture: '',
      aud: 'client-id', iss: 'https://accounts.google.com', exp: 9e9,
    });
    upsertUser.mockResolvedValueOnce({ id: 'usr_1', email: 'u@x.com', isNew: false });
    autoJoinWorkspacesByDomain.mockResolvedValueOnce(undefined);
    resolveSessionMaxAge.mockResolvedValueOnce(86400);
    createSessionToken.mockResolvedValueOnce('session-token');

    const res = await post({ credential: 'good' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get('Set-Cookie')).toMatch(/session-token|shareout/i);
    expect(upsertUser).toHaveBeenCalledWith(env, expect.objectContaining({ id: 'g1', email: 'u@x.com' }));
  });
});
