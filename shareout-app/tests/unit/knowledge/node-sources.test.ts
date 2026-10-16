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
    expect(node.source_artifacts).toEqual([{ id: 'art_one', slug: 'weekly-report', title: 'Weekly report', available: true }]);
  });

  it("does not leak the title of someone else's private artifact", async () => {
    await addArtifact('art_mine', { name: 'My private notes', slug: 'my-notes', visibility: 'private', owner: 'u1' });
    await addArtifact('art_theirs', { name: 'Secret plan', slug: 'secret-plan', visibility: 'private', owner: 'u2' });
    await upsertKnowledgeFile(e, WS, { path: 'topics/retention.md', content: nodeWith(['art_mine', 'art_theirs']) });
    const node = await getNode();
    expect(node.source_artifacts).toEqual([
      { id: 'art_mine', slug: 'my-notes', title: 'My private notes', available: true },
      { id: 'art_theirs', slug: null, title: null, available: false },
    ]);
    expect(JSON.stringify(node)).not.toContain('Secret plan');
    expect(JSON.stringify(node)).not.toContain('secret-plan');
  });

  it('marks deleted, missing and other-workspace artifacts unavailable', async () => {
    await addArtifact('art_gone', { name: 'Old page', slug: 'old-page', deleted: true });
    await addArtifact('art_other', { name: 'Elsewhere', slug: 'elsewhere', ws: 'wsp_other' });
    await upsertKnowledgeFile(e, WS, { path: 'topics/retention.md', content: nodeWith(['art_gone', 'art_missing', 'art_other']) });
    const node = await getNode();
    expect(node.source_artifacts).toEqual([
      { id: 'art_gone', slug: null, title: null, available: false },
      { id: 'art_missing', slug: null, title: null, available: false },
      { id: 'art_other', slug: null, title: null, available: false },
    ]);
    expect(JSON.stringify(node)).not.toContain('Elsewhere');
  });

  it('returns an empty list for a node with no sources', async () => {
    await upsertKnowledgeFile(e, WS, { path: 'topics/retention.md', content: nodeWith([]) });
    expect((await getNode()).source_artifacts).toEqual([]);
  });
});
