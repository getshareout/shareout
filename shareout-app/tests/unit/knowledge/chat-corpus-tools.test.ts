// Knowledge in the in-app chat: the same corpus the MCP tools read (uploaded Files,
// passages, entities, facts), with per-member visibility and a membership check.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:test';
import type { Env } from '../../../src/types';
import type { ToolContext } from '../../../src/chat-agent/tools/types';

const getUserWorkspaceIds = vi.hoisted(() => vi.fn());
vi.mock('../../../src/chat-agent/scope', async (orig) => ({
  ...(await orig<typeof import('../../../src/chat-agent/scope')>()),
  scopedWorkspaceId: async (c: { env: Env; userId: string; selectedWorkspaceId?: string | null }) => {
    const ws = c.selectedWorkspaceId;
    return typeof ws === 'string' && (await getUserWorkspaceIds(c.env, c.userId)).includes(ws) ? ws : null;
  },
}));

import {
  knowledgeSearchTool, knowledgeEntityTool, knowledgeFactsTool, knowledgeStatusTool,
} from '../../../src/chat-agent/tools/knowledge';
import { queueKnowledgeSource } from '../../../src/knowledge/corpus/ingest';
import { setKnowledgeEnabled } from '../../../src/knowledge';

const base = env as unknown as Env;
const run = Date.now();
const WS = `wsp_kchat_${run}`;
const WS_OFF = `wsp_kchat_off_${run}`;
const MEMBERS: Record<string, string[]> = { usr_ana: [WS, WS_OFF], usr_bo: [WS], usr_cy: [] };

function fakeExtraction(user: string) {
  const out = { entities: [] as object[], relations: [] as object[], facts: [] as object[] };
  user.split(/\n\n(?=\[\d+\])/).forEach((block) => {
    const chunk = Number(/^\[(\d+)\]/.exec(block)?.[1]);
    for (const sentence of block.split(/(?<=\.)\s+(?=[A-Z])|\n/)) {
      for (const name of ['Acme', 'Northwind']) if (sentence.includes(name)) out.entities.push({ chunk, name, type: 'organization', quote: sentence.trim() });
      const fact = /(\w+)'s budget is (\d+k)/.exec(sentence);
      if (fact) out.facts.push({ chunk, entity: fact[1], predicate: 'budget', value: fact[2], unit: 'USD', quote: sentence.trim() });
    }
  });
  return out;
}

const e = {
  ...base,
  AI: {
    run: vi.fn(async (_m: string, input: { text?: string[]; messages?: { role: string; content: string }[] }) => {
      if (input.text) return { data: input.text.map(() => [1, 0, 0]) };
      return { response: fakeExtraction(input.messages!.find((m) => m.role === 'user')!.content), usage: { prompt_tokens: 10, completion_tokens: 5 } };
    }),
  },
} as unknown as Env;

const ctx = (userId: string, ws: string | null = WS) => ({ env: e, userId, selectedWorkspaceId: ws }) as unknown as ToolContext;

async function putFile(id: string, body: string, opts: { owner?: string; visibility?: string } = {}) {
  const blobId = `blob_${id}`;
  await e.ARTIFACTS.put(`test/${blobId}`, body);
  await e.DB.prepare('INSERT INTO asset_deliverables (id, workspace_id, owner_id, name, visibility) VALUES (?, ?, ?, ?, ?)')
    .bind(id, WS, opts.owner ?? 'usr_ana', `${id}.md`, opts.visibility ?? 'workspace').run();
  await e.DB.prepare("INSERT INTO blobs (id, filename, mime_type, r2_key, size_bytes, deliverable_id, version_no) VALUES (?, ?, 'text/markdown', ?, ?, ?, 1)")
    .bind(blobId, `${id}.md`, `test/${blobId}`, body.length, id).run();
  await queueKnowledgeSource(e, undefined, { workspaceId: WS, kind: 'asset', refId: id }, blobId);
}

beforeAll(async () => {
  for (const sql of [
    `CREATE TABLE IF NOT EXISTS knowledge_settings (workspace_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, last_consolidated_at TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS workspace_files (workspace_id TEXT NOT NULL, namespace TEXT NOT NULL, scope_id TEXT NOT NULL DEFAULT '', path TEXT NOT NULL, content TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'manual', updated_by TEXT, updated_by_kind TEXT NOT NULL DEFAULT 'user', created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), PRIMARY KEY (workspace_id, namespace, scope_id, path))`,
    `CREATE TABLE IF NOT EXISTS asset_deliverables (id TEXT PRIMARY KEY, bucket_artifact_id TEXT, workspace_id TEXT, owner_id TEXT NOT NULL, name TEXT NOT NULL, visibility TEXT NOT NULL DEFAULT 'workspace', folder_id TEXT, deleted_at TEXT, type_metadata TEXT)`,
    `CREATE TABLE IF NOT EXISTS blobs (id TEXT PRIMARY KEY, artifact_id TEXT, filename TEXT NOT NULL, mime_type TEXT NOT NULL, r2_key TEXT NOT NULL, size_bytes INTEGER NOT NULL, deliverable_id TEXT, version_no INTEGER)`,
    `CREATE TABLE IF NOT EXISTS ai_usage_events (id TEXT PRIMARY KEY, workspace_id TEXT, user_id TEXT, kind TEXT NOT NULL, model TEXT NOT NULL, units REAL NOT NULL DEFAULT 0, unit_kind TEXT NOT NULL, base_cost_micro_usd INTEGER NOT NULL DEFAULT 0, source TEXT, input_tokens INTEGER, output_tokens INTEGER, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`,
  ]) await e.DB.exec(sql);
  await setKnowledgeEnabled(e, WS, true);
  await putFile('dlv_c1', "# Onboarding procedure\n\nStep 3: call Acme within 48 hours. Acme's budget is 50k.");
  await putFile('dlv_c2', "Northwind's budget is 90k.", { owner: 'usr_bo', visibility: 'private' });
});

beforeEach(() => {
  getUserWorkspaceIds.mockReset().mockImplementation(async (_env: Env, userId: string) => MEMBERS[userId] ?? []);
});

describe('chat knowledge_search', () => {
  it('returns cited passages from uploaded files alongside notes', async () => {
    const r = (await knowledgeSearchTool.execute(ctx('usr_ana'), { query: 'call Acme' })) as {
      passages: { cite: string; text: string; source: { id: string } }[];
    };
    expect(r.passages[0].source.id).toBe('dlv_c1');
    expect(r.passages[0].cite).toContain('Onboarding procedure');
    expect(r.passages[0].text).toContain('48 hours');
  });

  it("never shows another member's private file", async () => {
    const r = (await knowledgeSearchTool.execute(ctx('usr_ana'), { query: 'Northwind budget' })) as { passages: { source: { id: string } }[] };
    expect(r.passages.map((p) => p.source.id)).not.toContain('dlv_c2');
    const bo = (await knowledgeSearchTool.execute(ctx('usr_bo'), { query: 'Northwind budget' })) as { passages: { source: { id: string } }[] };
    expect(bo.passages.map((p) => p.source.id)).toContain('dlv_c2');
  });
});

describe('chat knowledge_entity / knowledge_facts', () => {
  it('looks up an entity and its quoted facts', async () => {
    const ent = (await knowledgeEntityTool.execute(ctx('usr_ana'), { name: 'Acme' })) as { found: boolean; entity: { name: string }; fact_count: number };
    expect(ent).toMatchObject({ found: true, entity: { name: 'Acme' }, fact_count: 1 });
    const f = (await knowledgeFactsTool.execute(ctx('usr_ana'), { about: 'Acme', filter: 'budget' })) as { facts: { value: string; quote: string }[] };
    expect(f.facts[0]).toMatchObject({ value: '50k', quote: "Acme's budget is 50k." });
  });

  it('hides entities known only from a private file', async () => {
    const r = (await knowledgeEntityTool.execute(ctx('usr_ana'), { name: 'Northwind' })) as { found: boolean };
    expect(r.found).toBe(false);
  });
});

describe('chat knowledge_status', () => {
  it('lists only the sources this member may see', async () => {
    const r = (await knowledgeStatusTool.execute(ctx('usr_ana'), {})) as { enabled: boolean; sources: { id: string; status: string }[] };
    expect(r.enabled).toBe(true);
    expect(r.sources.map((s) => s.id)).toEqual(['dlv_c1']);
    expect(r.sources[0].status).toBe('ready');
  });
});

describe('scope', () => {
  it('refuses non-members, personal scope, and workspaces with knowledge off', async () => {
    expect(await knowledgeStatusTool.execute(ctx('usr_cy'), {})).toHaveProperty('error');
    expect(await knowledgeEntityTool.execute(ctx('usr_ana', null), { name: 'Acme' })).toHaveProperty('error');
    expect(await knowledgeFactsTool.execute(ctx('usr_ana', WS_OFF), { about: 'Acme' })).toMatchObject({ enabled: false });
  });
});
