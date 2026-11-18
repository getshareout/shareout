// Graph editing over MCP: an owner or admin fixes what Knowledge learned with the
// knowledge_edit_* tools, the edits hold on a re-learn and reach the learner's prompt, and a
// member or another workspace changes nothing. Same harness as knowledge-tools.test.ts.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:test';
import type { Env } from '../../../src/types';

const MEMBERS: Record<string, Record<string, 'owner' | 'member'>> = {};
const TOKENS: Record<string, string> = { so_ana: 'usr_ana', so_bo: 'usr_bo', so_cy: 'usr_cy' };
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
const WS = `wsp_kcur_${run}`;
const WS_B = `wsp_kcur_b_${run}`;

// Stand-in for the extraction model: known names become entities, "X is a client of Y" a
// relation, "X's budget is N" a fact, each quoting its sentence.
const KNOWN = ['Acme', 'Northwind', 'Contoso', 'Initech Labs', 'Initech'];
function fakeExtraction(user: string) {
  const out = { entities: [] as object[], relations: [] as object[], facts: [] as object[] };
  user.split(/\n\n(?=\[\d+\])/).forEach((block) => {
    const chunk = Number(/^\[(\d+)\]/.exec(block)?.[1]);
    for (const sentence of block.split(/(?<=\.)\s+(?=[A-Z])|\n/)) {
      for (const name of KNOWN) if (new RegExp(`\\b${name}\\b`).test(sentence)) out.entities.push({ chunk, name, type: 'organization', quote: sentence.trim() });
      const rel = /(\w+) is a client of (\w+)/.exec(sentence);
      if (rel) out.relations.push({ chunk, from: rel[1], type: 'client of', to: rel[2], quote: sentence.trim() });
      const fact = /(\w+)'s budget is (\d+k)/.exec(sentence);
      if (fact) out.facts.push({ chunk, entity: fact[1], predicate: 'budget', value: fact[2], unit: 'USD', quote: sentence.trim() });
    }
  });
  return out;
}

type Run = { messages?: { role: string; content: string }[]; text?: string[] };
const AI = {
  run: vi.fn(async (_m: string, input: Run) => {
    if (input.text) return { data: input.text.map(() => [1, 0, 0]) };
    return { response: fakeExtraction(input.messages!.find((m) => m.role === 'user')!.content), usage: { prompt_tokens: 10, completion_tokens: 5 } };
  }),
};
const e = { ...base, AI } as unknown as Env;
/** The system prompt of the latest extraction call. */
const lastPrompt = () => (AI.run.mock.calls.filter((c) => (c[1] as Run).messages).at(-1)![1] as Run).messages![0].content;

const ctxFor = (token: string) => ({
  env: e, user: { id: TOKENS[token], email: `${TOKENS[token]}@example.com`, username: null }, origin: 'https://shareout.test', authorization: `Bearer ${token}`,
});
const ana = ctxFor('so_ana'); // owner
const bo = ctxFor('so_bo'); // member
const text = (r: Awaited<ReturnType<typeof callTool>>) => r!.content[0].text;
const tool = (ctx: ReturnType<typeof ctxFor>, name: string, args: Record<string, unknown>) => callTool(ctx, name, { workspace_id: WS, ...args });

const FILE_1 = "Acme is a client of Northwind. Acme's budget is 50k. Contoso is a client of Acme.";
const FILE_2 = 'Initech Labs works inside Initech. Initech is a client of Northwind.';
const fileId = (short: string) => `${short}_${run}`;
async function putFile(ws: string, short: string, body: string, version = 1) {
  const id = fileId(short);
  const blobId = `blob_${id}_${version}`;
  await e.ARTIFACTS.put(`test/${blobId}`, body);
  await e.DB.prepare("INSERT OR IGNORE INTO asset_deliverables (id, workspace_id, owner_id, name, visibility) VALUES (?, ?, 'usr_ana', ?, 'workspace')")
    .bind(id, ws, `${short}.md`).run();
  await e.DB.prepare("INSERT INTO blobs (id, filename, mime_type, r2_key, size_bytes, deliverable_id, version_no) VALUES (?, ?, 'text/markdown', ?, ?, ?, ?)")
    .bind(blobId, `${short}.md`, `test/${blobId}`, body.length, id, version).run();
  await queueKnowledgeSource(e, undefined, { workspaceId: ws, kind: 'asset', refId: id }, blobId);
}
let version = 1;
/** Re-learn FILE_1 from a new version, as an edit to the File would. */
const relearn = () => putFile(WS, 'f1', FILE_1, ++version);

beforeAll(async () => {
  for (const sql of [
    `CREATE TABLE IF NOT EXISTS knowledge_settings (workspace_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, last_consolidated_at TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS asset_deliverables (id TEXT PRIMARY KEY, bucket_artifact_id TEXT, workspace_id TEXT, owner_id TEXT NOT NULL, name TEXT NOT NULL, visibility TEXT NOT NULL DEFAULT 'workspace', folder_id TEXT, deleted_at TEXT, type_metadata TEXT)`,
    `CREATE TABLE IF NOT EXISTS blobs (id TEXT PRIMARY KEY, artifact_id TEXT, filename TEXT NOT NULL, mime_type TEXT NOT NULL, r2_key TEXT NOT NULL, size_bytes INTEGER NOT NULL, deliverable_id TEXT, version_no INTEGER)`,
    `CREATE TABLE IF NOT EXISTS knowledge_ingest (workspace_id TEXT NOT NULL, artifact_id TEXT NOT NULL, content_hash TEXT, reason TEXT NOT NULL, queued_at TEXT NOT NULL DEFAULT (datetime('now')), processed_at TEXT, PRIMARY KEY (workspace_id, artifact_id, reason))`,
    `CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, name TEXT, slug TEXT, owner_id TEXT, visibility TEXT, workspace_id TEXT, deleted_at TEXT, type_metadata TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS ai_usage_events (id TEXT PRIMARY KEY, workspace_id TEXT, user_id TEXT, kind TEXT NOT NULL, model TEXT NOT NULL, units REAL NOT NULL DEFAULT 0, unit_kind TEXT NOT NULL, base_cost_micro_usd INTEGER NOT NULL DEFAULT 0, source TEXT, input_tokens INTEGER, output_tokens INTEGER, cost_source TEXT, provider_ref TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`,
  ]) await e.DB.exec(sql);

  Object.assign(NAMES, { [WS]: 'INCRO', [WS_B]: 'Otra' });
  MEMBERS.usr_ana = { [WS]: 'owner' };
  MEMBERS.usr_bo = { [WS]: 'member' };
  MEMBERS.usr_cy = { [WS_B]: 'owner' };
  await setKnowledgeEnabled(e, WS, true);
  await setKnowledgeEnabled(e, WS_B, true);
  await putFile(WS, 'f1', FILE_1);
  await putFile(WS, 'f2', FILE_2);
  await putFile(WS_B, 'fb', 'Contoso is a client of Northwind.');
});

beforeEach(() => {
  getInternalWorkspaceRole.mockReset().mockImplementation(async (_env: Env, ws: string, userId: string) => MEMBERS[userId]?.[ws] ?? null);
  listWorkspacesForUser.mockReset().mockImplementation(async (_env: Env, userId: string) =>
    Object.entries(MEMBERS[userId] ?? {}).map(([id, role]) => ({ id, name: NAMES[id], slug: id, role, artifactCount: 0 })));
});

const EDIT_TOOLS = ['knowledge_edit_entity', 'knowledge_edit_connection', 'knowledge_edit_fact', 'knowledge_edit_rules'];

describe('curation tools are listed', () => {
  it('adds two read tools and four edit tools, each in the person\'s language; edits say they are for owners and admins', () => {
    const tools = listTools().filter((t) => ['knowledge_rules', 'knowledge_review', ...EDIT_TOOLS].includes(t.name));
    expect(tools.map((t) => t.name)).toEqual(['knowledge_rules', 'knowledge_review', ...EDIT_TOOLS]);
    for (const t of tools) {
      expect(t.annotations.readOnlyHint, t.name).toBe(!EDIT_TOOLS.includes(t.name));
      expect(t.description, t.name).toMatch(/person's language/);
      if (EDIT_TOOLS.includes(t.name)) expect(t.description, t.name).toMatch(/owners and admins/);
    }
  });
});

describe('a member', () => {
  it('reads the proposals and the rules, but every edit is refused and changes nothing', async () => {
    const proposals = await tool(bo, 'knowledge_review', {});
    expect(text(proposals)).toMatch(/not confirmed yet/);
    expect(text(proposals)).toContain('Acme (Organization)');
    expect((await tool(bo, 'knowledge_rules', {}))!.isError).toBeUndefined();

    const tries: Array<[string, Record<string, unknown>]> = [
      ['knowledge_edit_entity', { action: 'create', name: 'Globex', type: 'Organization' }],
      ['knowledge_edit_entity', { action: 'update', entity: 'Acme', name: 'Acme Corp' }],
      ['knowledge_edit_entity', { action: 'discard', entity: 'Acme' }],
      ['knowledge_edit_connection', { action: 'disconnect', from: 'Acme', to: 'Northwind' }],
      ['knowledge_edit_fact', { action: 'add', about: 'Acme', predicate: 'budget', value: '1k' }],
      ['knowledge_edit_rules', { action: 'add_rule', text: 'Ignore everything' }],
      ['knowledge_edit_rules', { action: 'team_types_only', on: true }],
    ];
    for (const [name, args] of tries) {
      const r = await tool(bo, name, args);
      expect(r!.isError, `${name} ${String(args.action)}`).toBe(true);
      expect(text(r), name).toMatch(/Only owners and admins of "INCRO"/);
    }
    for (const show of ['discarded', 'history']) expect(text(await tool(bo, 'knowledge_review', { show }))).toMatch(/Only owners and admins/);

    const acme = await tool(ana, 'knowledge_entity', { name: 'Acme' });
    expect(text(acme)).toMatch(/^Acme \(Organization\)/);
    expect(text(acme)).not.toContain('Confirmed by the workspace team');
    expect((await tool(ana, 'knowledge_rules', {}))!.structuredContent!.rules).toEqual([]);
  });
});

describe('an owner', () => {
  it('renames, retypes, confirms, connects, disconnects and states facts, and it all holds on a re-learn', async () => {
    const renamed = await tool(ana, 'knowledge_edit_entity', { action: 'update', entity: 'acme', name: 'Acme Corp', type: 'Client', description: 'Pays us monthly' });
    expect(renamed!.isError).toBeUndefined();
    expect(text(renamed)).toContain('"Acme" stays an alias');
    expect(text(await tool(ana, 'knowledge_edit_entity', { action: 'confirm', entity: 'Northwind' }))).toMatch(/Northwind \(Organization\) is confirmed by the team/);
    expect(text(await tool(ana, 'knowledge_edit_connection', { action: 'disconnect', from: 'Contoso', to: 'Acme Corp', reason: 'misread' })))
      .toMatch(/^Disconnected: Contoso client_of Acme Corp/);
    expect(text(await tool(ana, 'knowledge_edit_connection', { action: 'connect', from: 'Acme Corp', type: 'buys from', to: 'Initech' })))
      .toMatch(/^Connected: Acme Corp buys_from Initech/);
    // "Acme" is still one of its names.
    expect(text(await tool(ana, 'knowledge_edit_fact', { action: 'add', about: 'Acme', predicate: 'budget', value: '60k', unit: 'USD' })))
      .toMatch(/^Recorded as the team's word: Acme Corp · budget: 60k USD/);
    await tool(ana, 'knowledge_edit_rules', { action: 'add_rule', text: 'Labs belong to their parent company' });
    await tool(ana, 'knowledge_edit_rules', { action: 'add_glossary', term: 'SSA', text: 'Seguridad, Salud y Ambiente' });
    expect(text(await tool(ana, 'knowledge_edit_rules', { action: 'set_type', type: 'Client', description: 'Who pays us' }))).toMatch(/Client is one of the team's types/);

    await relearn();

    const acme = await tool(ana, 'knowledge_entity', { name: 'Acme' });
    expect(text(acme)).toMatch(/^Acme Corp \(Client\) in "INCRO" — also called Acme/);
    expect(text(acme)).toContain('Confirmed by the workspace team — Pays us monthly.');
    expect(text(acme)).toContain('- Acme Corp buys_from Initech (Organization) [confirmed by the team]');
    expect(text(acme)).toContain('- Acme Corp client_of Northwind (Organization) [f1.md]');
    // The disconnected connection stays gone (the sentence itself is still quoted).
    expect(text(acme)).not.toContain('- Contoso (Organization) client_of Acme Corp');

    const facts = text(await tool(ana, 'knowledge_facts', { about: 'Acme Corp' }));
    expect(facts).toContain('- Acme Corp · budget: 60k USD — confirmed by the workspace team');
    // What the File says still shows, next to the team's value.
    expect(facts).toContain(`- Acme Corp · budget: 50k USD — "Acme's budget is 50k." [f1.md]`);

    const prompt = lastPrompt();
    expect(prompt).toContain('Labs belong to their parent company');
    expect(prompt).toContain('SSA');
    expect(prompt).toContain('Acme Corp');

    const proposals = text(await tool(ana, 'knowledge_review', {}));
    expect(proposals).not.toMatch(/Acme Corp|Northwind/);
    expect(proposals).toContain('Contoso (Organization)');
    const history = text(await tool(ana, 'knowledge_review', { show: 'history', entity: 'Acme Corp' }));
    expect(history).toMatch(/entity\.update · Acme → Acme Corp · type Organization → Client/);
    expect(history).toMatch(/fact\.add · budget: 60k/);
  });

  it('needs an exact name to discard or merge, and a discard holds until it is restored', async () => {
    const vague = await tool(ana, 'knowledge_edit_entity', { action: 'discard', entity: 'Inite' });
    expect(vague!.isError).toBe(true);
    expect(text(vague)).toMatch(/Nothing is called exactly "Inite"\. Nothing was changed/);
    // Initech was confirmed when the team connected Acme Corp to it.
    expect(text(vague)).toMatch(/- Initech \(Organization, confirmed\) — id ent_/);
    expect(text(vague)).toMatch(/- Initech Labs \(Organization\) — id ent_/);

    expect(text(await tool(ana, 'knowledge_edit_entity', { action: 'merge', entity: 'Initech Labs', into: 'Initech' }))).toMatch(/^Merged Initech Labs into Initech/);
    expect(text(await tool(ana, 'knowledge_entity', { name: 'Initech Labs' }))).toMatch(/^Initech \(Organization\) in "INCRO" — also called Initech Labs/);

    expect(text(await tool(ana, 'knowledge_edit_entity', { action: 'discard', entity: 'Contoso', reason: 'not_relevant' }))).toMatch(/^Discarded Contoso/);
    await relearn();
    expect((await tool(ana, 'knowledge_entity', { name: 'Contoso' }))!.structuredContent!.found).toBe(false);

    const discarded = await tool(ana, 'knowledge_review', { show: 'discarded' });
    expect(text(discarded)).toMatch(/- Contoso \(entity, not relevant\) — key contoso/);
    expect(text(discarded)).toMatch(/- Contoso → client_of → Acme Corp \(relation, misread\)/);
    const key = (discarded!.structuredContent!.discarded as Array<{ kind: string; key: string; label: string }>).find((x) => x.label === 'Contoso')!.key;
    expect(text(await tool(ana, 'knowledge_edit_rules', { action: 'restore', kind: 'entity', key }))).toMatch(/^Restored/);
    await relearn();
    expect(text(await tool(ana, 'knowledge_entity', { name: 'Contoso' }))).toMatch(/^Contoso \(Organization\)/);
  });

  it('is told to merge instead of renaming onto another entity\'s name', async () => {
    const initech = (await tool(ana, 'knowledge_entity', { name: 'Initech' }))!.structuredContent!.entity as { id: string };
    const r = await tool(ana, 'knowledge_edit_entity', { action: 'update', entity: 'Northwind', name: 'Initech' });
    expect(r!.isError).toBe(true);
    expect(text(r)).toMatch(/Nothing was changed\. If they are the same thing, merge them/);
    expect(r!.structuredContent!.other_id).toBe(initech.id);
    expect(text(await tool(ana, 'knowledge_entity', { name: 'Northwind' }))).toMatch(/^Northwind \(Organization\)/);
  });

  it('finds facts and connections by what they say, and asks when that is not enough', async () => {
    const missing = await tool(ana, 'knowledge_edit_fact', { action: 'remove', about: 'Acme Corp', predicate: 'deadline' });
    expect(text(missing)).toMatch(/Acme Corp has no "deadline" fact\. Nothing was changed/);
    expect(text(missing)).toMatch(/- Acme Corp · budget: 60k USD \(team\) — id fct_/);
    // Confirming the File's 50k makes it the team's value, in place of 60k.
    expect(text(await tool(ana, 'knowledge_edit_fact', { action: 'confirm', about: 'Acme Corp', predicate: 'budget', value: '50k' })))
      .toMatch(/^Confirmed as the team's value: Acme Corp · budget: 50k USD \[f1\.md\]/);
    const facts = text(await tool(ana, 'knowledge_facts', { about: 'Acme Corp' }));
    expect(facts).toContain('budget: 50k USD — confirmed by the workspace team');
    expect(facts).not.toContain('60k');

    const none = await tool(ana, 'knowledge_edit_connection', { action: 'confirm', from: 'Northwind', type: 'supplies' });
    expect(text(none)).toMatch(/Northwind has no connection like that/);
    expect(text(await tool(ana, 'knowledge_edit_connection', { action: 'confirm', from: 'Initech', to: 'Northwind' }))).toMatch(/^Confirmed: Initech client_of Northwind/);
  });
});

describe('the rules', () => {
  it('every member reads the team\'s types, glossary and rules; counts stay with owners and admins', async () => {
    const forBo = await tool(bo, 'knowledge_rules', {});
    expect(text(forBo)).toContain('- Client — Who pays us');
    expect(text(forBo)).toContain('- SSA: Seguridad, Salud y Ambiente');
    expect(text(forBo)).toContain('- Labs belong to their parent company');
    expect(text(forBo)).not.toMatch(/Other types Knowledge learned|· \d/);
    expect(text(await tool(ana, 'knowledge_rules', {}))).toMatch(/- Client — Who pays us · 1\n/);

    expect(text(await tool(ana, 'knowledge_edit_rules', { action: 'set_type', type: 'Client', ignored: true }))).toMatch(/Client is ignored/);
    const rules = (await tool(ana, 'knowledge_rules', {}))!.structuredContent!;
    const rule = (rules.rules as Array<{ id: string; kind: string }>).find((r) => r.kind === 'rule')!;
    expect(text(await tool(ana, 'knowledge_edit_rules', { action: 'remove_rule', rule_id: rule.id }))).toMatch(/^Rule removed/);
    expect((await tool(ana, 'knowledge_rules', {}))!.structuredContent!.rules).toEqual([expect.objectContaining({ kind: 'glossary', term: 'SSA' })]);
  });
});

describe('workspace isolation', () => {
  it('an owner of one workspace changes nothing in another', async () => {
    const cy = ctxFor('so_cy');
    const contoso = (await callTool(cy, 'knowledge_entity', { name: 'Contoso', workspace_id: WS_B }))!.structuredContent!.entity as { id: string };
    for (const [name, args] of [
      ['knowledge_edit_entity', { action: 'discard', entity: contoso.id }],
      ['knowledge_edit_entity', { action: 'update', entity: 'Contoso', name: 'Hacked' }],
      ['knowledge_edit_rules', { action: 'add_rule', text: 'x' }],
      ['knowledge_review', { show: 'history' }],
    ] as Array<[string, Record<string, unknown>]>) {
      const r = await callTool(ana, name, { workspace_id: WS_B, ...args });
      expect(r!.isError, name).toBe(true);
      expect(text(r), name).toMatch(/not a member of that workspace/);
    }
    // B's entity id, used inside ana's own workspace, resolves to nothing.
    expect(text(await tool(ana, 'knowledge_edit_entity', { action: 'discard', entity: contoso.id }))).toMatch(/Nothing called/);
    expect(text(await callTool(cy, 'knowledge_entity', { name: 'Contoso', workspace_id: WS_B }))).toMatch(/^Contoso \(Organization\) in "Otra"/);
  });
});
