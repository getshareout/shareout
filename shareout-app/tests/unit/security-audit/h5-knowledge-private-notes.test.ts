import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';
import type { ToolContext } from '../../../src/chat-agent/tools/types';

const validateToken = vi.hoisted(() => vi.fn());
const getSessionUser = vi.hoisted(() => vi.fn());
const getInternalWorkspaceRole = vi.hoisted(() => vi.fn());
vi.mock('../../../src/api-auth', () => ({ validateToken }));
vi.mock('../../../src/auth/session', async (importOriginal) => ({ ...(await importOriginal<object>()), getSessionUser }));
vi.mock('../../../src/workspaces/roles', () => ({ getInternalWorkspaceRole }));
vi.mock('../../../src/chat-agent/scope', async (orig) => ({
  ...(await orig<typeof import('../../../src/chat-agent/scope')>()),
  scopedWorkspaceId: async (c: { selectedWorkspaceId?: string | null }) => c.selectedWorkspaceId ?? null,
}));

import { knowledgeSearchTool, knowledgeGetTool } from '../../../src/chat-agent/tools/knowledge';
import { routeKnowledgeApi } from '../../../src/router/api/knowledge';
import { createFetchContext } from '../../../src/router/context';
import { setKnowledgeEnabled, upsertKnowledgeFile } from '../../../src/knowledge';

const e = env as unknown as Env;
const WS = 'wsp_h5_kn';
const execCtx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

const node = (kind: string, id: string, title: string, sources: string[], body: string) =>
  `---\nkind: ${kind}\nid: ${id}\ntitle: ${JSON.stringify(title)}\ntopics: [roadmap]\nentities: []\nsources: [${sources.join(', ')}]\npinned: false\n---\n${body}\n`;

beforeAll(async () => {
  for (const sql of [
    `CREATE TABLE IF NOT EXISTS knowledge_settings (workspace_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, last_consolidated_at TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, name TEXT, slug TEXT, owner_id TEXT, visibility TEXT, workspace_id TEXT, deleted_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS artifact_moderation (artifact_id TEXT PRIMARY KEY, status TEXT)`,
    `CREATE TABLE IF NOT EXISTS workspace_files (workspace_id TEXT NOT NULL, namespace TEXT NOT NULL, scope_id TEXT NOT NULL DEFAULT '', path TEXT NOT NULL, content TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'manual', updated_by TEXT, updated_by_kind TEXT NOT NULL DEFAULT 'user', created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), PRIMARY KEY (workspace_id, namespace, scope_id, path))`,
  ]) await e.DB.exec(sql);
  await setKnowledgeEnabled(e, WS, true);
  for (const [id, vis] of [['pub1', 'workspace'], ['priv1', 'private']]) {
    await e.DB.prepare('INSERT INTO artifacts (id, name, slug, owner_id, visibility, workspace_id) VALUES (?, ?, ?, ?, ?, ?)').bind(id, id, `s-${id}`, 'owner_x', vis, WS).run();
  }
  await upsertKnowledgeFile(e, WS, { path: 'artifacts/priv1.md', content: node('artifact-digest', 'art.priv1', 'Secret roadmap', ['priv1'], 'SECRET-BODY'), source: 'learned' });
  await upsertKnowledgeFile(e, WS, { path: 'artifacts/pub1.md', content: node('artifact-digest', 'art.pub1', 'Public roadmap', ['pub1'], 'PUBLIC-BODY'), source: 'learned' });
  await upsertKnowledgeFile(e, WS, { path: 'topics/mixed.md', content: node('topic', 'topic.mixed', 'Mixed roadmap', ['pub1', 'priv1'], 'MIXED-BODY'), source: 'consolidated' });
  await upsertKnowledgeFile(e, WS, { path: 'topics/pubonly.md', content: node('topic', 'topic.pubonly', 'Pub only roadmap', ['pub1'], 'PUBONLY-BODY'), source: 'consolidated' });
});

const tctx = (userId: string) => ({ env: e, userId, selectedWorkspaceId: WS }) as unknown as ToolContext;

async function route(sub: string, userId: string) {
  validateToken.mockResolvedValue(null);
  getSessionUser.mockResolvedValue({ id: userId, email: `${userId}@example.test` });
  getInternalWorkspaceRole.mockResolvedValue('member');
  const res = await routeKnowledgeApi(createFetchContext(new Request(`https://shareout.site/v1/workspaces/${WS}/knowledge/${sub}`, { headers: { Cookie: 'shareout_session=x' } }), e, execCtx));
  return { status: res!.status, text: await res!.text() };
}

describe('h5 knowledge notes from private pages', () => {
  it('blocks: another member cannot read digests or mixed notes built from a private page', async () => {
    const search = await knowledgeSearchTool.execute(tctx('other'), { query: 'roadmap' }) as { nodes: { path: string }[] };
    const paths = search.nodes.map((n) => n.path);
    expect(paths).toContain('artifacts/pub1.md');
    expect(paths).toContain('topics/pubonly.md');
    expect(paths).not.toContain('artifacts/priv1.md');
    expect(paths).not.toContain('topics/mixed.md');

    for (const p of ['artifacts/priv1.md', 'topics/mixed.md']) {
      expect(await knowledgeGetTool.execute(tctx('other'), { path: p })).toHaveProperty('error');
      expect((await route(`files/${p}`, 'other')).status).toBe(404);
    }
    expect(await knowledgeGetTool.execute(tctx('other'), { path: 'topics/pubonly.md' })).toHaveProperty('node');

    const tree = (await route('tree', 'other')).text;
    expect(tree).not.toContain('Secret roadmap');
    expect(tree).not.toContain('Mixed roadmap');
    expect(tree).toContain('Pub only roadmap');
  });

  it('the owner of the private page still reads it', async () => {
    const r = await knowledgeGetTool.execute(tctx('owner_x'), { path: 'artifacts/priv1.md' });
    expect(r).toHaveProperty('node');
    expect((await route('files/topics/mixed.md', 'owner_x')).status).toBe(200);
  });
});
