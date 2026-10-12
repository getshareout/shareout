// Knowledge over MCP: each tool runs the real Knowledge routes and store against learned
// Files, answers with citations, and a token for one workspace never sees another's.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:test';
import type { Env } from '../../../src/types';

const MEMBERS: Record<string, Record<string, 'owner' | 'member'>> = {};
const TOKENS: Record<string, string> = { so_ana: 'usr_ana', so_bo: 'usr_bo' };
const NAMES: Record<string, string> = {};

vi.mock('../../../src/api-auth', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  validateToken: vi.fn(async (req: Request) => {
    const id = TOKENS[(req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/, '')];
    return id ? { id, email: `${id}@example.com`, username: null } : null;
  }),
}));
const getInternalWorkspaceRole = vi.hoisted(() => vi.fn());
vi.mock('../../../src/workspaces/roles', () => ({ getInternalWorkspaceRole }));
const listWorkspacesForUser = vi.hoisted(() => vi.fn());
vi.mock('../../../src/chat-agent/access', () => ({ listWorkspacesForUser }));

import { callTool, listTools } from '../../../src/mcp/tools';
import { queueKnowledgeSource } from '../../../src/knowledge/corpus/ingest';
import { setKnowledgeEnabled } from '../../../src/knowledge';

const base = env as unknown as Env;
const run = Date.now();
const WS_A = `wsp_kmcp_a_${run}`;
const WS_B = `wsp_kmcp_b_${run}`;
const WS_OFF = `wsp_kmcp_off_${run}`;

// Stand-in for the extraction model: known names become entities, "X is a client of Y"
// a relation, "X's budget is N" a fact — each quoting its sentence.
const KNOWN = ['Acme', 'Northwind', 'Contoso'];
function fakeExtraction(user: string) {
  const out = { entities: [] as object[], relations: [] as object[], facts: [] as object[] };
  user.split(/\n\n(?=\[\d+\])/).forEach((block) => {
    const chunk = Number(/^\[(\d+)\]/.exec(block)?.[1]);
    for (const sentence of block.split(/(?<=\.)\s+(?=[A-Z])|\n/)) {
      for (const name of KNOWN) if (sentence.includes(name)) out.entities.push({ chunk, name, type: 'organization', quote: sentence.trim() });
      const rel = /(\w+) is a client of (\w+)/.exec(sentence);
      if (rel) out.relations.push({ chunk, from: rel[1], type: 'client of', to: rel[2], quote: sentence.trim() });
      const fact = /(\w+)'s budget is (\d+k)/.exec(sentence);
      if (fact) out.facts.push({ chunk, entity: fact[1], predicate: 'budget', value: fact[2], unit: 'USD', valid_from: '2026-01-01', quote: sentence.trim() });
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

const ctxFor = (token: string) => ({
  env: e, user: { id: TOKENS[token], email: `${TOKENS[token]}@example.com`, username: null }, origin: 'https://shareout.test', authorization: `Bearer ${token}`,
});
const ana = ctxFor('so_ana');
const text = (r: Awaited<ReturnType<typeof callTool>>) => r!.content[0].text;

async function putFile(ws: string, id: string, body: string, opts: { owner?: string; visibility?: string } = {}) {
  const blobId = `blob_${id}`;
  await e.ARTIFACTS.put(`test/${blobId}`, body);
  await e.DB.prepare('INSERT INTO asset_deliverables (id, workspace_id, owner_id, name, visibility) VALUES (?, ?, ?, ?, ?)')
    .bind(id, ws, opts.owner ?? 'usr_ana', `${id}.md`, opts.visibility ?? 'workspace').run();
  await e.DB.prepare("INSERT INTO blobs (id, filename, mime_type, r2_key, size_bytes, deliverable_id, version_no) VALUES (?, ?, 'text/markdown', ?, ?, ?, 1)")
    .bind(blobId, `${id}.md`, `test/${blobId}`, body.length, id).run();
  await queueKnowledgeSource(e, undefined, { workspaceId: ws, kind: 'asset', refId: id }, blobId);
}

function member(ws: string, userId: string, role: 'owner' | 'member' = 'member') {
  (MEMBERS[userId] ??= {})[ws] = role;
}

beforeAll(async () => {
  for (const sql of [
    `CREATE TABLE IF NOT EXISTS knowledge_settings (workspace_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, last_consolidated_at TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS asset_deliverables (id TEXT PRIMARY KEY, bucket_artifact_id TEXT, workspace_id TEXT, owner_id TEXT NOT NULL, name TEXT NOT NULL, visibility TEXT NOT NULL DEFAULT 'workspace', folder_id TEXT, deleted_at TEXT, type_metadata TEXT)`,
    `CREATE TABLE IF NOT EXISTS blobs (id TEXT PRIMARY KEY, artifact_id TEXT, filename TEXT NOT NULL, mime_type TEXT NOT NULL, r2_key TEXT NOT NULL, size_bytes INTEGER NOT NULL, deliverable_id TEXT, version_no INTEGER)`,
    `CREATE TABLE IF NOT EXISTS ai_usage_events (id TEXT PRIMARY KEY, workspace_id TEXT, user_id TEXT, kind TEXT NOT NULL, model TEXT NOT NULL, units REAL NOT NULL DEFAULT 0, unit_kind TEXT NOT NULL, base_cost_micro_usd INTEGER NOT NULL DEFAULT 0, source TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`,
  ]) await e.DB.exec(sql);

  Object.assign(NAMES, { [WS_A]: 'Agencia A', [WS_B]: 'Agencia B', [WS_OFF]: 'Apagado' });
  member(WS_A, 'usr_ana', 'owner');
  member(WS_A, 'usr_bo');
  member(WS_B, 'usr_bo', 'owner');

  await setKnowledgeEnabled(e, WS_A, true);
  await setKnowledgeEnabled(e, WS_B, true);
  await putFile(WS_A, 'dlv_a1', "# Cuentas\n\nAcme is a client of Northwind. Acme's budget is 50k.");
  await putFile(WS_A, 'dlv_a2', 'Weekly notes: Acme asked for a new proposal.');
  await putFile(WS_A, 'dlv_a3', "Northwind's budget is 90k.", { owner: 'usr_bo', visibility: 'private' });
  await putFile(WS_B, 'dlv_b1', "Contoso is a client of Northwind. Contoso's budget is 70k.");
});

beforeEach(() => {
  getInternalWorkspaceRole.mockReset().mockImplementation(async (_env: Env, ws: string, userId: string) => MEMBERS[userId]?.[ws] ?? null);
  listWorkspacesForUser.mockReset().mockImplementation(async (_env: Env, userId: string) =>
    Object.entries(MEMBERS[userId] ?? {}).map(([id, role]) => ({ id, name: NAMES[id], slug: id, role, artifactCount: 0 })));
});

describe('knowledge tools are listed', () => {
  it('exposes all four as read-only, telling the model to cite and use the person\'s language', () => {
    const tools = listTools().filter((t) => t.name.startsWith('knowledge_'));
    expect(tools.map((t) => t.name)).toEqual(['knowledge_search', 'knowledge_entity', 'knowledge_facts', 'knowledge_status']);
    for (const t of tools) {
      expect(t.annotations.readOnlyHint).toBe(true);
      expect(t.description).toMatch(/person's language/);
    }
    expect(tools.find((t) => t.name === 'knowledge_search')!.description).toMatch(/say where each fact comes from/);
  });
});

describe('knowledge_search', () => {
  it('returns numbered passages with their source, and meters the search to the caller', async () => {
    const r = await callTool(ana, 'knowledge_search', { query: 'Acme budget', workspace_id: WS_A });
    expect(r!.isError).toBeUndefined();
    expect(text(r)).toMatch(/passages from "Agencia A" for "Acme budget"/);
    expect(text(r)).toContain('[1] dlv_a1.md');
    expect(text(r)).toContain("Acme's budget is 50k.");
    expect(text(r)).toMatch(/Cite by \[number\]/);
    const hits = r!.structuredContent!.hits as Array<{ source: { id: string } }>;
    expect(hits.every((h) => ['dlv_a1', 'dlv_a2'].includes(h.source.id))).toBe(true);

    const metered = await e.DB.prepare("SELECT user_id FROM ai_usage_events WHERE workspace_id = ? AND kind = 'knowledge_search'").bind(WS_A).all();
    expect(metered.results).toContainEqual({ user_id: 'usr_ana' });
  });

  it('says plainly when nothing matches', async () => {
    const r = await callTool(ana, 'knowledge_search', { query: 'zzzunknownzzz', workspace_id: WS_A });
    expect(text(r)).toMatch(/Nothing in "Agencia A" matches/);
    expect(r!.structuredContent!.hits).toEqual([]);
  });

  it('asks which workspace when the person has several and named none', async () => {
    const r = await callTool(ctxFor('so_bo'), 'knowledge_search', { query: 'Acme' });
    expect(r!.structuredContent!.needs_workspace).toBe(true);
    expect(text(r)).toContain('Agencia A');
    expect(text(r)).toContain('Agencia B');
  });

  it('explains when knowledge is off instead of failing', async () => {
    member(WS_OFF, 'usr_ana', 'owner');
    const r = await callTool(ana, 'knowledge_search', { query: 'Acme', workspace_id: WS_OFF });
    delete MEMBERS.usr_ana[WS_OFF];
    expect(r!.isError).toBeUndefined();
    expect(text(r)).toMatch(/Knowledge is turned off for "Apagado"/);
    expect(r!.structuredContent!.enabled).toBe(false);
  });
});

describe('knowledge_entity', () => {
  it('finds an entity by name with its neighbours, sources and quotes', async () => {
    const r = await callTool(ana, 'knowledge_entity', { name: 'acme', workspace_id: WS_A });
    expect(text(r)).toMatch(/^Acme \(Organization\) in "Agencia A"/);
    expect(text(r)).toContain('- Acme client_of Northwind (Organization) [dlv_a1.md]');
    expect(text(r)).toContain('1 facts on record');
    const s = r!.structuredContent!;
    expect((s.entity as { sources: { id: string }[] }).sources.map((x) => x.id).sort()).toEqual(['dlv_a1', 'dlv_a2']);
    expect(s.neighbours).toEqual([expect.objectContaining({ type: 'client_of', other: expect.objectContaining({ name: 'Northwind' }) })]);

    const byId = await callTool(ana, 'knowledge_entity', { name: (s.entity as { id: string }).id, workspace_id: WS_A });
    expect(text(byId)).toMatch(/^Acme \(Organization\)/);
  });

  it('says nothing is known for an unknown name', async () => {
    const r = await callTool(ana, 'knowledge_entity', { name: 'Initech', workspace_id: WS_A });
    expect(r!.structuredContent!.found).toBe(false);
  });
});

describe('knowledge_facts', () => {
  it('returns facts with the quoted sentence and its source', async () => {
    const r = await callTool(ana, 'knowledge_facts', { about: 'Acme', workspace_id: WS_A });
    expect(text(r)).toContain(`- Acme · budget: 50k USD (from 2026-01-01) — "Acme's budget is 50k." [dlv_a1.md]`);
    expect(r!.structuredContent!.facts).toEqual([expect.objectContaining({ value: '50k', source: expect.objectContaining({ id: 'dlv_a1' }) })]);
  });

  it('filters by words and hides facts only another member can see', async () => {
    expect(text(await callTool(ana, 'knowledge_facts', { about: 'Acme', filter: 'deadline', workspace_id: WS_A }))).toMatch(/^No facts about "deadline"/);
    // Northwind's budget lives only in usr_bo's private File.
    const forAna = await callTool(ana, 'knowledge_facts', { about: 'Northwind', workspace_id: WS_A });
    expect(text(forAna)).not.toContain('90k');
    const forBo = await callTool(ctxFor('so_bo'), 'knowledge_facts', { about: 'Northwind', workspace_id: WS_A });
    expect(text(forBo)).toContain('budget: 90k');
  });
});

describe('knowledge_status', () => {
  it('counts what is learned and only names sources the caller may see', async () => {
    const r = await callTool(ana, 'knowledge_status', { workspace_id: WS_A });
    expect(text(r)).toMatch(/^Knowledge is on for "Agencia A"/);
    expect(text(r)).toMatch(/Learned: 3 files and pages/);
    expect(text(r)).toMatch(/Knows about \d+ people, companies, projects/);
    const ids = (r!.structuredContent!.sources as { id: string }[]).map((s) => s.id).sort();
    expect(ids).toEqual(['dlv_a1', 'dlv_a2']);
  });
});

describe('workspace isolation', () => {
  it('refuses a workspace the token does not belong to, before reading it', async () => {
    for (const name of ['knowledge_search', 'knowledge_entity', 'knowledge_facts', 'knowledge_status']) {
      const r = await callTool(ana, name, { workspace_id: WS_B, query: 'Contoso', name: 'Contoso', about: 'Contoso' });
      expect(r!.isError, name).toBe(true);
      expect(text(r), name).toMatch(/not a member of that workspace/);
      expect(text(r), name).not.toContain('70k');
    }
    expect(getInternalWorkspaceRole).not.toHaveBeenCalledWith(expect.anything(), WS_B, 'usr_ana');
  });

  it('the route still refuses when the workspace list is wrong (defence in depth)', async () => {
    listWorkspacesForUser.mockResolvedValue([{ id: WS_B, name: 'Agencia B', slug: WS_B, role: 'member', artifactCount: 0 }]);
    for (const name of ['knowledge_search', 'knowledge_entity', 'knowledge_facts', 'knowledge_status']) {
      const r = await callTool(ana, name, { workspace_id: WS_B, query: 'Contoso', name: 'Contoso', about: 'Contoso' });
      expect(r!.isError, name).toBe(true);
      expect(text(r), name).not.toMatch(/Contoso|70k/);
    }
  });

  it('never returns another workspace\'s passages, entities or facts', async () => {
    const search = await callTool(ana, 'knowledge_search', { query: 'Contoso', workspace_id: WS_A });
    expect(search!.structuredContent!.hits).toEqual([]);
    expect((await callTool(ana, 'knowledge_entity', { name: 'Contoso', workspace_id: WS_A }))!.structuredContent!.found).toBe(false);

    const bo = ctxFor('so_bo');
    const contoso = (await callTool(bo, 'knowledge_entity', { name: 'Contoso', workspace_id: WS_B }))!.structuredContent!.entity as { id: string };
    // B's entity id, asked about inside A, resolves to nothing.
    expect((await callTool(ana, 'knowledge_entity', { name: contoso.id, workspace_id: WS_A }))!.structuredContent!.found).toBe(false);
    expect(text(await callTool(ana, 'knowledge_facts', { about: contoso.id, workspace_id: WS_A }))).not.toContain('70k');
  });
});
