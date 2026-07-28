import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkRateLimit,
  cleanupExpiredAdminSessions,
  handleCreateAccount,
  handleCreateAdminSession,
  handleGetProfile,
  handleLinkEmail,
  handleUpdateProfile,
  incrementRateLimit,
  validateAdminSession,
  validateToken,
} from '../../src/api-auth';
import type { AuthUser } from '../../src/api-auth';
import type { Env } from '../../src/types';
import { SUPERADMIN_EMAILS } from '../../src/superadmin/recipients';

// The shipped roster is empty by design (a public repo must not grant super-admin to a
// baked-in address), so tests that need one mock the roster import.
const testRoster = vi.hoisted(() => ({
  default: {
    recipients: [{ email: 'admin@example.com', telegramChatId: 555000 }, { email: 'ops@example.com' }],
  },
}));
vi.mock('../../superadmin-recipients.json', () => testRoster);

const SA = SUPERADMIN_EMAILS[0]!;

const baseEnv = {
  SHAREOUT_BASE_URL: 'https://shareout.example.com',
} as Env;

const testUser: AuthUser = {
  id: 'usr_1',
  email: 'owner@example.com',
  username: 'owner',
};

async function sha256(text: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function makeDbMock(handlers: {
  first?: (sql: string, ...bindArgs: unknown[]) => unknown;
  run?: (sql: string, ...bindArgs: unknown[]) => unknown;
} = {}): Env['DB'] {
  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...bindArgs: unknown[]) => ({
        first: vi.fn(async () => handlers.first?.(sql, ...bindArgs) ?? null),
        run: vi.fn(async () => handlers.run?.(sql, ...bindArgs) ?? { success: true, meta: { changes: 1 } }),
      })),
    })),
  } as unknown as Env['DB'];
}

function jsonRequest(body: unknown, init: RequestInit = {}): Request {
  return new Request('https://shareout.example.com/v1/profile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...Object.fromEntries(new Headers(init.headers ?? {})) },
    body: JSON.stringify(body),
    ...init,
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('validateToken', () => {
  it('returns null when Authorization header is missing or malformed', async () => {
    const env = { ...baseEnv, DB: makeDbMock() };

    await expect(validateToken(new Request('https://shareout.example.com'), env)).resolves.toBeNull();
    await expect(validateToken(
      new Request('https://shareout.example.com', { headers: { Authorization: 'Token abc' } }),
      env,
    )).resolves.toBeNull();
  });

  it('returns null when token does not use the so_ prefix', async () => {
    const env = { ...baseEnv, DB: makeDbMock() };

    await expect(validateToken(
      new Request('https://shareout.example.com', { headers: { Authorization: 'Bearer not_so_token' } }),
      env,
    )).resolves.toBeNull();
  });

  it('returns null when token hash is not found in the database', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: () => null }) };

    await expect(validateToken(
      new Request('https://shareout.example.com', { headers: { Authorization: 'Bearer so_deadbeef' } }),
      env,
    )).resolves.toBeNull();
  });

  it('returns the user and updates last_used_at for a valid token', async () => {
    const token = 'so_validtoken';
    const tokenHash = await sha256(token);
    const run = vi.fn(async () => ({ success: true }));
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql, ...args) => {
          if (sql.includes('tokens t') && args[0] === tokenHash) {
            return { user_id: 'usr_1', email: 'user@example.com', username: 'alice' };
          }
          return null;
        },
        run,
      }),
    };

    await expect(validateToken(
      new Request('https://shareout.example.com', { headers: { Authorization: `Bearer ${token}` } }),
      env,
    )).resolves.toEqual({
      id: 'usr_1',
      email: 'user@example.com',
      username: 'alice',
    });
    expect(run).toHaveBeenCalled();
  });

  function makeValidEnv(opts: { run?: ReturnType<typeof vi.fn>; tokenHash: string; kv?: Env['SLUGS'] }): Env {
    return {
      ...baseEnv,
      SLUGS: opts.kv,
      DB: makeDbMock({
        first: (sql, ...args) => {
          if (sql.includes('tokens t') && args[0] === opts.tokenHash) {
            return { user_id: 'usr_1', email: 'user@example.com', username: 'alice' };
          }
          return null;
        },
        run: opts.run,
      }),
    } as Env;
  }

  function makeKvMock(handlers: { get?: () => unknown; put?: () => unknown } = {}): { kv: Env['SLUGS']; get: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn> } {
    const get = vi.fn(async () => handlers.get?.() ?? null);
    const put = vi.fn(async () => handlers.put?.());
    return { kv: { get, put } as unknown as Env['SLUGS'], get, put };
  }

  function bearer(token: string): Request {
    return new Request('https://shareout.example.com', { headers: { Authorization: `Bearer ${token}` } });
  }

  it('writes last_used_at and sets the throttle marker on first use', async () => {
    const token = 'so_first';
    const tokenHash = await sha256(token);
    const run = vi.fn(async () => ({ success: true }));
    const { kv, get, put } = makeKvMock();
    const env = makeValidEnv({ run, tokenHash, kv });

    await validateToken(bearer(token), env);

    expect(get).toHaveBeenCalledWith(`tokused:${tokenHash}`);
    expect(run).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledWith(`tokused:${tokenHash}`, '1', { expirationTtl: 300 });
  });

  it('skips the last_used_at write when the throttle marker is present', async () => {
    const token = 'so_throttled';
    const tokenHash = await sha256(token);
    const run = vi.fn(async () => ({ success: true }));
    const { kv, put } = makeKvMock({ get: () => '1' });
    const env = makeValidEnv({ run, tokenHash, kv });

    await expect(validateToken(bearer(token), env)).resolves.toMatchObject({ id: 'usr_1' });

    expect(run).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it('falls open and writes when KV.get throws', async () => {
    const token = 'so_kvfail';
    const tokenHash = await sha256(token);
    const run = vi.fn(async () => ({ success: true }));
    const kv = { get: vi.fn(async () => { throw new Error('kv down'); }), put: vi.fn(async () => {}) } as unknown as Env['SLUGS'];
    const env = makeValidEnv({ run, tokenHash, kv });

    await expect(validateToken(bearer(token), env)).resolves.toMatchObject({ id: 'usr_1' });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('never fails auth when the last_used_at write throws', async () => {
    const token = 'so_writefail';
    const tokenHash = await sha256(token);
    const run = vi.fn(async () => { throw new Error('d1 down'); });
    const env = makeValidEnv({ run, tokenHash });

    await expect(validateToken(bearer(token), env)).resolves.toEqual({
      id: 'usr_1',
      email: 'user@example.com',
      username: 'alice',
    });
  });

  it('memoizes per request: repeat calls reuse one SELECT and one write', async () => {
    const token = 'so_memo';
    const tokenHash = await sha256(token);
    const run = vi.fn(async () => ({ success: true }));
    const env = makeValidEnv({ run, tokenHash });
    const prepare = env.DB.prepare as unknown as ReturnType<typeof vi.fn>;
    const req = bearer(token);

    const [a, b, c] = await Promise.all([
      validateToken(req, env),
      validateToken(req, env),
      validateToken(req, env),
    ]);

    expect(a).toEqual(b);
    expect(b).toEqual(c);
    expect(run).toHaveBeenCalledTimes(1);
    const selects = prepare.mock.calls.filter(([sql]: [string]) => String(sql).includes('tokens t'));
    expect(selects).toHaveLength(1);
  });
});

describe('handleCreateAccount', () => {
  it('creates a user and API token and returns 201', async () => {
    const run = vi.fn(async () => ({ success: true }));
    const env = { ...baseEnv, DB: makeDbMock({ run }) };

    const response = await handleCreateAccount(new Request('https://shareout.example.com/v1/auth/create-account', {
      method: 'POST',
    }), env);

    expect(response.status).toBe(201);
    const body = await response.json() as { token: string; user_id: string };
    expect(body.token).toMatch(/^so_[0-9a-f]{64}$/);
    expect(body.user_id).toMatch(/^usr_/);
    expect(env.DB.prepare).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe('handleLinkEmail', () => {
  it('rejects invalid JSON and invalid email addresses', async () => {
    const env = { ...baseEnv, DB: makeDbMock() };

    const badJson = await handleLinkEmail(
      new Request('https://shareout.example.com/v1/auth/link-email', { method: 'POST', body: 'not-json' }),
      env,
      testUser,
    );
    expect(badJson.status).toBe(400);
    await expect(badJson.json()).resolves.toMatchObject({ code: 'INVALID_JSON' });

    for (const email of ['', 'not-an-email', 'missing@domain']) {
      const response = await handleLinkEmail(jsonRequest({ email }), env, testUser);
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ code: 'INVALID_EMAIL' });
    }
  });

  it('rejects emails already linked to another user', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: () => ({ id: 'usr_other' }),
      }),
    };

    const response = await handleLinkEmail(jsonRequest({ email: 'Taken@Example.com' }), env, testUser);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'EMAIL_IN_USE' });
  });

  it('rejects missing email field', async () => {
    const env = { ...baseEnv, DB: makeDbMock() };
    const response = await handleLinkEmail(jsonRequest({}), env, testUser);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'INVALID_EMAIL' });
  });

  it('links a normalized email address', async () => {
    const run = vi.fn(async () => ({ success: true }));
    const env = { ...baseEnv, DB: makeDbMock({ first: () => null, run }) };

    const response = await handleLinkEmail(jsonRequest({ email: 'New@Example.com' }), env, testUser);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, email: 'new@example.com' });
    expect(run).toHaveBeenCalled();
  });
});

describe('handleGetProfile', () => {
  it('returns 404 when the user row is missing', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: () => null }) };

    const response = await handleGetProfile(new Request('https://shareout.example.com/v1/profile'), env, testUser);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('returns parsed profile metadata', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: () => ({
          id: 'usr_1',
          email: 'owner@example.com',
          username: 'owner',
          name: 'Owner',
          metadata: '{"plan":"pro"}',
          created_at: '2026-01-01T00:00:00Z',
        }),
      }),
    };

    const response = await handleGetProfile(new Request('https://shareout.example.com/v1/profile'), env, testUser);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      id: 'usr_1',
      email: 'owner@example.com',
      username: 'owner',
      name: 'Owner',
      metadata: { plan: 'pro' },
      created_at: '2026-01-01T00:00:00Z',
    });
  });

  it('defaults metadata to an empty object when unset', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: () => ({
          id: 'usr_1',
          email: null,
          username: null,
          name: null,
          metadata: null,
          created_at: '2026-01-01T00:00:00Z',
        }),
      }),
    };

    const response = await handleGetProfile(new Request('https://shareout.example.com/v1/profile'), env, testUser);

    await expect(response.json()).resolves.toMatchObject({ metadata: {} });
  });
});

describe('handleUpdateProfile', () => {
  it('rejects invalid JSON, invalid usernames, and empty updates', async () => {
    const env = { ...baseEnv, DB: makeDbMock() };

    const badJson = await handleUpdateProfile(
      new Request('https://shareout.example.com/v1/profile', { method: 'PATCH', body: '{' }),
      env,
      testUser,
    );
    expect(badJson.status).toBe(400);
    await expect(badJson.json()).resolves.toMatchObject({ code: 'INVALID_JSON' });

    const badUsername = await handleUpdateProfile(jsonRequest({ username: 'ab' }), env, testUser);
    expect(badUsername.status).toBe(400);
    await expect(badUsername.json()).resolves.toMatchObject({ code: 'INVALID_USERNAME' });

    const noUpdates = await handleUpdateProfile(jsonRequest({}), env, testUser);
    expect(noUpdates.status).toBe(400);
    await expect(noUpdates.json()).resolves.toMatchObject({ code: 'NO_UPDATES' });
  });

  it('rejects usernames that are already taken', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => (sql.includes('username = ?') ? { id: 'usr_other' } : null),
      }),
    };

    const response = await handleUpdateProfile(jsonRequest({ username: 'Taken_Name' }), env, testUser);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'USERNAME_TAKEN' });
  });

  it('allows clearing username and name fields', async () => {
    let call = 0;
    const run = vi.fn(async () => ({ success: true }));
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          call += 1;
          if (call === 1 && sql.includes('username = ?')) return null;
          if (sql.includes('FROM users WHERE id')) {
            return {
              id: 'usr_1',
              email: 'owner@example.com',
              username: null,
              name: null,
              metadata: null,
              created_at: '2026-01-01T00:00:00Z',
            };
          }
          return null;
        },
        run,
      }),
    };

    const response = await handleUpdateProfile(
      jsonRequest({ username: '', name: '' }, { method: 'PATCH' }),
      env,
      testUser,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ username: null, name: null });
  });

  it('updates profile fields and returns the refreshed profile', async () => {
    let call = 0;
    const run = vi.fn(async () => ({ success: true }));
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          call += 1;
          if (call === 1 && sql.includes('username = ?')) return null;
          if (sql.includes('FROM users WHERE id')) {
            return {
              id: 'usr_1',
              email: 'owner@example.com',
              username: 'new_name',
              name: 'New Name',
              metadata: '{"tier":"beta"}',
              created_at: '2026-01-01T00:00:00Z',
            };
          }
          return null;
        },
        run,
      }),
    };

    const response = await handleUpdateProfile(
      jsonRequest({ username: 'New_Name', name: 'New Name', metadata: { tier: 'beta' } }, { method: 'PATCH' }),
      env,
      testUser,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      username: 'new_name',
      name: 'New Name',
      metadata: { tier: 'beta' },
    });
    expect(run).toHaveBeenCalled();
  });
});

describe('checkRateLimit and incrementRateLimit', () => {
  it('reports remaining quota based on the daily window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-30T14:30:00Z'));

    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: () => ({ count: 99 }),
      }),
    };

    await expect(checkRateLimit(env, 'usr_1', 'publish')).resolves.toMatchObject({
      allowed: true,
      remaining: 1,
    });

    const freshEnv = {
      ...baseEnv,
      DB: makeDbMock({
        first: () => null,
      }),
    };

    await expect(checkRateLimit(freshEnv, 'usr_1', 'publish')).resolves.toMatchObject({
      allowed: true,
      remaining: 100,
    });

    const blockedEnv = {
      ...baseEnv,
      DB: makeDbMock({
        first: () => ({ count: 100 }),
      }),
    };

    await expect(checkRateLimit(blockedEnv, 'usr_1', 'publish')).resolves.toMatchObject({
      allowed: false,
      remaining: 0,
    });
  });

  it('bypasses the daily publish cap for platform super-admins', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-30T14:30:00Z'));

    const blockedEnv = {
      ...baseEnv,
      DB: makeDbMock({
        first: () => ({ count: 100 }),
      }),
    };

    await expect(checkRateLimit(blockedEnv, 'usr_1', 'publish', SA)).resolves.toMatchObject({
      allowed: true,
      remaining: 100,
    });
  });

  it('increments the daily rate limit counter', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-30T14:30:00Z'));

    const run = vi.fn(async () => ({ success: true }));
    const env = { ...baseEnv, DB: makeDbMock({ run }) };

    await incrementRateLimit(env, 'usr_1', 'publish');

    expect(env.DB.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO rate_limits'));
    expect(run).toHaveBeenCalled();
  });

  it('does not increment the daily publish counter for super-admins', async () => {
    const run = vi.fn(async () => ({ success: true }));
    const env = { ...baseEnv, DB: makeDbMock({ run }) };

    await incrementRateLimit(env, 'usr_1', 'publish', SA);

    expect(run).not.toHaveBeenCalled();
  });
});

describe('handleCreateAdminSession', () => {
  it('rejects invalid JSON and missing artifact identifiers', async () => {
    const env = { ...baseEnv, DB: makeDbMock() };

    const badJson = await handleCreateAdminSession(
      new Request('https://shareout.example.com/v1/admin-session', { method: 'POST', body: 'x' }),
      env,
      testUser,
    );
    expect(badJson.status).toBe(400);
    await expect(badJson.json()).resolves.toMatchObject({ code: 'INVALID_JSON' });

    const missing = await handleCreateAdminSession(jsonRequest({}), env, testUser);
    expect(missing.status).toBe(400);
    await expect(missing.json()).resolves.toMatchObject({ code: 'MISSING_PARAM' });
  });

  it('returns 404 when slug or artifact_id cannot be resolved', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: () => null }) };

    const slugMissing = await handleCreateAdminSession(jsonRequest({ slug: 'missing' }), env, testUser);
    expect(slugMissing.status).toBe(404);

    const artifactMissing = await handleCreateAdminSession(jsonRequest({ artifact_id: 'art_missing' }), env, testUser);
    expect(artifactMissing.status).toBe(404);
  });

  it('denies access for non-owners without editor collaborator role', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('FROM artifacts a')) {
            return { id: 'art_1', owner_id: 'usr_other', slug: 'demo' };
          }
          if (sql.includes('FROM collaborators')) return null;
          return null;
        },
      }),
    };

    const response = await handleCreateAdminSession(jsonRequest({ artifact_id: 'art_1' }), env, testUser);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('denies viewer collaborators', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('FROM artifacts a')) {
            return { id: 'art_1', owner_id: 'usr_other', slug: 'demo' };
          }
          if (sql.includes('FROM collaborators')) return { role: 'viewer' };
          return null;
        },
      }),
    };

    const response = await handleCreateAdminSession(jsonRequest({ artifact_id: 'art_1' }), env, testUser);

    expect(response.status).toBe(403);
  });

  it('allows editor collaborators to create admin sessions', async () => {
    const run = vi.fn(async () => ({ success: true }));
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('FROM artifacts a')) {
            return { id: 'art_1', owner_id: 'usr_other', slug: 'shared' };
          }
          if (sql.includes('FROM collaborators')) return { role: 'editor' };
          return null;
        },
        run,
      }),
    };

    const response = await handleCreateAdminSession(jsonRequest({ artifact_id: 'art_1' }), env, testUser);

    expect(response.status).toBe(201);
    const body = await response.json() as { admin_url: string };
    expect(body.admin_url).toContain('/a/shared/admin?session=');
  });

  it('returns 400 when the artifact has no deployment slug', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: () => ({ id: 'art_1', owner_id: 'usr_1', slug: null }),
      }),
    };

    const response = await handleCreateAdminSession(jsonRequest({ artifact_id: 'art_1' }), env, testUser);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'NO_DEPLOYMENT' });
  });

  it('creates an admin session for the artifact owner', async () => {
    const run = vi.fn(async () => ({ success: true }));
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('FROM artifacts a')) {
            return { id: 'art_1', owner_id: 'usr_1', slug: 'demo' };
          }
          return null;
        },
        run,
      }),
    };

    const response = await handleCreateAdminSession(
      jsonRequest({ artifact_id: 'art_1' }, {
        headers: { 'cf-connecting-ip': '1.2.3.4' },
      }),
      env,
      testUser,
    );

    expect(response.status).toBe(201);
    const body = await response.json() as { admin_url: string; expires_in: number; session_token: string };
    expect(body.expires_in).toBe(900);
    expect(body.admin_url).toBe(`https://shareout.example.com/a/demo/admin?session=${body.session_token}`);
    expect(body.session_token).toMatch(/^[0-9a-f]{64}$/);
    expect(run).toHaveBeenCalled();
  });

  it('resolves artifact_id from a production slug', async () => {
    const run = vi.fn(async () => ({ success: true }));
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('FROM deployments d')) {
            return { id: 'art_slug', slug: 'my-slug' };
          }
          if (sql.includes('FROM artifacts a')) {
            return { id: 'art_slug', owner_id: 'usr_1', slug: 'my-slug' };
          }
          return null;
        },
        run,
      }),
    };

    const response = await handleCreateAdminSession(jsonRequest({ slug: 'my-slug' }), env, testUser);

    expect(response.status).toBe(201);
    const body = await response.json() as { admin_url: string };
    expect(body.admin_url).toContain('/a/my-slug/admin?session=');
  });
});

describe('validateAdminSession', () => {
  it('returns null for missing or expired sessions', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: () => null }) };

    await expect(validateAdminSession(env, 'missing-token')).resolves.toBeNull();
  });

  it('marks the session used and returns user and artifact ids', async () => {
    const run = vi.fn(async () => ({ success: true }));
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: () => ({ id: 'adm_1', user_id: 'usr_1', artifact_id: 'art_1' }),
        run,
      }),
    };

    await expect(validateAdminSession(env, 'session-token')).resolves.toEqual({
      userId: 'usr_1',
      artifactId: 'art_1',
    });
    expect(run).toHaveBeenCalled();
  });
});

describe('cleanupExpiredAdminSessions', () => {
  it('returns the number of deleted rows', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        run: () => ({ success: true, meta: { changes: 3 } }),
      }),
    };

    await expect(cleanupExpiredAdminSessions(env)).resolves.toBe(3);
  });

  it('returns zero when meta.changes is missing', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        run: () => ({ success: true }),
      }),
    };

    await expect(cleanupExpiredAdminSessions(env)).resolves.toBe(0);
  });
});
