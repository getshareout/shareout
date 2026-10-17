// vitest-isolate: role / flag helpers keep module-level state.
// Workspace home boot latency guard. Each D1 call is a network round-trip from the
// Worker, so what the viewer waits for is the number of sequential *waves* of queries,
// not the query count. This DB double holds every call until the test releases the whole
// pending set at once; the number of releases is the wave count. (Same double as
// inspector-roundtrips.test.ts.)
import { describe, expect, it } from 'vitest';
import {
  handleHomeActivityFeedApi,
  handleHomeBrowserApi,
  handleHomeForYouApi,
  handleHomeRecentApi,
} from '../../../src/pages/home/api';
import { quickSearch } from '../../../src/search/quick-search';
import { buildSearchIndex } from '../../../src/search/search-index';
import { deepSearch } from '../../../src/search/deep-search';
import { getVisibilityScope } from '../../../src/account-links';
import { handleFetch } from '../../../src/router/handle-fetch';
import { createSessionToken } from '../../../src/token';
import type { Env } from '../../../src/types';

type Row = Record<string, unknown>;
type Handler = (sql: string, args: unknown[]) => Row | Row[] | null;

function wavesDb(handler: Handler) {
  const pending: (() => void)[] = [];
  const calls: string[] = [];
  const later = <T>(v: T) => new Promise<T>((res) => pending.push(() => res(v)));
  const DB = {
    prepare: (sql: string) => {
      const stmt = (args: unknown[]) => ({
        first: () => { calls.push(sql); const r = handler(sql, args); return later(Array.isArray(r) ? (r[0] ?? null) : r); },
        all: () => { calls.push(sql); const r = handler(sql, args); return later({ results: Array.isArray(r) ? r : r ? [r] : [] }); },
        run: () => { calls.push(sql); return later({ success: true, meta: { changes: 1 } }); },
      });
      return { ...stmt([]), bind: (...args: unknown[]) => stmt(args) };
    },
    batch: (stmts: unknown[]) => later(stmts.map(() => ({ success: true }))),
  };
  async function settle<T>(p: Promise<T>): Promise<{ out: T; waves: number }> {
    let done = false;
    let out!: T;
    let err: unknown;
    p.then((v) => { done = true; out = v; }, (e) => { done = true; err = e; });
    let waves = 0;
    for (;;) {
      await new Promise((r) => setTimeout(r, 0));
      if (done) break;
      if (!pending.length) throw new Error('stuck: no pending D1 call');
      waves++;
      pending.splice(0).forEach((f) => f());
    }
    if (err) throw err;
    return { out, waves };
  }
  return { env: { DB, SHAREOUT_BASE_URL: 'https://x.test', SESSION_SECRET: 'test-session-secret' } as unknown as Env, calls, settle };
}

const alice = { id: 'usr_alice', email: 'alice@example.com' };
const WS = 'wsp_acme';
const card = { id: 'art_1', name: 'Q3 report', slug: 'q3', owner_id: alice.id, visibility: 'workspace', artifact_type: 'html', created_at: '2026-01-01T00:00:00.000Z' };

/** acme.x.test resolves to WS; `isMember` toggles alice's membership; `role` her internal role. */
function handler(opts: { isMember: boolean; role?: string; folders?: Row[] }): Handler {
  return (sql) => {
    // Search queries carry visibility in SQL (scope-sql.ts): the double answers them directly.
    if (sql.includes(' AS ok')) return { ok: opts.isMember ? 1 : 0 };
    if (sql.includes('FROM artifacts a') && sql.includes('identity_id IS NOT NULL')) return [card];
    if (sql.includes('FROM users WHERE id = ? OR identity_id')) return [{ id: alice.id, email: alice.email, name: null, picture: null }];
    if (sql.includes('SELECT id FROM workspaces WHERE slug = ?')) return { id: WS };
    if (sql.includes('SELECT 1 FROM workspace_members')) return opts.isMember ? { 1: 1 } : null;
    if (sql.includes("member_class = 'internal'")) return opts.isMember && opts.role ? { role: opts.role } : null;
    if (sql.includes('member_folders_enabled')) return { member_folders_enabled: 1 };
    if (sql.includes('COUNT(DISTINCT a.id)')) return { total: 1 };
    if (sql.includes('FROM folders')) return opts.folders ?? [];
    if (sql.includes('FROM artifacts a')) return [card];
    return null;
  };
}

const req = (path: string) => new Request(`https://acme.x.test${path}`);

describe('GET /v1/home/* boot endpoints — D1 round-trip waves (workspace subdomain)', () => {
  it('activity-feed: at most 3 waves (was 8, then 4): host, scope + role + audiences, sources', async () => {
    const db = wavesDb(handler({ isMember: true, role: 'member' }));
    const { out, waves } = await db.settle(handleHomeActivityFeedApi(req('/v1/home/activity-feed?limit=50&window=7d'), db.env, alice));
    expect(out.status).toBe(200);
    expect(waves).toBeLessThanOrEqual(3);
    // Needs-you and Pulse sources each go out as one batch, not one call per source.
    expect(db.calls.length).toBeLessThanOrEqual(8);
    // The visibility scope is resolved once per request, not once per helper.
    expect(db.calls.filter((s) => s.includes('identity_id')).length).toBe(1);
  });

  it('for-you: at most 3 waves (was 7)', async () => {
    const db = wavesDb(handler({ isMember: true, role: 'member' }));
    const { out, waves } = await db.settle(handleHomeForYouApi(req('/v1/home/for-you?limit=12'), db.env, alice));
    expect(out.status).toBe(200);
    expect(((await out.json()) as { count: number }).count).toBe(1);
    expect(waves).toBeLessThanOrEqual(3);
  });

  it('recent: at most 3 waves (was 7)', async () => {
    const db = wavesDb(handler({ isMember: true, role: 'member' }));
    const { out, waves } = await db.settle(handleHomeRecentApi(req('/v1/home/recent?limit=8'), db.env, alice));
    expect(out.status).toBe(200);
    expect(waves).toBeLessThanOrEqual(3);
  });

  it('browser (root): at most 3 waves (was 12)', async () => {
    const db = wavesDb(handler({ isMember: true, role: 'member', folders: [{ id: 'fld_1', name: 'Reports', created_by: alice.id, artifact_count: 0 }] }));
    const { out, waves } = await db.settle(handleHomeBrowserApi(req('/v1/home/browser?sort=recent'), db.env, alice));
    expect(out.status).toBe(200);
    const body = (await out.json()) as { total: number; canManageFolders: boolean; foldersHtml: string };
    expect(body.total).toBe(1);
    expect(body.canManageFolders).toBe(true);
    expect(body.foldersHtml).toContain('fld_1');
    expect(waves).toBeLessThanOrEqual(3);
  });

  it('browser (inside a folder, member creator): at most 4 waves (was 16)', async () => {
    const db = wavesDb((sql, args) => {
      if (sql.includes('SELECT created_by FROM folders')) return { created_by: alice.id };
      if (sql.includes('readme')) return { readme: '# Guide' };
      return handler({ isMember: true, role: 'member' })(sql, args);
    });
    const { out, waves } = await db.settle(handleHomeBrowserApi(req('/v1/home/browser?sort=recent&folder=fld_1'), db.env, alice));
    expect(out.status).toBe(200);
    const body = (await out.json()) as { canEditFolder: boolean; folderReadme: string | null };
    expect(body.canEditFolder).toBe(true);
    expect(waves).toBeLessThanOrEqual(4);
  });

  // Visibility rides inside the SQL (scope-sql.ts), so search needs no scope/workspace
  // lookups first: one wave on the apex and in a workspace (was 3 and 2).
  for (const ws of [undefined, WS]) {
    it(`quick-search ${ws ? 'in a workspace' : 'on the apex'}: one wave`, async () => {
      const db = wavesDb(handler({ isMember: true }));
      const { waves } = await db.settle(quickSearch(db.env, alice.id, { q: 'q3', workspaceId: ws }));
      expect(waves).toBe(1);
    });
    it(`search index ${ws ? 'in a workspace' : 'on the apex'}: one wave`, async () => {
      const db = wavesDb(handler({ isMember: true }));
      const { waves } = await db.settle(buildSearchIndex(db.env, alice.id, ws));
      expect(waves).toBe(1);
    });
  }

  it('deep search (no Knowledge): one wave', async () => {
    const db = wavesDb(handler({ isMember: true }));
    const { out, waves } = await db.settle(deepSearch(db.env, alice.id, { q: 'q3', workspaceId: WS }));
    expect(waves).toBe(1);
    expect(out.content.map((h) => h.id)).toEqual(['art_1']);
  });
});

// Prod steady state: the host mapping (and, for members, the internal role) are KV hits.
describe('warm host cache (slug → id in KV)', () => {
  const warm = (db: ReturnType<typeof wavesDb>, role?: string) => {
    const kv = new Map([['wsslug:acme', WS], ...(role ? [[`wsintrole:${WS}:${alice.id}`, role] as [string, string]] : [])]);
    (db.env as { SLUGS?: unknown }).SLUGS = {
      get: async (k: string) => kv.get(k) ?? null,
      put: async (k: string, v: string) => { kv.set(k, v); },
      delete: async (k: string) => { kv.delete(k); },
    };
    return db;
  };

  for (const [name, fn, path, max] of [
    ['activity-feed', handleHomeActivityFeedApi, '/v1/home/activity-feed?limit=50&window=7d', 2],
    ['recent', handleHomeRecentApi, '/v1/home/recent?limit=8', 2],
    ['for-you', handleHomeForYouApi, '/v1/home/for-you?limit=12', 2],
  ] as const) {
    it(`${name}: the host lookup costs no D1 wave (at most ${max})`, async () => {
      const db = warm(wavesDb(handler({ isMember: true, role: 'member' })), 'member');
      const { out, waves } = await db.settle(fn(req(path), db.env, alice));
      expect(out.status).toBe(200);
      expect(db.calls.some((s) => s.includes('FROM workspaces WHERE slug'))).toBe(false);
      expect(waves).toBeLessThanOrEqual(max);
    });
  }

  it('activity-feed: a linked-account member (no internal role for the session user) still gets in', async () => {
    const db = warm(wavesDb(handler({ isMember: true })));
    const { out } = await db.settle(handleHomeActivityFeedApi(req('/v1/home/activity-feed'), db.env, alice));
    expect(out.status).toBe(200);
    expect(db.calls.some((s) => s.includes('SELECT 1 FROM workspace_members'))).toBe(true);
  });

  it('activity-feed: an internal role skips the separate membership query', async () => {
    const db = warm(wavesDb(handler({ isMember: true, role: 'member' })), 'member');
    await db.settle(handleHomeActivityFeedApi(req('/v1/home/activity-feed'), db.env, alice));
    expect(db.calls.some((s) => s.includes('SELECT 1 FROM workspace_members'))).toBe(false);
  });
});

describe('authz is unchanged', () => {
  for (const [name, fn, path] of [
    ['activity-feed', handleHomeActivityFeedApi, '/v1/home/activity-feed'],
    ['for-you', handleHomeForYouApi, '/v1/home/for-you'],
    ['recent', handleHomeRecentApi, '/v1/home/recent'],
  ] as const) {
    it(`${name}: a non-member of the host workspace gets 403`, async () => {
      const db = wavesDb(handler({ isMember: false }));
      const { out } = await db.settle(fn(req(path), db.env, alice));
      expect(out.status).toBe(403);
      // No artifact rows were read for the forbidden workspace.
      expect(db.calls.some((s) => s.includes('FROM artifacts a'))).toBe(false);
    });

    it(`${name}: a non-member naming a workspace on the apex gets 403`, async () => {
      const db = wavesDb(handler({ isMember: false }));
      const { out } = await db.settle(fn(new Request(`https://x.test${path}?workspace=${WS}`), db.env, alice));
      expect(out.status).toBe(403);
    });
  }

  it('browser: a non-member sees no artifacts, no folders and cannot manage folders', async () => {
    const db = wavesDb(handler({ isMember: false, folders: [{ id: 'fld_1', name: 'Secret', created_by: 'usr_x' }] }));
    const { out } = await db.settle(handleHomeBrowserApi(req('/v1/home/browser?sort=recent&folder=fld_1'), db.env, alice));
    const body = (await out.json()) as { total: number; cardsHtml: string; foldersHtml: string; canManageFolders: boolean; folderAccess: unknown };
    expect(body.total).toBe(0);
    expect(body.cardsHtml).toBe('');
    expect(body.foldersHtml).toBe('');
    expect(body.canManageFolders).toBe(false);
    expect(body.folderAccess).toBeNull();
  });

  it('browser: a member who did not create the open folder cannot edit it', async () => {
    const db = wavesDb((sql, args) => {
      if (sql.includes('SELECT created_by FROM folders')) return { created_by: 'usr_bob' };
      return handler({ isMember: true, role: 'member' })(sql, args);
    });
    const { out } = await db.settle(handleHomeBrowserApi(req('/v1/home/browser?folder=fld_1'), db.env, alice));
    expect(((await out.json()) as { canEditFolder: boolean }).canEditFolder).toBe(false);
  });
});

describe('linked-account scope', () => {
  it('is one D1 round trip and keeps the session user and email in the scope', async () => {
    const db = wavesDb((sql) => sql.includes('identity_id')
      ? [{ id: alice.id, email: alice.email, name: null, picture: null }, { id: 'usr_alice2', email: 'alice@work.example.com', name: null, picture: null }]
      : null);
    const { out, waves } = await db.settle(getVisibilityScope(db.env, alice));
    expect(waves).toBe(1);
    expect(out).toEqual({ userIds: [alice.id, 'usr_alice2'], emails: [alice.email, 'alice@work.example.com'] });
  });
});

// Perf budget through the real router: session + host + handler, i.e. every D1 wave the
// viewer waits for before the response. The Server-Timing header reports the same count.
describe('perf budget: D1 waves per request through the router (workspace subdomain)', () => {
  const routed = async (db: ReturnType<typeof wavesDb>, path: string) => {
    const cookie = `shareout_session=${await createSessionToken(alice.id, alice.email, db.env)}`;
    return handleFetch(new Request(`https://acme.x.test${path}`, { headers: { Cookie: cookie } }), db.env);
  };
  for (const [path, max] of [
    ['/v1/home/activity-feed?limit=50&window=7d', 4],
    ['/v1/home/for-you?limit=12', 4],
    ['/v1/home/recent?limit=8', 4],
    ['/v1/home/browser?sort=recent', 4],
    // Session + host + one search wave.
    ['/v1/home/quick-search?q=q3', 3],
    ['/v1/home/search-index', 3],
    ['/v1/home/deep-search?q=q3', 3],
  ] as const) {
    it(`${path.split('?')[0]}: at most ${max} waves`, async () => {
      const db = wavesDb(handler({ isMember: true, role: 'member' }));
      const { out, waves } = await db.settle(routed(db, path));
      expect(out.status).toBe(200);
      expect(waves).toBeLessThanOrEqual(max);
      expect(out.headers.get('Server-Timing')).toContain(`waves`);
    });
  }

  it('/v1/home/search-index reports its build and ETag time in Server-Timing', async () => {
    const db = wavesDb(handler({ isMember: true, role: 'member' }));
    const { out } = await db.settle(routed(db, '/v1/home/search-index'));
    expect(out.headers.get('Server-Timing')).toMatch(/idx_build;dur=\d+.*idx_etag;dur=\d+/);
    expect(out.headers.get('ETag')).toMatch(/^W\//);
  });

  it('/home: one wave before the first byte, at most 4 more for the body', async () => {
    const db = wavesDb((sql, args) => (sql.includes('AS n FROM users') ? { n: 1 } : handler({ isMember: true, role: 'member' })(sql, args)));
    const { out, waves } = await db.settle(routed(db, '/home'));
    expect(out.status).toBe(200);
    expect(waves).toBeLessThanOrEqual(1);
    expect(out.headers.get('Server-Timing')).toMatch(/auth;dur=\d+.*d1;desc="\d+ calls, \d+ waves"/);
    const body = await db.settle(out.text());
    expect(body.waves).toBeLessThanOrEqual(4);
  });
});

