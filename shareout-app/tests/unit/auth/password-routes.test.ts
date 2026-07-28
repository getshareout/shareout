// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { FetchContext } from '../../../src/router/context';
import type { Env } from '../../../src/types';

const { needsSetup, schemaReady } = vi.hoisted(() => ({ needsSetup: vi.fn(), schemaReady: vi.fn() }));
const { getTokenOrSessionUser } = vi.hoisted(() => ({ getTokenOrSessionUser: vi.fn() }));

vi.mock('../../../src/pages/setup', () => ({ needsSetup, schemaReady }));
vi.mock('../../../src/router/helpers/auth-guard', () => ({ getTokenOrSessionUser }));
vi.mock('../../../src/auth/index', () => ({ getSessionUser: vi.fn() }));
vi.mock('../../../src/auth/session', () => ({
  createSessionCookieForUser: vi.fn(async () => 'shareout_session=abc; Path=/'),
}));
vi.mock('../../../src/starter-kit', () => ({ scheduleSeedStarterKit: vi.fn() }));
vi.mock('../../../src/onboarding/welcome-email', () => ({
  scheduleWelcomeEmail: vi.fn(),
  scheduleWorkspaceWelcome: vi.fn(),
}));

import {
  handlePasswordLogin,
  handlePasswordRegister,
  handlePasswordSet,
} from '../../../src/auth/password-routes';
import { hashPassword } from '../../../src/auth/password';

interface DbPlan {
  first?: (sql: string) => unknown;
  onRun?: (sql: string) => void;
}

function ctxFor(body: unknown, env: Partial<Env> = {}, db: DbPlan = {}): FetchContext {
  const request = new Request('https://acme.workers.dev/v1/auth/password/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const fullEnv = {
    ...env,
    DB: {
      prepare: (sql: string) => ({
        bind: () => ({
          first: async () => db.first?.(sql) ?? null,
          run: async () => {
            db.onRun?.(sql);
            return { success: true };
          },
        }),
        first: async () => db.first?.(sql) ?? null,
      }),
    },
  } as unknown as Env;
  return {
    request,
    env: fullEnv,
    url: new URL(request.url),
    path: new URL(request.url).pathname,
    hostname: 'acme.workers.dev',
    addCORS: (r: Response) => r,
  };
}

const GOOD = 'a sufficiently long password';

beforeEach(() => {
  vi.clearAllMocks();
  needsSetup.mockResolvedValue(true);
  schemaReady.mockResolvedValue(true);
  getTokenOrSessionUser.mockResolvedValue({ id: 'usr_1', email: 'a@example.com' });
});

describe('POST /v1/auth/password/register', () => {
  it('creates the first admin and returns a session cookie', async () => {
    const ran: string[] = [];
    const res = await handlePasswordRegister(
      ctxFor({ email: 'Owner@Example.com', password: GOOD }, {}, { onRun: (sql) => ran.push(sql) }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Set-Cookie')).toContain('shareout_session');
    expect(await res.json()).toEqual({ ok: true, user: { email: 'owner@example.com' } });
    expect(ran.some((s) => s.includes('INSERT INTO users'))).toBe(true);
    expect(ran.some((s) => s.includes('user_passwords'))).toBe(true);
  });

  // The endpoint exists only while the instance has no users. Otherwise it would be
  // an open self-registration hole on someone else's instance.
  // The Deploy button creates the D1 database but does not apply migrations, so this
  // is the state a button-deployed instance is actually in on first open.
  it('503s with the migration command when the schema is missing', async () => {
    schemaReady.mockResolvedValue(false);
    const res = await handlePasswordRegister(ctxFor({ email: 'a@example.com', password: GOOD }));
    expect(res.status).toBe(503);
    expect((await res.json() as { error: string }).error).toContain('wrangler d1 migrations apply');
  });

  it('404s once the instance has a user', async () => {
    needsSetup.mockResolvedValue(false);
    const res = await handlePasswordRegister(ctxFor({ email: 'a@example.com', password: GOOD }));
    expect(res.status).toBe(404);
  });

  it('honours SETUP_ADMIN_EMAIL as the pinned first admin', async () => {
    const env = { SETUP_ADMIN_EMAIL: 'boss@example.com' };
    const wrong = await handlePasswordRegister(ctxFor({ email: 'someone@else.com', password: GOOD }, env));
    expect(wrong.status).toBe(403);

    const right = await handlePasswordRegister(ctxFor({ email: 'BOSS@example.com', password: GOOD }, env));
    expect(right.status).toBe(200);
  });

  it('rejects a bad email or a weak password before writing anything', async () => {
    const ran: string[] = [];
    const plan = { onRun: (sql: string) => ran.push(sql) };
    expect((await handlePasswordRegister(ctxFor({ email: 'nope', password: GOOD }, {}, plan))).status).toBe(400);
    expect((await handlePasswordRegister(ctxFor({ email: 'a@b.com', password: 'short' }, {}, plan))).status).toBe(400);
    expect(ran).toHaveLength(0);
  });
});

describe('POST /v1/auth/password/login', () => {
  it('signs in with the right password', async () => {
    const stored = await hashPassword(GOOD);
    const res = await handlePasswordLogin(
      ctxFor({ email: 'a@example.com', password: GOOD }, {}, {
        first: (sql) => (sql.includes('FROM users') ? { id: 'usr_1', email: 'a@example.com', last_login_at: '2026-01-01', ...stored } : null),
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Set-Cookie')).toContain('shareout_session');
  });

  it('gives the same 401 for a wrong password and an unknown account', async () => {
    const stored = await hashPassword(GOOD);
    const wrongPassword = await handlePasswordLogin(
      ctxFor({ email: 'a@example.com', password: 'not the password' }, {}, {
        first: (sql) => (sql.includes('FROM users') ? { id: 'usr_1', email: 'a@example.com', last_login_at: null, ...stored } : null),
      }),
    );
    const unknownAccount = await handlePasswordLogin(
      ctxFor({ email: 'nobody@example.com', password: GOOD }),
    );
    expect(wrongPassword.status).toBe(401);
    expect(unknownAccount.status).toBe(401);
    expect(await wrongPassword.json()).toEqual(await unknownAccount.json());
  });
});

describe('POST /v1/auth/password (set / change)', () => {
  it('sets a first password without asking for a current one', async () => {
    const ran: string[] = [];
    const res = await handlePasswordSet(
      ctxFor({ password: GOOD }, {}, { first: () => null, onRun: (sql) => ran.push(sql) }),
    );
    expect(res.status).toBe(200);
    expect(ran.some((s) => s.includes('user_passwords'))).toBe(true);
  });

  // A stolen session should not be enough to lock the owner out of their account.
  it('requires the current password to change an existing one', async () => {
    const stored = await hashPassword(GOOD);
    const plan = { first: () => ({ n: 1, ...stored }) };
    const noCurrent = await handlePasswordSet(ctxFor({ password: 'a brand new long password' }, {}, plan));
    expect(noCurrent.status).toBe(403);

    const withCurrent = await handlePasswordSet(
      ctxFor({ password: 'a brand new long password', current_password: GOOD }, {}, plan),
    );
    expect(withCurrent.status).toBe(200);
  });

  it('401s when nobody is signed in', async () => {
    getTokenOrSessionUser.mockResolvedValue(null);
    expect((await handlePasswordSet(ctxFor({ password: GOOD }))).status).toBe(401);
  });
});
