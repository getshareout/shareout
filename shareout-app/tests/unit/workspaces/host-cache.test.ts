// Subdomain host resolution: workspace slug → id cached in KV (hit, negative hit),
// invalidated by every writer that creates, renames or deletes a workspace.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hostWorkspaceId } from '../../../src/pages/home/host';
import {
  clearWorkspaceSlugMisses, invalidateWorkspaceSlug, isWorkspaceSlugShape, workspaceIdBySlug, workspaceSlugCacheKey, workspaceSlugMissCount,
} from '../../../src/workspaces/host-cache';
import { createWorkspaceForUser, handleDeleteWorkspace, handleUpdateWorkspace } from '../../../src/workspaces/crud';
import type { AuthUser } from '../../../src/api-auth';
import type { Env } from '../../../src/types';

const WS = 'wsp_acme';
const owner = { id: 'usr_owner', email: 'owner@example.com', username: null } as AuthUser;

function fakeKv() {
  const store = new Map<string, { value: string; ttl?: number }>();
  const kv = {
    get: async (k: string) => store.get(k)?.value ?? null,
    put: async (k: string, value: string, o?: { expirationTtl?: number }) => { store.set(k, { value, ttl: o?.expirationTtl }); },
    delete: async (k: string) => { store.delete(k); },
  };
  return { kv: kv as unknown as KVNamespace, store };
}

/** `slugs` maps slug → workspace id for `SELECT id FROM workspaces WHERE slug = ?`. */
function makeEnv(slugs: Record<string, string>, extra: (sql: string, args: unknown[]) => unknown = () => null) {
  const { kv, store } = fakeKv();
  const puts: string[] = [];
  const put = kv.put.bind(kv);
  (kv as unknown as { put: typeof put }).put = async (k, v, o) => { puts.push(k); return put(k, v, o); };
  const sqls: string[] = [];
  const DB = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        async first() {
          sqls.push(sql);
          if (sql === 'SELECT id FROM workspaces WHERE slug = ?') return slugs[args[0] as string] ? { id: slugs[args[0] as string] } : null;
          return extra(sql, args) ?? null;
        },
        async run() { sqls.push(sql); return { success: true, meta: { changes: 1 } }; },
        async all() { sqls.push(sql); return { results: [] }; },
      }),
    }),
  };
  const env = { DB, SLUGS: kv, SHAREOUT_BASE_URL: 'https://x.test' } as unknown as Env;
  return { env, store, puts, d1Lookups: () => sqls.filter((s) => s === 'SELECT id FROM workspaces WHERE slug = ?').length };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => clearWorkspaceSlugMisses());
afterEach(() => vi.restoreAllMocks());

describe('workspace slug → id cache', () => {
  it('a miss reads D1 once and fills KV; the next lookup is a KV hit', async () => {
    const t = makeEnv({ acme: WS });
    expect(await workspaceIdBySlug(t.env, 'acme')).toBe(WS);
    await tick();
    expect(t.store.get(workspaceSlugCacheKey('acme'))).toEqual({ value: WS, ttl: 300 });
    expect(await workspaceIdBySlug(t.env, 'acme')).toBe(WS);
    expect(t.d1Lookups()).toBe(1);
  });

  it('a miss writes nothing to KV; repeats are answered from the isolate', async () => {
    const t = makeEnv({});
    expect(await workspaceIdBySlug(t.env, 'nope')).toBeNull();
    await tick();
    expect(t.puts).toEqual([]);
    expect(t.store.size).toBe(0);
    expect(await workspaceIdBySlug(t.env, 'nope')).toBeNull();
    expect(t.d1Lookups()).toBe(1);
  });

  it('a stale negative KV entry from an older build is not trusted', async () => {
    const t = makeEnv({ acme: WS });
    t.store.set(workspaceSlugCacheKey('acme'), { value: '-' });
    expect(await workspaceIdBySlug(t.env, 'acme')).toBe(WS);
  });

  it('slugs no workspace can have skip D1 and KV entirely', async () => {
    const t = makeEnv({});
    for (const slug of ['-x', 'x-', 'a_b', 'a.b', 'ABC', '', 'a'.repeat(64)]) {
      expect(isWorkspaceSlugShape(slug)).toBe(false);
      expect(await workspaceIdBySlug(t.env, slug)).toBeNull();
    }
    await tick();
    expect(t.d1Lookups()).toBe(0);
    expect(t.puts).toEqual([]);
    expect(workspaceSlugMissCount()).toBe(0);
    expect(isWorkspaceSlugShape('a')).toBe(true);
    expect(isWorkspaceSlugShape('a'.repeat(63))).toBe(true);
  });

  it('the isolate negative cache expires after 60s', async () => {
    const t = makeEnv({});
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    await workspaceIdBySlug(t.env, 'later');
    now.mockReturnValue(1_000_000 + 59_000);
    await workspaceIdBySlug(t.env, 'later');
    expect(t.d1Lookups()).toBe(1);
    now.mockReturnValue(1_000_000 + 61_000);
    await workspaceIdBySlug(t.env, 'later');
    expect(t.d1Lookups()).toBe(2);
  });

  it('the isolate negative cache stays bounded, evicting the oldest', async () => {
    const t = makeEnv({});
    for (let i = 0; i < 1200; i++) await workspaceIdBySlug(t.env, `rnd${i}`);
    expect(workspaceSlugMissCount()).toBe(1000);
    expect(t.d1Lookups()).toBe(1200);
    await workspaceIdBySlug(t.env, 'rnd1199');
    expect(t.d1Lookups()).toBe(1200);
    await workspaceIdBySlug(t.env, 'rnd0');
    expect(t.d1Lookups()).toBe(1201);
    await tick();
    expect(t.puts).toEqual([]);
  });

  it('hostWorkspaceId resolves the subdomain through the cache, apex hosts skip it', async () => {
    const t = makeEnv({ acme: WS });
    expect(await hostWorkspaceId(new Request('https://acme.x.test/v1/home/recent'), t.env)).toBe(WS);
    await tick();
    expect(await hostWorkspaceId(new Request('https://acme.x.test/v1/home/recent'), t.env)).toBe(WS);
    expect(await hostWorkspaceId(new Request('https://x.test/v1/home/recent'), t.env)).toBeNull();
    expect(t.d1Lookups()).toBe(1);
  });

  it('without KV it falls through to D1 every time', async () => {
    const t = makeEnv({ acme: WS });
    const env = { ...t.env, SLUGS: undefined } as Env;
    await workspaceIdBySlug(env, 'acme');
    await workspaceIdBySlug(env, 'acme');
    expect(t.d1Lookups()).toBe(2);
  });

  it('invalidateWorkspaceSlug drops each named slug and ignores empties', async () => {
    const t = makeEnv({});
    t.store.set(workspaceSlugCacheKey('a'), { value: 'wsp_a' });
    t.store.set(workspaceSlugCacheKey('b'), { value: WS });
    await invalidateWorkspaceSlug(t.env, 'a', null, 'b', undefined);
    expect(t.store.size).toBe(0);
  });
});

describe('writers invalidate the slug cache', () => {
  it('creating a workspace drops this isolate\'s negative entry for its slug', async () => {
    const slugs: Record<string, string> = {};
    const t = makeEnv(slugs);
    expect(await workspaceIdBySlug(t.env, 'fresh')).toBeNull();
    await createWorkspaceForUser(t.env, owner, 'Fresh', { slug: 'fresh' });
    slugs.fresh = WS;
    expect(await workspaceIdBySlug(t.env, 'fresh')).toBe(WS);
    expect(t.d1Lookups()).toBe(2);
  });

  it('renaming drops both the old and the new slug', async () => {
    const t = makeEnv({}, (sql) => {
      if (sql.includes('SELECT role FROM workspace_members')) return { role: 'admin' };
      if (sql === 'SELECT slug FROM workspaces WHERE id = ?') return { slug: 'old' };
      return null;
    });
    t.store.set(workspaceSlugCacheKey('old'), { value: WS });
    t.store.set(workspaceSlugCacheKey('new'), { value: 'wsp_other' });
    const res = await handleUpdateWorkspace(new Request(`https://x.test/v1/workspaces/${WS}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: 'new' }),
    }), t.env, owner, WS);
    expect(res.status).not.toBe(409);
    expect(t.store.has(workspaceSlugCacheKey('old'))).toBe(false);
    expect(t.store.has(workspaceSlugCacheKey('new'))).toBe(false);
  });

  it('an update that leaves the slug alone keeps the cache', async () => {
    const t = makeEnv({}, (sql) => (sql.includes('SELECT role FROM workspace_members') ? { role: 'admin' } : null));
    t.store.set(workspaceSlugCacheKey('acme'), { value: WS });
    await handleUpdateWorkspace(new Request(`https://x.test/v1/workspaces/${WS}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Acme 2' }),
    }), t.env, owner, WS);
    expect(t.store.has(workspaceSlugCacheKey('acme'))).toBe(true);
  });

  it('deleting a workspace drops its slug; the next lookup misses', async () => {
    const slugs: Record<string, string> = { acme: WS };
    const t = makeEnv(slugs, (sql) => {
      if (sql.includes('SELECT role FROM workspace_members')) return { role: 'owner' };
      if (sql.includes('COUNT(*) as count FROM artifacts')) return { count: 0 };
      if (sql === 'SELECT slug FROM workspaces WHERE id = ?') return { slug: 'acme' };
      return null;
    });
    expect(await workspaceIdBySlug(t.env, 'acme')).toBe(WS);
    await tick();
    delete slugs.acme;
    const res = await handleDeleteWorkspace(new Request(`https://x.test/v1/workspaces/${WS}`, { method: 'DELETE' }), t.env, owner, WS);
    expect(res.status).toBe(200);
    expect(t.store.has(workspaceSlugCacheKey('acme'))).toBe(false);
    expect(await workspaceIdBySlug(t.env, 'acme')).toBeNull();
  });
});
