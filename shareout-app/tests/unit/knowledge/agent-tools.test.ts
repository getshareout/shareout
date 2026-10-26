import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import type { Env } from '../../../src/types';
import type { ToolContext } from '../../../src/chat-agent/tools/types';

vi.mock('../../../src/chat-agent/scope', async (orig) => ({
  ...(await orig<typeof import('../../../src/chat-agent/scope')>()),
  scopedWorkspaceId: async (c: { selectedWorkspaceId?: string | null }) => (c.selectedWorkspaceId === 'wsp_kn_tools' ? 'wsp_kn_tools' : null),
}));
import { knowledgeSearchTool, knowledgeGetTool } from '../../../src/chat-agent/tools/knowledge';
import { setKnowledgeEnabled, upsertKnowledgeFile } from '../../../src/knowledge';
import { getPlatformOrigin } from '../../../src/config/origins';

const e = env as unknown as Env;
const WS = 'wsp_kn_tools';

function ctx(workspaceId: string | null, override: Partial<Env> = {}): ToolContext {
  return { env: { ...e, ...override }, selectedWorkspaceId: workspaceId, userId: 'u1' } as unknown as ToolContext;
}

const DIGEST = `---
kind: artifact-digest
id: art.doc1
title: Acme Retention
topics: [retention, acme]
entities: [Acme]
sources: [doc1]
learned_at: 2026-07-09T00:00:00.000Z
pinned: false
---
Day-0 retention is 42%.`;

const TOPIC = `---
kind: topic
id: topic.retention
title: Retention
topics: [retention]
sources: [doc1]
pinned: false
---
Retention overview.`;

beforeAll(async () => {
  for (const sql of [
    `CREATE TABLE IF NOT EXISTS knowledge_settings (workspace_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, last_consolidated_at TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, name TEXT, slug TEXT, owner_id TEXT, visibility TEXT, workspace_id TEXT, deleted_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS artifact_moderation (artifact_id TEXT PRIMARY KEY, status TEXT)`,
    `CREATE TABLE IF NOT EXISTS workspace_files (workspace_id TEXT NOT NULL, namespace TEXT NOT NULL, scope_id TEXT NOT NULL DEFAULT '', path TEXT NOT NULL, content TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'manual', updated_by TEXT, updated_by_kind TEXT NOT NULL DEFAULT 'user', created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), PRIMARY KEY (workspace_id, namespace, scope_id, path))`,
  ]) {
    await e.DB.exec(sql);
  }
});

beforeEach(async () => {
  await e.DB.exec('DELETE FROM knowledge_settings');
  await e.DB.exec('DELETE FROM workspace_files');
  await e.DB.exec('DELETE FROM artifacts');
});

async function seed() {
  await setKnowledgeEnabled(e, WS, true);
  await upsertKnowledgeFile(e, WS, { path: 'artifacts/doc1.md', content: DIGEST });
  await upsertKnowledgeFile(e, WS, { path: 'topics/retention.md', content: TOPIC });
}

describe('knowledge_search tool', () => {
  it('reports disabled when knowledge is off', async () => {
    const r = await knowledgeSearchTool.execute(ctx(WS), { query: 'retention' });
    expect(r).toMatchObject({ enabled: false, message: "Knowledge isn't turned on for this workspace." });
  });

  it('requires a workspace', async () => {
    const r = (await knowledgeSearchTool.execute(ctx(null), { query: 'x' })) as { error?: string };
    expect(r).toHaveProperty('error');
  });

  it('substring-matches titles/topics and filters by kind', async () => {
    await seed();
    const all = (await knowledgeSearchTool.execute(ctx(WS), { query: 'retention' })) as { count: number };
    expect(all.count).toBe(2);
    const digests = (await knowledgeSearchTool.execute(ctx(WS), { query: 'retention', kind: 'artifact-digest' })) as {
      count: number;
      nodes: { id: string }[];
    };
    expect(digests.count).toBe(1);
    expect(digests.nodes[0].id).toBe('art.doc1');
  });

  it('merges semantic hits first with a fake Vectorize/AI', async () => {
    await seed();
    const fakeAI = { run: async () => ({ data: [[0.1, 0.2, 0.3]] }) } as unknown as Env['AI'];
    const fakeVectorize = {
      query: async () => ({ matches: [{ id: `kn:${WS}:topics/retention.md` }] }),
    } as unknown as Env['VECTORIZE'];
    const r = (await knowledgeSearchTool.execute(ctx(WS, { AI: fakeAI, VECTORIZE: fakeVectorize }), {
      query: 'how sticky are users',
    })) as { nodes: { path: string }[] };
    expect(r.nodes[0].path).toBe('topics/retention.md');
  });

  it('finds this workspace’s notes behind nearer notes of other workspaces', async () => {
    await seed();
    let topK = 0;
    const fakeAI = { run: async () => ({ data: [[0.1, 0.2, 0.3]] }) } as unknown as Env['AI'];
    const elsewhere = Array.from({ length: 40 }, (_, i) => ({ id: `kn:wsp_other:topics/t${i}.md` }));
    const fakeVectorize = {
      query: async (_v: unknown, o: { topK: number }) => {
        topK = o.topK;
        return { matches: [...elsewhere, { id: `kn:${WS}:topics/retention.md` }].slice(0, o.topK) };
      },
    } as unknown as Env['VECTORIZE'];
    const r = (await knowledgeSearchTool.execute(ctx(WS, { AI: fakeAI, VECTORIZE: fakeVectorize }), {
      query: 'how sticky are users',
    })) as { nodes: { path: string }[] };
    expect(topK).toBe(100);
    expect(r.nodes.map((n) => n.path)).toEqual(['topics/retention.md']);
  });
});

describe('knowledge_get tool', () => {
  it('returns the full node body + sources named by the artifact they came from', async () => {
    await seed();
    await e.DB.prepare('INSERT INTO artifacts (id, name, slug, owner_id, visibility, workspace_id) VALUES (?, ?, ?, ?, ?, ?)')
      .bind('doc1', 'Weekly report', 'weekly-report', 'u1', 'workspace', WS).run();
    const r = (await knowledgeGetTool.execute(ctx(WS), { path: 'artifacts/doc1.md' })) as {
      node: { body: string; sources: unknown[] };
    };
    expect(r.node.body).toContain('Day-0 retention is 42%');
    expect(r.node.sources).toEqual([{ id: 'doc1', slug: 'weekly-report', title: 'Weekly report', url: `${getPlatformOrigin(e)}/a/weekly-report/`, available: true }]);
  });

  it("hides a note learned from someone else's private source", async () => {
    await seed();
    await e.DB.prepare('INSERT INTO artifacts (id, name, slug, owner_id, visibility, workspace_id) VALUES (?, ?, ?, ?, ?, ?)')
      .bind('doc1', 'Secret plan', 'secret-plan', 'u2', 'private', WS).run();
    const r = await knowledgeGetTool.execute(ctx(WS), { path: 'artifacts/doc1.md' });
    expect(r).toHaveProperty('error');
    expect(JSON.stringify(r)).not.toContain('Secret plan');
  });

  it('resolves by id too', async () => {
    await seed();
    const r = (await knowledgeGetTool.execute(ctx(WS), { id: 'topic.retention' })) as {
      node: { title: string };
    };
    expect(r.node.title).toBe('Retention');
  });

  it('errors helpfully on an unknown key', async () => {
    await seed();
    const r = (await knowledgeGetTool.execute(ctx(WS), { id: 'nope' })) as { error?: string };
    expect(r).toHaveProperty('error');
  });
});
