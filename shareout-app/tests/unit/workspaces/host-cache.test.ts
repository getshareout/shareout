// Subdomain host resolution: workspace slug → id cached in KV (hit, negative hit),
// invalidated by every writer that creates, renames or deletes a workspace.
import { describe, expect, it } from 'vitest';
import { hostWorkspaceId } from '../../../src/pages/home/host';
import { invalidateWorkspaceSlug, workspaceIdBySlug, workspaceSlugCacheKey } from '../../../src/workspaces/host-cache';
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
  return { env, store, d1Lookups: () => sqls.filter((s) => s === 'SELECT id FROM workspaces WHERE slug = ?').length };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('workspace slug → id cache', () => {
  it('a miss reads D1 once and fills KV; the next lookup is a KV hit', async () => {
    const t = makeEnv({ acme: WS });
    expect(await workspaceIdBySlug(t.env, 'acme')).toBe(WS);
    await tick();
    expect(t.store.get(workspaceSlugCacheKey('acme'))).toEqual({ value: WS, ttl: 300 });
    expect(await workspaceIdBySlug(t.env, 'acme')).toBe(WS);
    expect(t.d1Lookups()).toBe(1);
  });

  it('an unknown slug is cached as a short negative entry', async () => {
    const t = makeEnv({});
    expect(await workspaceIdBySlug(t.env, 'nope')).toBeNull();
    await tick();
    expect(t.store.get(workspaceSlugCacheKey('nope'))).toEqual({ value: '-', ttl: 60 });
    expect(await workspaceIdBySlug(t.env, 'nope')).toBeNull();
    expect(t.d1Lookups()).toBe(1);
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
    t.store.set(workspaceSlugCacheKey('b'), { value: '-' });
    await invalidateWorkspaceSlug(t.env, 'a', null, 'b', undefined);
    expect(t.store.size).toBe(0);
  });
});

describe('writers invalidate the slug cache', () => {
  it('creating a workspace drops a negative entry for its slug', async () => {
    const t = makeEnv({});
    t.store.set(workspaceSlugCacheKey('fresh'), { value: '-' });
    await createWorkspaceForUser(t.env, owner, 'Fresh', { slug: 'fresh' });
    expect(t.store.has(workspaceSlugCacheKey('fresh'))).toBe(false);
  });

  it('renaming drops both the old and the new slug', async () => {
    const t = makeEnv({}, (sql) => {
      if (sql.includes('SELECT role FROM workspace_members')) return { role: 'admin' };
      if (sql === 'SELECT slug FROM workspaces WHERE id = ?') return { slug: 'old' };
      return null;
    });
    t.store.set(workspaceSlugCacheKey('old'), { value: WS });
    t.store.set(workspaceSlugCacheKey('new'), { value: '-' });
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
