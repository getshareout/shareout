import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:workers';
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

import { routeKnowledgeApi } from '../../../src/router/api/knowledge';
import { createFetchContext } from '../../../src/router/context';
import { setKnowledgeEnabled, upsertKnowledgeFile } from '../../../src/knowledge';
import { getPlatformOrigin } from '../../../src/config/origins';

const e = env as unknown as Env;
const WS = 'wsp_kn_sources';
const execCtx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

const getNode = async () => {
  const res = await routeKnowledgeApi(createFetchContext(
    new Request(`https://shareout.site/v1/workspaces/${WS}/knowledge/files/topics/retention.md`, { headers: { Cookie: 'shareout_session=x' } }),
    e,
    execCtx,
  ));
  expect(res?.status).toBe(200);
  return ((await res!.json()) as { node: { sources: string[]; source_artifacts: unknown[] } }).node;
};

const nodeWith = (sources: string[]) => `---
kind: topic
id: topic.retention
title: Retention
sources: [${sources.join(', ')}]
---
Retention overview.`;

async function addArtifact(id: string, opts: { name: string; slug: string; owner?: string; visibility?: string; ws?: string; deleted?: boolean }) {
  await e.DB.prepare('INSERT INTO artifacts (id, name, slug, owner_id, visibility, workspace_id, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, opts.name, opts.slug, opts.owner ?? 'u1', opts.visibility ?? 'workspace', opts.ws ?? WS, opts.deleted ? '2026-01-01T00:00:00Z' : null)
    .run();
}

beforeAll(async () => {
  for (const sql of [
    `CREATE TABLE IF NOT EXISTS knowledge_settings (workspace_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, last_consolidated_at TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS workspace_files (workspace_id TEXT NOT NULL, namespace TEXT NOT NULL, scope_id TEXT NOT NULL DEFAULT '', path TEXT NOT NULL, content TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'manual', updated_by TEXT, updated_by_kind TEXT NOT NULL DEFAULT 'user', created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), PRIMARY KEY (workspace_id, namespace, scope_id, path))`,
    `CREATE TABLE IF NOT EXISTS knowledge_tombstones (workspace_id TEXT NOT NULL, path TEXT NOT NULL, forgotten_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (workspace_id, path))`,
    `CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, name TEXT, slug TEXT, owner_id TEXT, visibility TEXT, workspace_id TEXT, deleted_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS artifact_moderation (artifact_id TEXT PRIMARY KEY, status TEXT)`,
  ]) {
    await e.DB.exec(sql);
  }
});

beforeEach(async () => {
  validateToken.mockReset().mockResolvedValue(null);
  getSessionUser.mockReset().mockResolvedValue({ id: 'u1', email: 'me@example.com' });
  getInternalWorkspaceRole.mockReset().mockResolvedValue('member');
  for (const t of ['knowledge_settings', 'workspace_files', 'knowledge_tombstones', 'artifacts', 'artifact_moderation']) {
    await e.DB.exec(`DELETE FROM ${t}`);
  }
  await setKnowledgeEnabled(e, WS, true);
});

describe('knowledge node sources', () => {
  it('resolves source ids to the artifact title and slug', async () => {
    await addArtifact('art_one', { name: 'Weekly report', slug: 'weekly-report' });
    await upsertKnowledgeFile(e, WS, { path: 'topics/retention.md', content: nodeWith(['art_one']) });
    const node = await getNode();
    expect(node.sources).toEqual(['art_one']);
    expect(node.source_artifacts).toEqual([{ id: 'art_one', slug: 'weekly-report', title: 'Weekly report', url: `${getPlatformOrigin(e)}/a/weekly-report/`, available: true }]);
  });

  it("hides a note learned from someone else's private artifact, keeps own private sources named", async () => {
    await addArtifact('art_mine', { name: 'My private notes', slug: 'my-notes', visibility: 'private', owner: 'u1' });
    await addArtifact('art_theirs', { name: 'Secret plan', slug: 'secret-plan', visibility: 'private', owner: 'u2' });
    await upsertKnowledgeFile(e, WS, { path: 'topics/retention.md', content: nodeWith(['art_mine']) });
    expect((await getNode()).source_artifacts).toEqual([
      { id: 'art_mine', slug: 'my-notes', title: 'My private notes', url: `${getPlatformOrigin(e)}/a/my-notes/`, available: true },
    ]);
    await upsertKnowledgeFile(e, WS, { path: 'topics/retention.md', content: nodeWith(['art_mine', 'art_theirs']) });
    const res = await routeKnowledgeApi(createFetchContext(
      new Request(`https://shareout.site/v1/workspaces/${WS}/knowledge/files/topics/retention.md`, { headers: { Cookie: 'shareout_session=x' } }), e, execCtx,
    ));
    expect(res?.status).toBe(404);
  });

  it('marks missing and other-workspace artifacts unavailable', async () => {
    await addArtifact('art_other', { name: 'Elsewhere', slug: 'elsewhere', ws: 'wsp_other' });
    await upsertKnowledgeFile(e, WS, { path: 'topics/retention.md', content: nodeWith(['art_missing', 'art_other']) });
    const node = await getNode();
    expect(node.source_artifacts).toEqual([
      { id: 'art_missing', slug: null, title: null, url: null, available: false },
      { id: 'art_other', slug: null, title: null, url: null, available: false },
    ]);
    expect(JSON.stringify(node)).not.toContain('Elsewhere');
  });

  // Until the consolidator rebuilds it without that page, a note may still quote it.
  it('hides a note learned from a page in the trash, from everyone, until it is rebuilt', async () => {
    await addArtifact('art_one', { name: 'Weekly report', slug: 'weekly-report' });
    await addArtifact('art_gone', { name: 'Old page', slug: 'old-page', deleted: true, owner: 'u1' });
    await upsertKnowledgeFile(e, WS, { path: 'topics/retention.md', content: nodeWith(['art_one', 'art_gone']) });
    const res = await routeKnowledgeApi(createFetchContext(
      new Request(`https://shareout.site/v1/workspaces/${WS}/knowledge/files/topics/retention.md`, { headers: { Cookie: 'shareout_session=x' } }), e, execCtx,
    ));
    expect(res?.status).toBe(404);
    expect((await fromArtifact('art_one')).body.notes).toEqual([]);
  });

  it('hides a note learned from a private page with no owner from every member', async () => {
    await addArtifact('art_one', { name: 'Weekly report', slug: 'weekly-report' });
    await e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, visibility, workspace_id) VALUES ('art_ws_private', 'Unowned', 'unowned', NULL, 'private', ?)").bind(WS).run();
    await upsertKnowledgeFile(e, WS, { path: 'topics/retention.md', content: nodeWith(['art_one', 'art_ws_private']) });
    const res = await routeKnowledgeApi(createFetchContext(
      new Request(`https://shareout.site/v1/workspaces/${WS}/knowledge/files/topics/retention.md`, { headers: { Cookie: 'shareout_session=x' } }), e, execCtx,
    ));
    expect(res?.status).toBe(404);
  });

  it('shows at most 50 sources, newest first, while the note keeps them all', async () => {
    const ids = Array.from({ length: 60 }, (_, i) => `art_n${i}`);
    await upsertKnowledgeFile(e, WS, { path: 'topics/retention.md', content: nodeWith(ids) });
    const node = await getNode();
    expect(node.sources).toEqual(ids.slice(0, 50));
    expect(node.source_artifacts).toHaveLength(50);
    expect(((node as unknown as { content: string }).content.match(/art_n/g) ?? []).length).toBe(60);
  });

  it('returns the raw file so pin/edit can PUT it back with its frontmatter', async () => {
    await upsertKnowledgeFile(e, WS, { path: 'topics/retention.md', content: nodeWith([]) });
    const raw = ((await getNode()) as unknown as { content: string }).content;
    expect(raw).toBe(nodeWith([]));
    const put = await routeKnowledgeApi(createFetchContext(
      new Request(`https://shareout.site/v1/workspaces/${WS}/knowledge/files/topics/retention.md`, {
        method: 'PUT', headers: { Cookie: 'shareout_session=x', 'Content-Type': 'text/markdown' }, body: raw.replace(/^---\n/, '---\npinned: true\n'),
      }), e, execCtx,
    ));
    expect(put?.status).toBe(200);
    expect(((await getNode()) as unknown as { pinned: boolean }).pinned).toBe(true);
  });

  it('returns an empty list for a node with no sources', async () => {
    await upsertKnowledgeFile(e, WS, { path: 'topics/retention.md', content: nodeWith([]) });
    expect((await getNode()).source_artifacts).toEqual([]);
  });
});

const noteFrom = (id: string, title: string, sources: string[]) => `---
kind: topic
id: ${id}
title: ${title}
sources: [${sources.join(', ')}]
---
Body.`;

const fromArtifact = async (artifactId: string) => {
  const res = await routeKnowledgeApi(createFetchContext(
    new Request(`https://shareout.site/v1/workspaces/${WS}/knowledge/from/${artifactId}`, { headers: { Cookie: 'shareout_session=x' } }),
    e,
    execCtx,
  ));
  return { status: res!.status, body: (await res!.json()) as { enabled: boolean; notes: { path: string; kind: string; id: string; title: string }[] } };
};

describe('knowledge notes from an artifact (reverse of sources)', () => {
  it("does not list a note that also cites someone else's private page", async () => {
    await addArtifact('art_one', { name: 'Weekly report', slug: 'weekly-report' });
    await addArtifact('art_theirs', { name: 'Secret plan', slug: 'secret-plan', visibility: 'private', owner: 'u2' });
    await upsertKnowledgeFile(e, WS, { path: 'topics/plan.md', content: noteFrom('topic.plan', 'Launch plan', ['art_one', 'art_theirs']) });
    const { body } = await fromArtifact('art_one');
    expect(body.notes).toEqual([]);
    expect(JSON.stringify(body)).not.toContain('Launch plan');
  });

  it('lists only the notes whose sources include the artifact', async () => {
    await addArtifact('art_one', { name: 'Weekly report', slug: 'weekly-report' });
    await upsertKnowledgeFile(e, WS, { path: 'topics/retention.md', content: noteFrom('topic.retention', 'Retention', ['art_one', 'art_two']) });
    await upsertKnowledgeFile(e, WS, { path: 'topics/churn.md', content: noteFrom('topic.churn', 'Churn', ['art_two']) });
    // Mentions the id in the body but not in sources: the instr prefilter must not let it through.
    await upsertKnowledgeFile(e, WS, { path: 'topics/mention.md', content: `${noteFrom('topic.mention', 'Mention', [])}\nSee art_one.` });
    await upsertKnowledgeFile(e, 'wsp_other', { path: 'topics/x.md', content: noteFrom('topic.x', 'Other ws', ['art_one']) });
    const { status, body } = await fromArtifact('art_one');
    expect(status).toBe(200);
    expect(body).toEqual({ enabled: true, notes: [{ path: 'topics/retention.md', kind: 'topic', id: 'topic.retention', title: 'Retention' }] });
  });

  it("returns nothing for someone else's private artifact (no note titles leak)", async () => {
    await addArtifact('art_theirs', { name: 'Secret plan', slug: 'secret-plan', visibility: 'private', owner: 'u2' });
    await upsertKnowledgeFile(e, WS, { path: 'topics/plan.md', content: noteFrom('topic.plan', 'Launch plan', ['art_theirs']) });
    const { body } = await fromArtifact('art_theirs');
    expect(body.notes).toEqual([]);
    expect(JSON.stringify(body)).not.toContain('Launch plan');
    getSessionUser.mockResolvedValue({ id: 'u2', email: 'them@example.com' });
    expect((await fromArtifact('art_theirs')).body.notes.map((n) => n.title)).toEqual(['Launch plan']);
  });

  it('returns nothing for deleted or other-workspace artifacts', async () => {
    await addArtifact('art_gone', { name: 'Old', slug: 'old', deleted: true });
    await addArtifact('art_other', { name: 'Elsewhere', slug: 'elsewhere', ws: 'wsp_other' });
    await upsertKnowledgeFile(e, WS, { path: 'topics/a.md', content: noteFrom('topic.a', 'A', ['art_gone', 'art_other']) });
    expect((await fromArtifact('art_gone')).body.notes).toEqual([]);
    expect((await fromArtifact('art_other')).body.notes).toEqual([]);
  });

  it('answers enabled:false when knowledge is off, and 403 for non-members', async () => {
    await addArtifact('art_one', { name: 'Weekly report', slug: 'weekly-report' });
    await upsertKnowledgeFile(e, WS, { path: 'topics/retention.md', content: noteFrom('topic.retention', 'Retention', ['art_one']) });
    await setKnowledgeEnabled(e, WS, false);
    expect((await fromArtifact('art_one')).body).toEqual({ enabled: false, notes: [] });
    await setKnowledgeEnabled(e, WS, true);
    getInternalWorkspaceRole.mockResolvedValue(null);
    const res = await fromArtifact('art_one');
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain('Retention');
  });
});
