// The team's hand on the knowledge graph: what owners/admins confirm, rename, merge, connect
// or discard has to survive every re-learn, and their types, glossary and rules have to reach
// the learner. Same harness as graph.test.ts: a deterministic stand-in for the model.
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

import { queueKnowledgeSource } from '../../../src/knowledge/corpus/ingest';
import { routeKnowledgeApi } from '../../../src/router/api/knowledge';
import { createFetchContext } from '../../../src/router/context';
import { setKnowledgeEnabled } from '../../../src/knowledge';

const base = env as unknown as Env;
let n = 0;
const nextWs = () => `wsp_cur_${++n}_${Date.now()}`;

// "X is a client of Y" → relation, "X's budget is Nk" → fact, known names → entities.
const NAMES = ['Acme Inc.', 'Northwind', 'Contoso'];
function fakeExtraction(user: string) {
  const out = { entities: [] as object[], relations: [] as object[], facts: [] as object[] };
  user.split(/\n\n(?=\[\d+\])/).forEach((block) => {
    const chunk = Number(/^\[(\d+)\]/.exec(block)?.[1]);
    for (const sentence of block.split(/(?<=\.)\s+(?=[A-Z])|\n/)) {
      for (const name of NAMES) if (sentence.includes(name)) out.entities.push({ chunk, name, type: 'organization', aliases: [], quote: sentence.trim() });
      const rel = /(\w[\w.]*(?: Inc\.)?) is a client of (\w+)/.exec(sentence);
      if (rel) out.relations.push({ chunk, from: rel[1], type: 'client of', to: rel[2], quote: sentence.trim() });
      const fact = /(\w+)'s budget is (\d+k)/.exec(sentence);
      if (fact) out.facts.push({ chunk, entity: fact[1], predicate: 'budget', value: fact[2], unit: 'USD', quote: sentence.trim() });
    }
  });
  return out;
}

type Run = { messages?: { role: string; content: string }[]; text?: string[] };
function withModel(): Env & { AI: { run: ReturnType<typeof vi.fn> } } {
  const AI = {
    run: vi.fn(async (_model: string, input: Run) => {
      if (input.text) return { data: input.text.map(() => [1, 0, 0]) };
      const user = input.messages!.find((m) => m.role === 'user')!.content;
      return { response: fakeExtraction(user), usage: { prompt_tokens: 100, completion_tokens: 20 } };
    }),
  };
  return { ...base, AI } as unknown as Env & { AI: { run: ReturnType<typeof vi.fn> } };
}
/** The system prompt of the latest extraction call. */
const lastPrompt = (e: { AI: { run: ReturnType<typeof vi.fn> } }) =>
  (e.AI.run.mock.calls.filter((c) => (c[1] as Run).messages).at(-1)![1] as Run).messages![0].content;

beforeAll(async () => {
  for (const sql of [
    `CREATE TABLE IF NOT EXISTS knowledge_settings (workspace_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, last_consolidated_at TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS asset_deliverables (id TEXT PRIMARY KEY, bucket_artifact_id TEXT, workspace_id TEXT, owner_id TEXT NOT NULL, name TEXT NOT NULL, visibility TEXT NOT NULL DEFAULT 'workspace', folder_id TEXT, deleted_at TEXT, type_metadata TEXT)`,
    `CREATE TABLE IF NOT EXISTS blobs (id TEXT PRIMARY KEY, artifact_id TEXT, filename TEXT NOT NULL, mime_type TEXT NOT NULL, r2_key TEXT NOT NULL, size_bytes INTEGER NOT NULL, deliverable_id TEXT, version_no INTEGER)`,
    `CREATE TABLE IF NOT EXISTS ai_usage_events (id TEXT PRIMARY KEY, workspace_id TEXT, user_id TEXT, kind TEXT NOT NULL, model TEXT NOT NULL, units REAL NOT NULL DEFAULT 0, unit_kind TEXT NOT NULL, base_cost_micro_usd INTEGER NOT NULL DEFAULT 0, source TEXT, input_tokens INTEGER, output_tokens INTEGER, cost_source TEXT, provider_ref TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`,
  ]) {
    await base.DB.exec(sql);
  }
});

beforeEach(() => {
  validateToken.mockReset().mockResolvedValue(null);
  getSessionUser.mockReset().mockResolvedValue({ id: 'u1', email: 'me@example.com' });
  getInternalWorkspaceRole.mockReset().mockResolvedValue('owner');
});

/** File ids are global in D1: give each workspace its own. */
const fileId = (ws: string, id: string) => `${id}_${ws}`;

async function putFile(e: Env, ws: string, short: string, text: string, opts: { owner?: string; visibility?: string; version?: number } = {}) {
  const id = fileId(ws, short);
  const v = opts.version ?? 1;
  const blobId = `blob_${id}_${v}`;
  await e.ARTIFACTS.put(`test/${blobId}`, text);
  await e.DB.prepare('INSERT OR IGNORE INTO asset_deliverables (id, workspace_id, owner_id, name, visibility) VALUES (?, ?, ?, ?, ?)')
    .bind(id, ws, opts.owner ?? 'u1', `${id}.md`, opts.visibility ?? 'workspace').run();
  await e.DB.prepare("INSERT INTO blobs (id, filename, mime_type, r2_key, size_bytes, deliverable_id, version_no) VALUES (?, ?, 'text/markdown', ?, ?, ?, ?)")
    .bind(blobId, `${id}.md`, `test/${blobId}`, text.length, id, v).run();
  await queueKnowledgeSource(e, undefined, { workspaceId: ws, kind: 'asset', refId: id }, blobId);
}

const execCtx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
async function call<T = Record<string, unknown>>(e: Env, ws: string, method: string, sub: string, body?: unknown): Promise<{ status: number; body: T }> {
  const res = await routeKnowledgeApi(createFetchContext(
    new Request(`https://shareout.site/v1/workspaces/${ws}/knowledge/${sub}`, {
      method,
      headers: { Cookie: 'shareout_session=x', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }), e, execCtx,
  ));
  const text = await res!.text();
  let parsed: unknown = text;
  try { parsed = JSON.parse(text); } catch { /* markdown */ }
  return { status: res!.status, body: parsed as T };
}
const get = <T = Record<string, unknown>>(e: Env, ws: string, sub: string) => call<T>(e, ws, 'GET', sub);

type Ent = { id: string; name: string; type: string; status: string; aliases: string[]; mentions: number; description: string };
type List = { types: { type: string; count: number }[]; entities: Ent[] };
type Detail = { entity: Ent; facts: { id: string; predicate: string; value: string; status: string; source: unknown }[]; relations: { id: string; type: string; status: string; direction: string; other: { id: string; name: string } }[] };
const entities = async (e: Env, ws: string, q = '') => (await get<List>(e, ws, `entities${q}`)).body.entities;
const byName = async (e: Env, ws: string, name: string) => (await entities(e, ws)).find((x) => x.name === name);

async function setup(text: string, id = 'dlv_c1') {
  const e = withModel();
  const ws = nextWs();
  await setKnowledgeEnabled(e, ws, true);
  await putFile(e, ws, id, text);
  return { e, ws };
}

describe('team curation survives re-learning', () => {
  it('keeps a renamed, retyped entity and lands the old name on it', async () => {
    const { e, ws } = await setup('Acme Inc. is a client of Northwind.');
    const acme = (await byName(e, ws, 'Acme Inc.'))!;
    expect(acme.status).toBe('draft');

    const r = await call(e, ws, 'PATCH', `entities/${acme.id}`, { name: 'Acme Corporation', type: 'Client', description: 'Our first client.' });
    expect(r.status).toBe(200);

    await putFile(e, ws, 'dlv_c1', 'Acme Inc. is a client of Northwind. Acme Inc. renewed.', { version: 2 });
    const list = await entities(e, ws);
    const kept = list.find((x) => x.id === acme.id)!;
    expect(kept).toMatchObject({ name: 'Acme Corporation', type: 'Client', status: 'confirmed', description: 'Our first client.' });
    expect(kept.aliases).toContain('Acme Inc.');
    expect(kept.mentions).toBeGreaterThan(0); // the re-learn's mentions landed on it
    expect(list.filter((x) => x.name === 'Acme Inc.')).toEqual([]); // no new draft under the old name
    const d = (await get<Detail>(e, ws, `entities/${acme.id}`)).body;
    expect(d.relations).toEqual([expect.objectContaining({ type: 'client_of', other: expect.objectContaining({ name: 'Northwind' }) })]);
  });

  it('never brings back a discarded entity or connection, until it is restored', async () => {
    const { e, ws } = await setup('Contoso is a client of Northwind. Acme Inc. is a client of Northwind.');
    const contoso = (await byName(e, ws, 'Contoso'))!;
    const acme = (await byName(e, ws, 'Acme Inc.'))!;
    const acmeRel = (await get<Detail>(e, ws, `entities/${acme.id}`)).body.relations[0];
    expect((await call(e, ws, 'DELETE', `entities/${contoso.id}?reason=noint`)).status).toBe(200);
    expect((await call(e, ws, 'DELETE', `relations/${acmeRel.id}`)).status).toBe(200);

    await putFile(e, ws, 'dlv_c1', 'Contoso is a client of Northwind. Acme Inc. is a client of Northwind.', { version: 2 });
    expect(await byName(e, ws, 'Contoso')).toBeUndefined();
    const acme2 = (await byName(e, ws, 'Acme Inc.'))!;
    expect((await get<Detail>(e, ws, `entities/${acme2.id}`)).body.relations).toEqual([]);

    const discarded = (await get<{ discarded: { kind: string; key: string; label: string; reason: string | null }[] }>(e, ws, 'discarded')).body.discarded;
    expect(discarded.map((d) => d.label)).toEqual(expect.arrayContaining(['Contoso', expect.stringContaining('client_of')]));
    const tomb = discarded.find((d) => d.kind === 'entity')!;
    expect(tomb.reason).toBe('noint');
    expect((await call(e, ws, 'POST', 'discarded/restore', { kind: 'entity', key: tomb.key })).status).toBe(200);
    await putFile(e, ws, 'dlv_c1', 'Contoso is a client of Northwind.', { version: 3 });
    expect(await byName(e, ws, 'Contoso')).toBeTruthy();
  });

  it('merges, and a later mention of the merged name lands on the kept entity', async () => {
    const { e, ws } = await setup('Contoso is a client of Northwind.');
    const contoso = (await byName(e, ws, 'Contoso'))!;
    const acme = (await call<{ id: string }>(e, ws, 'POST', 'entities', { name: 'Acme Holding', type: 'Organization' })).body;
    expect((await call(e, ws, 'POST', `entities/${contoso.id}/merge`, { into: acme.id })).status).toBe(200);

    let kept = (await get<Detail>(e, ws, `entities/${acme.id}`)).body;
    expect(kept.entity.aliases).toContain('Contoso');
    expect(kept.relations).toEqual([expect.objectContaining({ type: 'client_of', other: expect.objectContaining({ name: 'Northwind' }) })]);

    await putFile(e, ws, 'dlv_c2', 'Contoso is a client of Northwind again.');
    expect(await byName(e, ws, 'Contoso')).toBeUndefined();
    kept = (await get<Detail>(e, ws, `entities/${acme.id}`)).body;
    expect(kept.entity.mentions).toBeGreaterThanOrEqual(2);
    expect((await get(e, ws, `entities/${contoso.id}`)).status).toBe(404);
  });

  it('keeps what the team confirmed or added when its only source goes away', async () => {
    const { e, ws } = await setup("Northwind's budget is 10k.");
    const nw = (await byName(e, ws, 'Northwind'))!;
    const area = (await call<{ id: string }>(e, ws, 'POST', 'entities', { name: 'Gerencia SGI', type: 'Area', aliases: ['SGI'] })).body;
    expect((await call(e, ws, 'POST', 'relations', { from: area.id, type: 'manages', to: nw.id })).status).toBe(201);
    expect((await call(e, ws, 'POST', `entities/${nw.id}/facts`, { predicate: 'owner', value: 'Calidad' })).status).toBe(201);

    await e.DB.prepare('DELETE FROM asset_deliverables WHERE id = ?').bind(fileId(ws, 'dlv_c1')).run();
    await queueKnowledgeSource(e, undefined, { workspaceId: ws, kind: 'asset', refId: fileId(ws, 'dlv_c1') }, 'deleted');

    const d = (await get<Detail>(e, ws, `entities/${nw.id}`)).body;
    expect(d.entity.status).toBe('confirmed');
    expect(d.facts).toEqual([expect.objectContaining({ predicate: 'owner', value: 'Calidad', status: 'confirmed', source: null })]); // the learned 10k left with its source
    expect(d.relations).toEqual([expect.objectContaining({ type: 'manages', status: 'confirmed', direction: 'in', other: expect.objectContaining({ name: 'Gerencia SGI' }) })]);
    expect((await entities(e, ws, '?q=sgi')).map((x) => x.id)).toEqual([area.id]); // found by the team's alias
  });

  it('keeps a discarded learned fact out, and a confirmed one in, across re-learns', async () => {
    const { e, ws } = await setup("Northwind's budget is 10k. Contoso's budget is 20k.");
    const nw = (await byName(e, ws, 'Northwind'))!;
    const co = (await byName(e, ws, 'Contoso'))!;
    const nwFact = (await get<Detail>(e, ws, `entities/${nw.id}`)).body.facts[0];
    const coFact = (await get<Detail>(e, ws, `entities/${co.id}`)).body.facts[0];
    expect((await call(e, ws, 'DELETE', `facts/${nwFact.id}`)).status).toBe(200);
    expect((await call(e, ws, 'POST', `facts/${coFact.id}/confirm`)).status).toBe(200);

    await putFile(e, ws, 'dlv_c1', "Northwind's budget is 10k. Contoso's budget is 30k.", { version: 2 });
    // Northwind is still a draft, so the re-learn rebuilt it (new id); Contoso was confirmed, so it kept its id.
    const nw2 = (await byName(e, ws, 'Northwind'))!;
    expect(nw2.id).not.toBe(nw.id);
    expect((await get<Detail>(e, ws, `entities/${nw2.id}`)).body.facts).toEqual([]);
    const coFacts = (await get<Detail>(e, ws, `entities/${co.id}`)).body.facts;
    // The team's 20k stays and comes first; the newer document's 30k shows next to it.
    expect(coFacts.map((f) => [f.value, f.status])).toEqual([['20k', 'confirmed'], ['30k', 'draft']]);
  });

  it('skips ignored types, and with team-only types skips everything else', async () => {
    const { e, ws } = await setup('Acme Inc. is a client of Northwind.');
    expect((await call(e, ws, 'PUT', 'schema/types/Organization', { ignored: true })).status).toBe(200);
    expect(await entities(e, ws)).toEqual([]);
    const schema = (await get<{ types: { type: string; ignored: boolean; count: number }[] }>(e, ws, 'schema')).body;
    expect(schema.types).toContainEqual(expect.objectContaining({ type: 'Organization', ignored: true }));

    await putFile(e, ws, 'dlv_c2', 'Contoso is a client of Northwind.');
    expect((await call(e, ws, 'PUT', 'schema/types/Organization', { ignored: false })).status).toBe(200);
    // Contoso arrived while its type was ignored, so it was never learned.
    expect((await entities(e, ws)).map((x) => x.name).sort()).toEqual(['Acme Inc.', 'Northwind']);

    // Switching Organization back on made it one of the team's types; take it off the list.
    expect((await call(e, ws, 'DELETE', 'schema/types/Organization')).status).toBe(200);
    expect((await call(e, ws, 'PUT', 'schema/types/Client', { description: 'Companies that hire us' })).status).toBe(200);
    expect((await call(e, ws, 'PUT', 'schema', { teamOnly: true })).status).toBe(200);
    await putFile(e, ws, 'dlv_c3', 'Contoso is a client of Northwind.');
    expect((await entities(e, ws)).map((x) => x.name)).not.toContain('Contoso');
  });

  it('a rename onto another entity’s name is refused with a merge hint', async () => {
    const { e, ws } = await setup('Acme Inc. is a client of Northwind.');
    const acme = (await byName(e, ws, 'Acme Inc.'))!;
    const nw = (await byName(e, ws, 'Northwind'))!;
    const r = await call<{ code: string; suggestion: string }>(e, ws, 'PATCH', `entities/${acme.id}`, { name: 'Northwind' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('CONFLICT');
    expect(r.body.suggestion).toContain(nw.id);
  });
});

describe('the learner hears the team first', () => {
  it('sends the team’s types, glossary, rules, discards and confirmed names with every batch', async () => {
    const { e, ws } = await setup('Acme Inc. is a client of Northwind. Contoso is a client of Northwind.');
    const contoso = (await byName(e, ws, 'Contoso'))!;
    const nw = (await byName(e, ws, 'Northwind'))!;
    await call(e, ws, 'PATCH', `entities/${nw.id}`, { name: 'Northwind Traders', aliases: ['NWT'] });
    await call(e, ws, 'DELETE', `entities/${contoso.id}`);
    await call(e, ws, 'PUT', 'schema/types/Registro', { description: 'Códigos RS-xx y RG-xx' });
    await call(e, ws, 'PUT', 'schema/types/Lugar', { ignored: true });
    expect((await call(e, ws, 'POST', 'rules', { kind: 'glossary', term: 'NC (en RS-28)', text: 'No corresponde, no una No conformidad.' })).status).toBe(201);
    expect((await call(e, ws, 'POST', 'rules', { text: 'El código del documento va primero en el nombre.' })).status).toBe(201);

    await putFile(e, ws, 'dlv_c2', 'Acme Inc. signed again.');
    const prompt = lastPrompt(e);
    const team = prompt.indexOf('The workspace team curates this graph');
    expect(team).toBeGreaterThan(0);
    expect(prompt).toContain('- Registro — Códigos RS-xx y RG-xx');
    expect(prompt).toContain('Never extract entities of these types: Lugar.');
    expect(prompt).toContain('never extract them again: Contoso');
    expect(prompt).toContain('- NC (en RS-28): No corresponde, no una No conformidad.');
    expect(prompt).toContain('- El código del documento va primero en el nombre.');
    expect(prompt).toContain('Confirmed by the team');
    expect(prompt).toContain('- Northwind Traders (Organization) — also called Northwind, NWT');
    // Team decisions come before the list of merely-known names.
    expect(prompt.indexOf('Confirmed by the team')).toBeGreaterThan(team);

    const rules = (await get<{ rules: { kind: string; text: string }[] }>(e, ws, 'rules')).body.rules;
    expect(rules.map((r) => r.kind)).toEqual(['glossary', 'rule']);
    const hist = (await get<{ history: { action: string }[] }>(e, ws, 'history')).body.history.map((h) => h.action);
    expect(hist).toEqual(expect.arrayContaining(['entity.update', 'entity.discard', 'type.set', 'rule.add']));
  });
});

describe('who may curate', () => {
  it('members read the team’s work but cannot change it', async () => {
    const { e, ws } = await setup('Acme Inc. is a client of Northwind.');
    const acme = (await byName(e, ws, 'Acme Inc.'))!;
    await call(e, ws, 'POST', 'rules', { text: 'Clients are Organizations.' });
    getInternalWorkspaceRole.mockResolvedValue('member');

    for (const [method, sub, body] of [
      ['POST', 'entities', { name: 'X', type: 'Organization' }],
      ['PATCH', `entities/${acme.id}`, { name: 'Y' }],
      ['DELETE', `entities/${acme.id}`, undefined],
      ['POST', 'relations', { from: acme.id, type: 'owns', to: acme.id }],
      ['POST', 'rules', { text: 'nope' }],
      ['PUT', 'schema', { teamOnly: true }],
    ] as const) {
      expect((await call(e, ws, method, sub, body)).status, `${method} ${sub}`).toBe(403);
    }
    expect((await get(e, ws, 'history')).status).toBe(403);
    expect((await get(e, ws, 'discarded')).status).toBe(403);
    expect((await get<{ rules: unknown[] }>(e, ws, 'rules')).body.rules).toHaveLength(1);
    expect((await get(e, ws, 'schema')).status).toBe(200);
  });

  it('shows a confirmed entity to every member under the team’s names only', async () => {
    const e = withModel();
    const ws = nextWs();
    await setKnowledgeEnabled(e, ws, true);
    // Only u2 may open this File.
    await putFile(e, ws, 'dlv_p1', 'Contoso is a client of Northwind.', { owner: 'u2', visibility: 'private' });
    getSessionUser.mockResolvedValue({ id: 'u2', email: 'u2@example.com' });
    const contoso = (await byName(e, ws, 'Contoso'))!;
    await call(e, ws, 'PATCH', `entities/${contoso.id}`, { name: 'Contoso Group', aliases: ['CG'] });

    getSessionUser.mockResolvedValue({ id: 'u1', email: 'me@example.com' });
    getInternalWorkspaceRole.mockResolvedValue('member');
    const list = await entities(e, ws);
    expect(list.map((x) => x.name)).toEqual(['Contoso Group']); // Northwind is a draft only the private File backs
    expect(list[0].aliases.sort()).toEqual(['CG', 'Contoso']); // the team's aliases, nothing from the File itself
    const d = (await get<Detail & { mentions: unknown[] }>(e, ws, `entities/${contoso.id}`)).body;
    expect(d.relations).toEqual([]); // its connection is learned from the private File
    expect(d.mentions).toEqual([]);
  });
});

describe('names, history and what members may read', () => {
  it('refuses a name or alias another entity already goes by, so later learns keep landing on its owner', async () => {
    const { e, ws } = await setup('Acme Inc. is a client of Northwind.');
    const nw = (await byName(e, ws, 'Northwind'))!;
    const acme = (await byName(e, ws, 'Acme Inc.'))!;
    // an alias that is another entity's name
    let r = await call<{ code: string; suggestion: string }>(e, ws, 'POST', 'entities', { name: 'NW Holdings', type: 'Organization', aliases: ['Northwind'] });
    expect(r.status).toBe(409);
    expect(r.body.suggestion).toContain(nw.id);
    // the same name under another type
    r = await call(e, ws, 'POST', 'entities', { name: 'Northwind', type: 'Client' });
    expect(r.status).toBe(409);
    expect(r.body.suggestion).toContain(nw.id);
    // an alias the team already gave another entity
    const area = (await call<{ id: string }>(e, ws, 'POST', 'entities', { name: 'Gerencia SGI', type: 'Area', aliases: ['SGI'] })).body;
    r = await call(e, ws, 'PATCH', `entities/${acme.id}`, { aliases: ['SGI'] });
    expect(r.status).toBe(409);
    expect(r.body.suggestion).toContain(area.id);
    // nothing was repointed: a later document still lands on Northwind and on Gerencia SGI
    await putFile(e, ws, 'dlv_c2', 'Acme Inc. is a client of Northwind.');
    const names = (await entities(e, ws)).map((x) => x.name);
    expect(names.filter((n) => n === 'Northwind')).toHaveLength(1);
    expect(names).not.toContain('NW Holdings');
    expect((await entities(e, ws, '?q=SGI')).map((x) => x.id)).toEqual([area.id]);
  });

  it('per-entity history lists only that entity’s changes', async () => {
    const { e, ws } = await setup('Acme Inc. is a client of Northwind.');
    const acme = (await byName(e, ws, 'Acme Inc.'))!;
    const nw = (await byName(e, ws, 'Northwind'))!;
    await call(e, ws, 'PATCH', `entities/${acme.id}`, { confirm: true });
    await call(e, ws, 'PATCH', `entities/${nw.id}`, { description: 'A partner.' });
    await call(e, ws, 'POST', 'relations', { from: acme.id, type: 'owns', to: nw.id });
    type H = { history: { action: string; targets: string[] }[] };
    const mine = (await get<H>(e, ws, `history?entity=${acme.id}`)).body.history;
    expect(mine.map((h) => h.action)).toEqual(['relation.create', 'entity.confirm']);
    expect(mine.every((h) => h.targets.includes(acme.id))).toBe(true);
    expect((await get<H>(e, ws, `history?entity=${nw.id}`)).body.history.map((h) => h.action)).toEqual(['relation.create', 'entity.update']);
  });

  it('gives members the team’s own types only — no graph-wide counts or relation types', async () => {
    const { e, ws } = await setup('Acme Inc. is a client of Northwind.');
    await call(e, ws, 'PUT', 'schema/types/Registro', { description: 'RS-xx' });
    type S = { types: { type: string; count?: number; team: boolean }[]; relationTypes: string[] };
    const admin = (await get<S>(e, ws, 'schema')).body;
    expect(admin.types).toContainEqual(expect.objectContaining({ type: 'Organization', count: 2, team: false }));
    expect(admin.relationTypes).toEqual(['client_of']);
    getInternalWorkspaceRole.mockResolvedValue('member');
    const member = (await get<S>(e, ws, 'schema')).body;
    expect(member.types).toEqual([expect.objectContaining({ type: 'Registro', team: true })]);
    expect(member.types[0].count).toBeUndefined();
    expect(member.relationTypes).toEqual([]);
  });
});
