import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, it, expect } from 'vitest';
import type { Env } from '../../../src/types';
import type { ToolContext } from '../../../src/chat-agent/tools/types';
import { knowledgeSearchTool, knowledgeGetTool } from '../../../src/chat-agent/tools/knowledge';
import { setKnowledgeEnabled, upsertKnowledgeFile } from '../../../src/knowledge';

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
    `CREATE TABLE IF NOT EXISTS workspace_files (workspace_id TEXT NOT NULL, namespace TEXT NOT NULL, scope_id TEXT NOT NULL DEFAULT '', path TEXT NOT NULL, content TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'manual', updated_by TEXT, updated_by_kind TEXT NOT NULL DEFAULT 'user', created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), PRIMARY KEY (workspace_id, namespace, scope_id, path))`,
  ]) {
    await e.DB.exec(sql);
  }
});

beforeEach(async () => {
  await e.DB.exec('DELETE FROM knowledge_settings');
  await e.DB.exec('DELETE FROM workspace_files');
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
});

describe('knowledge_get tool', () => {
  it('returns the full node body + sources by path', async () => {
    await seed();
    const r = (await knowledgeGetTool.execute(ctx(WS), { path: 'artifacts/doc1.md' })) as {
      node: { body: string; sources: string[] };
    };
    expect(r.node.body).toContain('Day-0 retention is 42%');
    expect(r.node.sources).toContain('doc1');
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
