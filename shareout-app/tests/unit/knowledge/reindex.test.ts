// Corpus reindex: POST …/knowledge/reindex re-chunks unchanged versions (admins and
// instance admins only, once per 10 minutes), GET …/knowledge/status reports each
// source, and the nightly refresh re-learns sources from an older chunker within caps.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:test';
import type { Env } from '../../../src/types';

const validateToken = vi.hoisted(() => vi.fn());
const getSessionUser = vi.hoisted(() => vi.fn());
const getInternalWorkspaceRole = vi.hoisted(() => vi.fn());
vi.mock('../../../src/api-auth', () => ({ validateToken }));
vi.mock('../../../src/auth/session', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getSessionUser,
}));
vi.mock('../../../src/workspaces/roles', () => ({ getInternalWorkspaceRole }));

import { corpusFor } from '../../../src/knowledge/corpus/client';
import { queueKnowledgeSource } from '../../../src/knowledge/corpus/ingest';
import { runCorpusRefresh, type CorpusStatus } from '../../../src/knowledge/corpus/reindex';
import { CHUNKER_VERSION } from '../../../src/knowledge/corpus/sections';
import { routeKnowledgeApi } from '../../../src/router/api/knowledge';
import { createFetchContext } from '../../../src/router/context';
import { setKnowledgeEnabled } from '../../../src/knowledge';

const e = { ...(env as unknown as Env), INSTANCE_ADMIN_EMAILS: 'root@example.com' } as Env;
let n = 0;
const nextWs = () => `wsp_reindex_${++n}_${Date.now()}`;

beforeAll(async () => {
  for (const sql of [
    `CREATE TABLE IF NOT EXISTS knowledge_settings (workspace_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, last_consolidated_at TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS asset_deliverables (id TEXT PRIMARY KEY, bucket_artifact_id TEXT, workspace_id TEXT, owner_id TEXT NOT NULL, name TEXT NOT NULL, visibility TEXT NOT NULL DEFAULT 'workspace', folder_id TEXT, deleted_at TEXT, type_metadata TEXT)`,
    `CREATE TABLE IF NOT EXISTS blobs (id TEXT PRIMARY KEY, artifact_id TEXT, filename TEXT NOT NULL, mime_type TEXT NOT NULL, r2_key TEXT NOT NULL, size_bytes INTEGER NOT NULL, deliverable_id TEXT, version_no INTEGER)`,
    `CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, name TEXT, slug TEXT, owner_id TEXT, visibility TEXT, workspace_id TEXT, deleted_at TEXT, type_metadata TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS deployments (artifact_id TEXT NOT NULL, version_id TEXT, channel TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS versions (id TEXT PRIMARY KEY, entrypoint TEXT)`,
    `CREATE TABLE IF NOT EXISTS assets (version_id TEXT, path TEXT, r2_key TEXT, mime TEXT, size_bytes INTEGER)`,
    `CREATE TABLE IF NOT EXISTS artifact_moderation (artifact_id TEXT PRIMARY KEY, status TEXT)`,
    `CREATE TABLE IF NOT EXISTS knowledge_ingest (workspace_id TEXT NOT NULL, artifact_id TEXT NOT NULL, content_hash TEXT, reason TEXT NOT NULL, queued_at TEXT NOT NULL DEFAULT (datetime('now')), processed_at TEXT, PRIMARY KEY (workspace_id, artifact_id, reason))`,
  ]) {
    await e.DB.exec(sql);
  }
});

beforeEach(() => {
  validateToken.mockReset().mockResolvedValue(null);
  getSessionUser.mockReset().mockResolvedValue({ id: 'u1', email: 'me@example.com' });
  getInternalWorkspaceRole.mockReset().mockResolvedValue('admin');
});

const asUser = (id: string, email: string, role: string | null) => {
  getSessionUser.mockResolvedValue({ id, email });
  getInternalWorkspaceRole.mockResolvedValue(role);
};

const PAGE = (title: string, body: string) => `<html><head><title>${title}</title></head><body>${body}</body></html>`;

/** A published multi-page site, written to D1/R2 but not learned yet. */
async function putSite(ws: string, id: string, opts: { owner?: string; visibility?: string } = {}) {
  const ver = `ver_${id}`;
  const pages: Record<string, string> = {
    'index.html': PAGE('Procedures', '<h1 id="intro">Procedures</h1><p>Index of every procedure.</p>'),
    'waste.html': PAGE('Waste', '<h2 id="classify">3.2 Waste classification</h2><p>Separate hazardous waste first.</p>'),
    'safety.html': PAGE('Safety', '<h2 id="ppe">4.1 Protective equipment</h2><p>Gloves are required in the lab.</p>'),
  };
  const stmts = [
    e.DB.prepare('INSERT INTO artifacts (id, name, slug, owner_id, visibility, workspace_id) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, id, id, opts.owner ?? 'u1', opts.visibility ?? 'workspace', ws),
    e.DB.prepare("INSERT INTO deployments (artifact_id, version_id, channel) VALUES (?, ?, 'production')").bind(id, ver),
    e.DB.prepare("INSERT INTO versions (id, entrypoint) VALUES (?, 'index.html')").bind(ver),
  ];
  for (const [path, html] of Object.entries(pages)) {
    const key = `test/${id}/${path}`;
    await e.ARTIFACTS.put(key, html);
    stmts.push(e.DB.prepare("INSERT INTO assets (version_id, path, r2_key, mime) VALUES (?, ?, ?, 'text/html')").bind(ver, path, key));
  }
  await e.DB.batch(stmts);
  return ver;
}

/** A source as an older deploy left it: entrypoint-only chunks, no page/anchor, chunker 0. */
async function putOldChunks(ws: string, id: string, ver: string) {
  const store = corpusFor(e, ws)!;
  const meta = { refId: id, kind: 'page' as const, version: ver, title: id, ownerId: 'u1' };
  await store.replaceChunks(meta, [{ ord: 0, locator: 'Procedures', text: 'Index of every procedure.' }]);
  await store.setStatus(meta, 'ready');
}

const req = (ws: string, sub: string, init: RequestInit = {}) => {
  const pending: Promise<unknown>[] = [];
  const execCtx = { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() {} } as unknown as ExecutionContext;
  const res = routeKnowledgeApi(createFetchContext(
    new Request(`https://shareout.site/v1/workspaces/${ws}/knowledge/${sub}`, { ...init, headers: { Cookie: 'shareout_session=x', ...(init.headers || {}) } }),
    e, execCtx,
  ));
  return { res: res.then((r) => r!), settled: () => Promise.allSettled(pending) };
};
const reindex = (ws: string, body?: unknown) =>
  req(ws, 'reindex', { method: 'POST', ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}) });
const status = async (ws: string) => ((await (await req(ws, 'status').res).json()) as { corpus: CorpusStatus }).corpus;

describe('POST /knowledge/reindex — authz', () => {
  it('refuses a plain member', async () => {
    const ws = nextWs();
    await setKnowledgeEnabled(e, ws, true);
    asUser('u2', 'member@example.com', 'member');
    const { res } = reindex(ws);
    expect((await res).status).toBe(403);
  });

  it('refuses a non-member, for reindex and status', async () => {
    const ws = nextWs();
    await setKnowledgeEnabled(e, ws, true);
    asUser('u9', 'stranger@example.com', null);
    expect((await reindex(ws).res).status).toBe(403);
    expect((await req(ws, 'status').res).status).toBe(403);
  });

  it('lets an instance admin who is not a member reindex and see every source', async () => {
    const ws = nextWs();
    await setKnowledgeEnabled(e, ws, true);
    await putSite(ws, 'art_sa_priv', { owner: 'u7', visibility: 'private' });
    asUser('root', 'root@example.com', null);
    const r = reindex(ws);
    const res = await r.res;
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ queued: 1, remaining: 0 });
    await r.settled();
    const c = await status(ws);
    expect(c.sources.map((s) => s.id)).toEqual(['art_sa_priv']);
  });

  it('a workspace agent token never counts as an instance admin', async () => {
    const ws = nextWs();
    await setKnowledgeEnabled(e, ws, true);
    getSessionUser.mockResolvedValue(null);
    validateToken.mockResolvedValue({ id: 'root', email: 'root@example.com', username: null, service: { scopes: [] } });
    getInternalWorkspaceRole.mockResolvedValue(null);
    expect((await reindex(ws).res).status).toBe(403);
  });

  it('409s while Knowledge is off and 400s on a bad body', async () => {
    const off = nextWs();
    expect((await reindex(off).res).status).toBe(409);
    const ws = nextWs();
    await setKnowledgeEnabled(e, ws, true);
    expect((await reindex(ws, { artifactIds: 'art_x' }).res).status).toBe(400);
    expect((await reindex(ws, { artifactIds: [] }).res).status).toBe(400);
  });
});

describe('POST /knowledge/reindex — force + rate limit', () => {
  it('re-chunks an unchanged version that backfill skips: chunks gain page + anchor', async () => {
    const ws = nextWs();
    await setKnowledgeEnabled(e, ws, true);
    const ver = await putSite(ws, 'art_site');
    await putOldChunks(ws, 'art_site', ver);

    // Same version already "learned": the normal backfill leaves it alone.
    const bf = await req(ws, 'backfill', { method: 'POST' }).res;
    expect(await bf.json()).toMatchObject({ corpus: 0 });

    let c = await status(ws);
    expect(c.sources[0]).toMatchObject({ id: 'art_site', status: 'ready', chunks: 1, chunks_with_page: 0, chunks_with_anchor: 0, chunker_version: 0, outdated: true });

    const r = reindex(ws);
    expect(await (await r.res).json()).toMatchObject({ queued: 1 });
    await r.settled();

    c = await status(ws);
    expect(c.sources[0]).toMatchObject({ id: 'art_site', status: 'ready', version: ver, chunks: 3, chunks_with_page: 2, chunks_with_anchor: 3, chunker_version: CHUNKER_VERSION, outdated: false, error: null });
    expect(c.last_reindex_at).toMatch(/^\d{4}-/);
  });

  it('only the listed artifactIds, and says which ids were not eligible', async () => {
    const ws = nextWs();
    await setKnowledgeEnabled(e, ws, true);
    await putSite(ws, 'art_one');
    await putSite(ws, 'art_two');
    await putSite(ws, 'art_held');
    await e.DB.prepare("INSERT INTO artifact_moderation (artifact_id, status) VALUES ('art_held', 'pending')").run();
    const r = reindex(ws, { artifactIds: ['art_one', 'art_held', 'art_nope'] });
    expect(await (await r.res).json()).toMatchObject({ queued: 1, skipped: ['art_held', 'art_nope'] });
    await r.settled();
    expect((await status(ws)).sources.map((s) => s.id)).toEqual(['art_one']);
  });

  it('allows one reindex per workspace per 10 minutes', async () => {
    const ws = nextWs();
    await setKnowledgeEnabled(e, ws, true);
    expect((await reindex(ws).res).status).toBe(202);
    const again = await reindex(ws).res;
    expect(again.status).toBe(429);
    expect(Number(again.headers.get('Retry-After'))).toBeGreaterThan(590);
    expect(await again.json()).toMatchObject({ code: 'RATE_LIMITED' });
    // Another workspace is not affected.
    const other = nextWs();
    await setKnowledgeEnabled(e, other, true);
    expect((await reindex(other).res).status).toBe(202);
  });
});

describe('GET /knowledge/status — corpus', () => {
  it('counts by status; members only see sources they may open', async () => {
    const ws = nextWs();
    await setKnowledgeEnabled(e, ws, true);
    await putSite(ws, 'art_pub');
    await putSite(ws, 'art_priv', { owner: 'u7', visibility: 'private' });
    await queueKnowledgeSource(e, undefined, { workspaceId: ws, kind: 'page', refId: 'art_pub' }, 'ver_art_pub');
    await queueKnowledgeSource(e, undefined, { workspaceId: ws, kind: 'page', refId: 'art_priv' }, 'ver_art_priv');
    const store = corpusFor(e, ws)!;
    await store.setStatus({ refId: 'art_priv', kind: 'page', version: 'ver_art_priv', title: 'art_priv', ownerId: 'u7' }, 'failed', 'boom');

    const admin = await status(ws);
    expect(admin.counts).toEqual({ ready: 1, failed: 1, queued: 0, unsupported: 0 });
    expect(admin.sources.find((s) => s.id === 'art_priv')).toMatchObject({ status: 'failed', error: 'boom' });

    asUser('u2', 'member@example.com', 'member');
    const member = await status(ws);
    expect(member.counts).toEqual({ ready: 1, failed: 0, queued: 0, unsupported: 0 });
    expect(member.sources.map((s) => s.id)).toEqual(['art_pub']);
    expect(member.sources[0]).toMatchObject({ chunks: 3, chunks_with_page: 2, chunks_with_anchor: 3 });
  });
});

describe('nightly corpus refresh', () => {
  const only = async (...ws: string[]) => {
    await e.DB.prepare('UPDATE knowledge_settings SET enabled = 0').run();
    for (const w of ws) await setKnowledgeEnabled(e, w, true);
  };

  it('re-learns an outdated chunker version and skips up-to-date sources', async () => {
    const ws = nextWs();
    await only(ws);
    const oldVer = await putSite(ws, 'art_old');
    await putOldChunks(ws, 'art_old', oldVer);
    await putSite(ws, 'art_new');
    await queueKnowledgeSource(e, undefined, { workspaceId: ws, kind: 'page', refId: 'art_new' }, 'ver_art_new');
    const before = (await status(ws)).sources.find((s) => s.id === 'art_new')!.updated_at;

    expect(await runCorpusRefresh(e)).toMatchObject({ workspaces: 1, queued: 1, outdated: 1 });
    const c = await status(ws);
    expect(c.sources.find((s) => s.id === 'art_old')).toMatchObject({ chunker_version: CHUNKER_VERSION, chunks_with_anchor: 3 });
    expect(c.sources.find((s) => s.id === 'art_new')!.updated_at).toBe(before);

    // Nothing left to do the next night.
    expect(await runCorpusRefresh(e)).toMatchObject({ queued: 0 });
  });

  it('respects the per-workspace and per-run caps', async () => {
    const a = nextWs();
    const b = nextWs();
    await only(a, b);
    for (const ws of [a, b]) {
      for (const i of [1, 2, 3]) {
        const id = `art_cap_${ws}_${i}`;
        await putOldChunks(ws, id, await putSite(ws, id));
      }
    }
    const r = await runCorpusRefresh(e, { perWorkspace: 2, perRun: 3 });
    expect(r).toMatchObject({ queued: 3, workspaces: 2 });
    const outdated = async (ws: string) => (await status(ws)).sources.filter((s) => s.outdated).length;
    expect((await outdated(a)) + (await outdated(b))).toBe(3);
    expect(Math.min(await outdated(a), await outdated(b))).toBeGreaterThanOrEqual(1);
  });

  it('retries a failed source only after its backoff', async () => {
    const ws = nextWs();
    await only(ws);
    await putSite(ws, 'art_fail');
    const store = corpusFor(e, ws)!;
    await store.setStatus({ refId: 'art_fail', kind: 'page', version: 'ver_art_fail', title: 'art_fail', ownerId: 'u1' }, 'failed', 'boom', CHUNKER_VERSION);
    expect(await runCorpusRefresh(e)).toMatchObject({ queued: 0 });
    expect(await store.staleSources(CHUNKER_VERSION, 10, 5)).toEqual([]);
  });
});
