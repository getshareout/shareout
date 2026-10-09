import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:test';
import type { Env } from '../../../src/types';

const validateToken = vi.hoisted(() => vi.fn());
const getSessionUser = vi.hoisted(() => vi.fn());
const getInternalWorkspaceRole = vi.hoisted(() => vi.fn());
vi.mock('../../../src/api-auth', () => ({ validateToken }));
vi.mock('../../../src/auth', () => ({ getSessionUser }));
vi.mock('../../../src/workspaces/roles', () => ({ getInternalWorkspaceRole }));

import { chunkMarkdown, MAX_CHUNKS } from '../../../src/knowledge/corpus/chunk';
import { corpusFor } from '../../../src/knowledge/corpus/client';
import { ftsQuery } from '../../../src/knowledge/corpus/store-do';
import { queueKnowledgeSource } from '../../../src/knowledge/corpus/ingest';
import { searchCorpus } from '../../../src/knowledge/corpus/search';
import { routeKnowledgeApi } from '../../../src/router/api/knowledge';
import { createFetchContext } from '../../../src/router/context';
import { setKnowledgeEnabled } from '../../../src/knowledge';
import { softDeleteArtifact } from '../../../src/artifacts/crud';

const e = env as unknown as Env;
let n = 0;
const nextWs = () => `wsp_corpus_${++n}_${Date.now()}`;

beforeAll(async () => {
  for (const sql of [
    `CREATE TABLE IF NOT EXISTS knowledge_settings (workspace_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, last_consolidated_at TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS asset_deliverables (id TEXT PRIMARY KEY, bucket_artifact_id TEXT, workspace_id TEXT, owner_id TEXT NOT NULL, name TEXT NOT NULL, visibility TEXT NOT NULL DEFAULT 'workspace', folder_id TEXT, deleted_at TEXT, type_metadata TEXT)`,
    `CREATE TABLE IF NOT EXISTS blobs (id TEXT PRIMARY KEY, artifact_id TEXT, filename TEXT NOT NULL, mime_type TEXT NOT NULL, r2_key TEXT NOT NULL, size_bytes INTEGER NOT NULL, deliverable_id TEXT, version_no INTEGER)`,
    `CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, name TEXT, slug TEXT, owner_id TEXT, visibility TEXT, workspace_id TEXT, deleted_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS deployments (artifact_id TEXT NOT NULL, version_id TEXT, channel TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS versions (id TEXT PRIMARY KEY, entrypoint TEXT)`,
    `CREATE TABLE IF NOT EXISTS assets (version_id TEXT, path TEXT, r2_key TEXT, mime TEXT)`,
    `CREATE TABLE IF NOT EXISTS artifact_moderation (artifact_id TEXT PRIMARY KEY, status TEXT)`,
    `CREATE TABLE IF NOT EXISTS knowledge_ingest (workspace_id TEXT NOT NULL, artifact_id TEXT NOT NULL, content_hash TEXT, reason TEXT NOT NULL, queued_at TEXT NOT NULL DEFAULT (datetime('now')), processed_at TEXT, PRIMARY KEY (workspace_id, artifact_id, reason))`,
  ]) {
    await e.DB.exec(sql);
  }
});

beforeEach(() => {
  validateToken.mockReset().mockResolvedValue(null);
  getSessionUser.mockReset().mockResolvedValue({ id: 'u1', email: 'me@example.com' });
  getInternalWorkspaceRole.mockReset().mockResolvedValue('member');
});

async function putFile(ws: string, id: string, text: string, opts: { owner?: string; visibility?: string; filename?: string; mime?: string; version?: number } = {}) {
  const version = opts.version ?? 1;
  const blobId = `blob_${id}_${version}`;
  const key = `test/${blobId}`;
  await e.ARTIFACTS.put(key, text);
  await e.DB.prepare('INSERT OR IGNORE INTO asset_deliverables (id, workspace_id, owner_id, name, visibility) VALUES (?, ?, ?, ?, ?)')
    .bind(id, ws, opts.owner ?? 'u1', `${id}.md`, opts.visibility ?? 'workspace').run();
  await e.DB.prepare('INSERT INTO blobs (id, filename, mime_type, r2_key, size_bytes, deliverable_id, version_no) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(blobId, opts.filename ?? `${id}.md`, opts.mime ?? 'text/markdown', key, text.length, id, version).run();
  await queueKnowledgeSource(e, undefined, { workspaceId: ws, kind: 'asset', refId: id }, blobId);
}

async function putPage(ws: string, id: string, html: string) {
  const ver = `ver_${id}`;
  await e.ARTIFACTS.put(`test/${id}.html`, html);
  await e.DB.batch([
    e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, visibility, workspace_id) VALUES (?, ?, ?, 'u1', 'public', ?)").bind(id, id, id, ws),
    e.DB.prepare("INSERT INTO deployments (artifact_id, version_id, channel) VALUES (?, ?, 'production')").bind(id, ver),
    e.DB.prepare("INSERT INTO versions (id, entrypoint) VALUES (?, 'index.html')").bind(ver),
    e.DB.prepare("INSERT INTO assets (version_id, path, r2_key, mime) VALUES (?, 'index.html', ?, 'text/html')").bind(ver, `test/${id}.html`),
  ]);
  await queueKnowledgeSource(e, undefined, { workspaceId: ws, kind: 'page', refId: id }, ver);
}

describe('chunkMarkdown', () => {
  it('tracks the nearest heading as the locator', () => {
    const chunks = chunkMarkdown('# Contract\n\nIntro text.\n\n## Pricing\n\nFee is 50k.');
    expect(chunks.map((c) => c.locator)).toEqual(['Contract', 'Pricing']);
    expect(chunks[1].text).toContain('Fee is 50k.');
  });

  it('splits long text and caps the chunk count', () => {
    const chunks = chunkMarkdown('word '.repeat(2000));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.text.length <= 1500)).toBe(true);
    expect(chunkMarkdown('x\n\n'.repeat(MAX_CHUNKS * 2).replace(/x/g, 'y'.repeat(1400))).length).toBe(MAX_CHUNKS);
  });
});

describe('ftsQuery', () => {
  it('quotes every word so FTS operators are inert', () => {
    expect(ftsQuery('budget NOT "Q3" OR*')).toBe('"budget" OR "NOT" OR "Q3" OR "OR"');
    expect(ftsQuery('  ¿? ')).toBeNull();
  });
});

describe('corpus ingest + search', () => {
  it('learns a File and returns a cited passage', async () => {
    const ws = nextWs();
    await setKnowledgeEnabled(e, ws, true);
    await putFile(ws, 'dlv_a', '# Acme contract\n\n## Pricing\n\nThe annual fee for Acme is 50,000 dollars.');

    const { counts } = await corpusFor(e, ws)!.listSources(10);
    expect(counts.ready).toBe(1);

    const r = await searchCorpus(e, ws, 'u1', 'annual fee');
    expect(r.mode).toBe('keyword');
    expect(r.hits[0]).toMatchObject({
      locator: 'Pricing',
      source: { kind: 'asset', id: 'dlv_a', title: 'dlv_a.md' },
      cite: 'dlv_a.md — Pricing',
    });
  });

  it('does nothing while Knowledge is off', async () => {
    const ws = nextWs();
    expect(await queueKnowledgeSource(e, undefined, { workspaceId: ws, kind: 'asset', refId: 'dlv_x' }, 'v1')).toBe(false);
  });

  it('hides another member’s private File', async () => {
    const ws = nextWs();
    await setKnowledgeEnabled(e, ws, true);
    await putFile(ws, 'dlv_p', 'Secret salary bands for engineering.', { owner: 'u2', visibility: 'private' });
    expect((await searchCorpus(e, ws, 'u1', 'salary')).hits).toHaveLength(0);
    expect((await searchCorpus(e, ws, 'u2', 'salary')).hits).toHaveLength(1);
  });

  it('replaces a File’s chunks with its new version', async () => {
    const ws = nextWs();
    await setKnowledgeEnabled(e, ws, true);
    await putFile(ws, 'dlv_v', 'Launch is planned for March.');
    await putFile(ws, 'dlv_v', 'Launch moved to June.', { version: 2 });
    expect((await searchCorpus(e, ws, 'u1', 'March')).hits).toHaveLength(0);
    expect((await searchCorpus(e, ws, 'u1', 'June')).hits).toHaveLength(1);
  });

  it('forgets a deleted File', async () => {
    const ws = nextWs();
    await setKnowledgeEnabled(e, ws, true);
    await putFile(ws, 'dlv_d', 'Quarterly churn was 4 percent.');
    await e.DB.prepare('DELETE FROM asset_deliverables WHERE id = ?').bind('dlv_d').run();
    await queueKnowledgeSource(e, undefined, { workspaceId: ws, kind: 'asset', refId: 'dlv_d' }, 'deleted');
    expect(await corpusFor(e, ws)!.getSource('dlv_d')).toBeNull();
    expect((await searchCorpus(e, ws, 'u1', 'churn')).hits).toHaveLength(0);
  });

  it('forgets a page when it is deleted', async () => {
    const ws = nextWs();
    await setKnowledgeEnabled(e, ws, true);
    await putPage(ws, 'art_del', '<html><body><p>Fleet uptime was 97 percent.</p></body></html>');
    expect(await corpusFor(e, ws)!.getSource('art_del')).not.toBeNull();
    await softDeleteArtifact(e, 'art_del', 'art_del');
    expect(await corpusFor(e, ws)!.getSource('art_del')).toBeNull();
    expect((await searchCorpus(e, ws, 'u1', 'fleet uptime')).hits).toHaveLength(0);
  });

  it('marks unreadable files unsupported instead of failing', async () => {
    const ws = nextWs();
    await setKnowledgeEnabled(e, ws, true);
    await putFile(ws, 'dlv_b', 'PK\u0003\u0004binary', { filename: 'blob.bin', mime: 'application/octet-stream' });
    const src = await corpusFor(e, ws)!.getSource('dlv_b');
    expect(src).toMatchObject({ status: 'unsupported' });
    expect(src!.error).toContain("Can't read");
  });

  it('learns a published page and links to it', async () => {
    const ws = nextWs();
    await setKnowledgeEnabled(e, ws, true);
    await e.ARTIFACTS.put('test/page.html', '<html><body><h1>Q3 review</h1><p>Revenue grew 12 percent in Q3.</p></body></html>');
    await e.DB.batch([
      e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, visibility, workspace_id) VALUES ('art_q3', 'Q3 review', 'q3-review', 'u1', 'public', ?)").bind(ws),
      e.DB.prepare("INSERT INTO deployments (artifact_id, version_id, channel) VALUES ('art_q3', 'ver_q3', 'production')"),
      e.DB.prepare("INSERT INTO versions (id, entrypoint) VALUES ('ver_q3', 'index.html')"),
      e.DB.prepare("INSERT INTO assets (version_id, path, r2_key, mime) VALUES ('ver_q3', 'index.html', 'test/page.html', 'text/html')"),
    ]);
    await queueKnowledgeSource(e, undefined, { workspaceId: ws, kind: 'page', refId: 'art_q3' }, 'ver_q3');
    const [hit] = (await searchCorpus(e, ws, 'u1', 'revenue grew')).hits;
    expect(hit.source).toMatchObject({ kind: 'page', id: 'art_q3', title: 'Q3 review' });
    expect(hit.source.url).toMatch(/\/a\/q3-review\/$/);

    await e.DB.prepare("INSERT INTO artifact_moderation (artifact_id, status) VALUES ('art_q3', 'pending')").run();
    expect((await searchCorpus(e, ws, 'u1', 'revenue grew')).hits).toHaveLength(0);
    expect(await corpusFor(e, ws)!.getSource('art_q3')).not.toBeNull();
  });
});

describe('GET /knowledge/search', () => {
  const execCtx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
  const call = (ws: string, qs: string) =>
    routeKnowledgeApi(createFetchContext(
      new Request(`https://shareout.site/v1/workspaces/${ws}/knowledge/search${qs}`, { headers: { Cookie: 'shareout_session=x' } }),
      e, execCtx,
    ));

  it('explains how to turn Knowledge on', async () => {
    const res = await call(nextWs(), '?q=x');
    expect(res!.status).toBe(409);
    expect(await res!.json()).toMatchObject({ code: 'KNOWLEDGE_DISABLED', hint: expect.stringContaining('/knowledge/enable') });
  });

  it('returns JSON hits, or compact markdown for agents', async () => {
    const ws = nextWs();
    await setKnowledgeEnabled(e, ws, true);
    await putFile(ws, 'dlv_r', '## Renewal\n\nRenewal date is 1 May 2027.');

    expect((await call(ws, ''))!.status).toBe(400);

    const json = await (await call(ws, '?q=renewal'))!.json() as { hits: { cite: string }[] };
    expect(json.hits[0].cite).toBe('dlv_r.md — Renewal');

    const md = await call(ws, '?q=renewal&format=md');
    expect(md!.headers.get('Content-Type')).toContain('text/markdown');
    expect(await md!.text()).toContain('[1] dlv_r.md — Renewal (asset dlv_r)');
  });

  it('rejects non-members', async () => {
    getInternalWorkspaceRole.mockResolvedValue(null);
    expect((await call(nextWs(), '?q=x'))!.status).toBe(403);
  });
});

describe('POST /knowledge/backfill (corpus)', () => {
  const execCtx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

  it('queues only Files not already learned at their current version', async () => {
    const ws = nextWs();
    await setKnowledgeEnabled(e, ws, true);
    await putFile(ws, 'dlv_bf1', 'Already learned.');
    await e.ARTIFACTS.put('test/blob_dlv_bf2_1', 'Uploaded before Knowledge was on.');
    await e.DB.batch([
      e.DB.prepare("INSERT INTO asset_deliverables (id, workspace_id, owner_id, name) VALUES ('dlv_bf2', ?, 'u1', 'old.md')").bind(ws),
      e.DB.prepare("INSERT INTO blobs (id, filename, mime_type, r2_key, size_bytes, deliverable_id, version_no) VALUES ('blob_dlv_bf2_1', 'old.md', 'text/markdown', 'test/blob_dlv_bf2_1', 33, 'dlv_bf2', 1)"),
    ]);
    getInternalWorkspaceRole.mockResolvedValue('admin');
    const res = await routeKnowledgeApi(createFetchContext(
      new Request(`https://shareout.site/v1/workspaces/${ws}/knowledge/backfill`, { method: 'POST', headers: { Cookie: 'shareout_session=x' } }),
      e, execCtx,
    ));
    expect(await res!.json()).toMatchObject({ corpus: 1, corpusRemaining: 0 });
  });

  it('forgets stored sources that no longer exist', async () => {
    const ws = nextWs();
    await setKnowledgeEnabled(e, ws, true);
    await putPage(ws, 'art_gone', '<html><body><p>Removed before this fix shipped.</p></body></html>');
    await e.DB.prepare('DELETE FROM artifacts WHERE id = ?').bind('art_gone').run();
    getInternalWorkspaceRole.mockResolvedValue('admin');
    const pending: Promise<unknown>[] = [];
    const waitCtx = { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() {} } as unknown as ExecutionContext;
    const res = await routeKnowledgeApi(createFetchContext(
      new Request(`https://shareout.site/v1/workspaces/${ws}/knowledge/backfill`, { method: 'POST', headers: { Cookie: 'shareout_session=x' } }),
      e, waitCtx,
    ));
    expect(await res!.json()).toMatchObject({ corpus: 1, corpusRemaining: 0 });
    await Promise.allSettled(pending);
    expect(await corpusFor(e, ws)!.getSource('art_gone')).toBeNull();
  });
});
