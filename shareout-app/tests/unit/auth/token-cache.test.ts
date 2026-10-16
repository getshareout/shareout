import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashToken, validateToken } from '../../../src/api-auth';
import { handleRevokeMyToken } from '../../../src/api-me-tokens';
import { revokeUserAccess } from '../../../src/superadmin/users';
import { clearBadTokenMemo, TOKEN_CACHE_TTL_SEC, tokenCacheKey } from '../../../src/auth/token-cache';
import type { Env } from '../../../src/types';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

interface TokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string | null;
  revoked: boolean;
  principal_type?: 'user' | 'workspace';
  principal_id?: string;
  subject_external_user_id?: string | null;
}

function makeEnv(tokens: TokenRow[], disabledUsers = new Set<string>()) {
  const kvStore = new Map<string, string>();
  const tokenSelects = vi.fn();
  const kv = {
    get: vi.fn(async (k: string) => kvStore.get(k) ?? null),
    put: vi.fn(async (k: string, v: string) => { kvStore.set(k, v); }),
    delete: vi.fn(async (k: string) => { kvStore.delete(k); }),
  };
  const live = (t: TokenRow) => !t.revoked && (!t.expires_at || t.expires_at > new Date().toISOString());
  const type = (t: TokenRow) => t.principal_type ?? 'user';
  const db = {
    prepare: vi.fn((sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: async () => {
          if (sql.includes('FROM tokens t')) {
            tokenSelects(args[0]);
            const wanted = sql.includes("principal_type = 'workspace'") ? 'workspace' : 'user';
            // Honour the disabled filter only if the query actually carries it.
            const checksDisabled = sql.includes('COALESCE(u.disabled, 0) = 0');
            const t = tokens.find((r) => r.token_hash === args[0] && type(r) === wanted && live(r)
              && !(checksDisabled && disabledUsers.has(r.user_id)));
            if (!t) return null;
            if (wanted === 'workspace') {
              return {
                token_id: t.id, principal_user_id: t.user_id, workspace_id: t.principal_id, scopes: 'artifacts:read',
                subject_external_user_id: t.subject_external_user_id ?? null, expires_at: t.expires_at,
                email: 'u@example.com', username: 'u',
              };
            }
            return { user_id: t.user_id, expires_at: t.expires_at, email: 'u@example.com', username: 'u' };
          }
          return null;
        },
        run: async () => {
          if (sql.startsWith('DELETE FROM tokens WHERE id = ?')) {
            const gone = tokens.filter((r) => r.id === args[0] && r.user_id === args[1]);
            gone.forEach((g) => tokens.splice(tokens.indexOf(g), 1));
            return { results: sql.includes('RETURNING') ? gone.map((g) => ({ token_hash: g.token_hash })) : [], meta: { changes: gone.length } };
          }
          if (sql.startsWith("DELETE FROM tokens WHERE principal_type = 'user' AND principal_id = ?")) {
            const gone = tokens.filter((r) => type(r) === 'user' && r.user_id === args[0]);
            gone.forEach((g) => tokens.splice(tokens.indexOf(g), 1));
            return { results: [], meta: { changes: gone.length } };
          }
          if (sql.startsWith('UPDATE users SET disabled = ?')) {
            if (args[0]) disabledUsers.add(args[1] as string);
            else disabledUsers.delete(args[1] as string);
            return { results: [], meta: { changes: 1 } };
          }
          return { results: [], meta: { changes: 0 } };
        },
        all: async () => {
          if (sql.startsWith('SELECT token_hash FROM tokens')) {
            const id = args[0];
            return {
              results: tokens
                .filter((r) => r.user_id === id || r.principal_id === id || r.subject_external_user_id === id)
                .map((r) => ({ token_hash: r.token_hash })),
            };
          }
          return { results: [] };
        },
      }),
    })),
  };
  const env = { DB: db, SLUGS: kv } as unknown as Env;
  return { env, kv, kvStore, tokenSelects, disabledUsers };
}

const bearer = (token: string) =>
  new Request('https://shareout.example.com/v1/me', { headers: { Authorization: `Bearer ${token}` } });

async function row(token: string, extra: Partial<TokenRow> = {}): Promise<TokenRow> {
  return { id: 'tok_1', user_id: 'usr_1', token_hash: await hashToken(token), expires_at: null, revoked: false, ...extra };
}

beforeEach(() => {
  clearBadTokenMemo();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-16T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('API token validation cache', () => {
  it('miss goes to D1, then fills KV keyed by the token hash (never the raw token)', async () => {
    const token = 'so_' + 'a'.repeat(64);
    const r = await row(token);
    const { env, kv, kvStore, tokenSelects } = makeEnv([r]);

    await expect(validateToken(bearer(token), env)).resolves.toMatchObject({ id: 'usr_1' });
    await settle();

    expect(tokenSelects).toHaveBeenCalledTimes(1);
    expect(kv.put).toHaveBeenCalledWith(tokenCacheKey(r.token_hash), expect.any(String), { expirationTtl: TOKEN_CACHE_TTL_SEC });
    for (const [k, v] of kvStore) {
      expect(k).not.toContain(token);
      expect(v).not.toContain(token);
    }
    expect(kvStore.has(`tokauth:${r.token_hash}`)).toBe(true);
  });

  it('hit is served from KV with no D1 call', async () => {
    const token = 'so_' + 'b'.repeat(64);
    const { env, tokenSelects } = makeEnv([await row(token)]);
    await validateToken(bearer(token), env);
    await settle();
    const prepare = env.DB.prepare as unknown as ReturnType<typeof vi.fn>;
    prepare.mockClear();

    await expect(validateToken(bearer(token), env)).resolves.toEqual({ id: 'usr_1', email: 'u@example.com', username: 'u' });
    expect(tokenSelects).toHaveBeenCalledTimes(1);
    expect(prepare).not.toHaveBeenCalled();
  });

  it('revoke evicts the entry so the next request is rejected', async () => {
    const token = 'so_' + 'c'.repeat(64);
    const { env, kv } = makeEnv([await row(token)]);
    await validateToken(bearer(token), env);
    await settle();

    const res = await handleRevokeMyToken(env, { id: 'usr_1', email: null, username: null }, 'tok_1');
    expect(res.status).toBe(200);
    expect(kv.delete).toHaveBeenCalledWith(tokenCacheKey(await hashToken(token)));

    await expect(validateToken(bearer(token), env)).resolves.toBeNull();
  });

  it('disabling a user evicts their cached tokens', async () => {
    const token = 'so_' + 'd'.repeat(64);
    const { env, kvStore } = makeEnv([await row(token)]);
    await validateToken(bearer(token), env);
    await settle();
    expect(kvStore.has(tokenCacheKey(await hashToken(token)))).toBe(true);

    await revokeUserAccess(env, 'usr_1', true);

    expect(kvStore.has(tokenCacheKey(await hashToken(token)))).toBe(false);
    await expect(validateToken(bearer(token), env)).resolves.toBeNull();
  });

  it('a missed eviction is bounded by the TTL even if KV keeps returning the entry', async () => {
    const token = 'so_' + 'e'.repeat(64);
    const r = await row(token);
    const { env } = makeEnv([r]);
    await validateToken(bearer(token), env);
    await settle();

    r.revoked = true; // revoked in D1, cache untouched (e.g. a stale edge copy)
    vi.setSystemTime(Date.now() + (TOKEN_CACHE_TTL_SEC - 1) * 1000);
    await expect(validateToken(bearer(token), env)).resolves.toMatchObject({ id: 'usr_1' });

    vi.setSystemTime(Date.now() + 2000);
    await expect(validateToken(bearer(token), env)).resolves.toBeNull();
  });

  it('an expired token is not served from cache', async () => {
    const token = 'so_' + 'f'.repeat(64);
    const expiresAt = new Date(Date.now() + 20_000).toISOString();
    const { env, tokenSelects } = makeEnv([await row(token, { expires_at: expiresAt })]);
    await validateToken(bearer(token), env);
    await settle();

    vi.setSystemTime(Date.now() + 10_000);
    await expect(validateToken(bearer(token), env)).resolves.toMatchObject({ id: 'usr_1' });
    expect(tokenSelects).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + 11_000);
    await expect(validateToken(bearer(token), env)).resolves.toBeNull();
    expect(tokenSelects).toHaveBeenCalledTimes(2);
  });

  it('failures never write KV and repeat failures are memoized per isolate', async () => {
    const token = 'so_' + '0'.repeat(64);
    const { env, kv, tokenSelects } = makeEnv([]);

    await expect(validateToken(bearer(token), env)).resolves.toBeNull();
    await expect(validateToken(bearer(token), env)).resolves.toBeNull();
    await settle();

    expect(tokenSelects).toHaveBeenCalledTimes(1);
    expect(kv.put).not.toHaveBeenCalled();
  });
});

describe('disabled users', () => {
  const agentToken = 'sot_' + '1'.repeat(64);
  const externalToken = 'sot_' + '2'.repeat(64);
  const oauthToken = 'so_' + '3'.repeat(64);

  async function fleet() {
    return [
      { id: 'sot_agent', user_id: 'usr_agent', principal_type: 'workspace' as const, principal_id: 'wsp_1',
        token_hash: await hashToken(agentToken), expires_at: null, revoked: false },
      { id: 'sot_ext', user_id: 'usr_ext', principal_type: 'workspace' as const, principal_id: 'wsp_1',
        subject_external_user_id: 'usr_ext', token_hash: await hashToken(externalToken), expires_at: null, revoked: false },
      { id: 'tok_mcp', user_id: 'usr_ext', principal_type: 'user' as const, principal_id: 'usr_ext',
        token_hash: await hashToken(oauthToken), expires_at: new Date(Date.now() + 3_600_000).toISOString(), revoked: false },
    ];
  }

  it('rejects Agent and external tokens of a disabled user on the D1 path', async () => {
    const { env, kv } = makeEnv(await fleet(), new Set(['usr_agent', 'usr_ext']));

    await expect(validateToken(bearer(agentToken), env)).resolves.toBeNull();
    await expect(validateToken(bearer(externalToken), env)).resolves.toBeNull();
    await expect(validateToken(bearer(oauthToken), env)).resolves.toBeNull();
    await settle();
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('disable evicts cached Agent, external and OAuth entries; re-enable restores the workspace tokens', async () => {
    const { env, kvStore } = makeEnv(await fleet());
    for (const t of [agentToken, externalToken, oauthToken]) {
      await expect(validateToken(bearer(t), env)).resolves.toMatchObject({ id: expect.any(String) });
    }
    await settle();
    const keys = await Promise.all([agentToken, externalToken, oauthToken].map(async (t) => tokenCacheKey(await hashToken(t))));
    expect(keys.every((k) => kvStore.has(k))).toBe(true);

    await revokeUserAccess(env, 'usr_agent', true);
    await revokeUserAccess(env, 'usr_ext', true);

    expect(keys.some((k) => kvStore.has(k))).toBe(false);
    await expect(validateToken(bearer(agentToken), env)).resolves.toBeNull();
    await expect(validateToken(bearer(externalToken), env)).resolves.toBeNull();
    await expect(validateToken(bearer(oauthToken), env)).resolves.toBeNull();

    await revokeUserAccess(env, 'usr_agent', false);
    await revokeUserAccess(env, 'usr_ext', false);
    vi.setSystemTime(Date.now() + 11_000); // past the per-isolate negative memo

    await expect(validateToken(bearer(agentToken), env)).resolves.toMatchObject({ id: 'usr_agent', service: { workspaceId: 'wsp_1' } });
    await expect(validateToken(bearer(externalToken), env)).resolves.toMatchObject({ id: 'usr_ext', service: { externalUserId: 'usr_ext' } });
    // Personal and OAuth tokens are deleted on disable, so they stay dead.
    await expect(validateToken(bearer(oauthToken), env)).resolves.toBeNull();
  });
});
