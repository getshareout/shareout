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

import { normalizeName, normalizeType, validateExtraction } from '../../../src/knowledge/corpus/extract';
import { queueKnowledgeSource } from '../../../src/knowledge/corpus/ingest';
import { routeKnowledgeApi } from '../../../src/router/api/knowledge';
import { createFetchContext } from '../../../src/router/context';
import { setKnowledgeEnabled } from '../../../src/knowledge';

const base = env as unknown as Env;
let n = 0;
const nextWs = () => `wsp_graph_${++n}_${Date.now()}`;

// A deterministic stand-in for the JSON-mode model: names it recognises become
// entities, "X is a client of Y" a relation, "budget is N" a fact — each quoting
// the sentence it came from, like the real prompt asks.
const NAMES = ['Acme Inc.', 'ACME', 'Northwind', 'Contoso'];
function fakeExtraction(user: string) {
  const out = { entities: [] as object[], relations: [] as object[], facts: [] as object[] };
  user.split(/\n\n(?=\[\d+\])/).forEach((block) => {
    const chunk = Number(/^\[(\d+)\]/.exec(block)?.[1]);
    for (const sentence of block.split(/(?<=\.)\s+(?=[A-Z])|\n/)) {
      for (const name of NAMES) {
        if (sentence.includes(name)) out.entities.push({ chunk, name, type: 'organization', quote: sentence.trim() });
      }
      const rel = /(\w[\w.]*(?: Inc\.)?) is a client of (\w+)/.exec(sentence);
      if (rel) out.relations.push({ chunk, from: rel[1], type: 'client of', to: rel[2], quote: sentence.trim() });
      const fact = /(\w+)'s budget is (\d+k)/.exec(sentence);
      if (fact) out.facts.push({ chunk, entity: fact[1], predicate: 'budget', value: fact[2], unit: 'USD', valid_from: '2026-01-01', quote: sentence.trim() });
    }
  });
  out.entities.push({ chunk: 0, name: 'Ghost Corp', type: 'Organization', quote: 'this sentence is not in the chunk' });
  return out;
}

function withModel(): Env {
  const AI = {
    run: vi.fn(async (_model: string, input: { text?: string[]; messages?: { role: string; content: string }[] }) => {
      if (input.text) return { data: input.text.map(() => [1, 0, 0]) };
      const user = input.messages!.find((m) => m.role === 'user')!.content;
      return { response: fakeExtraction(user), usage: { prompt_tokens: 1000, completion_tokens: 200 } };
    }),
  };
  return { ...base, AI } as unknown as Env;
}

beforeAll(async () => {
  for (const sql of [
    `CREATE TABLE IF NOT EXISTS knowledge_settings (workspace_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, last_consolidated_at TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS asset_deliverables (id TEXT PRIMARY KEY, bucket_artifact_id TEXT, workspace_id TEXT, owner_id TEXT NOT NULL, name TEXT NOT NULL, visibility TEXT NOT NULL DEFAULT 'workspace', folder_id TEXT, deleted_at TEXT, type_metadata TEXT)`,
    `CREATE TABLE IF NOT EXISTS blobs (id TEXT PRIMARY KEY, artifact_id TEXT, filename TEXT NOT NULL, mime_type TEXT NOT NULL, r2_key TEXT NOT NULL, size_bytes INTEGER NOT NULL, deliverable_id TEXT, version_no INTEGER)`,
    `CREATE TABLE IF NOT EXISTS ai_usage_events (id TEXT PRIMARY KEY, workspace_id TEXT, user_id TEXT, kind TEXT NOT NULL, model TEXT NOT NULL, units REAL NOT NULL DEFAULT 0, unit_kind TEXT NOT NULL, base_cost_micro_usd INTEGER NOT NULL DEFAULT 0, source TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`,
  ]) {
    await base.DB.exec(sql);
  }
});

beforeEach(() => {
  validateToken.mockReset().mockResolvedValue(null);
  getSessionUser.mockReset().mockResolvedValue({ id: 'u1', email: 'me@example.com' });
  getInternalWorkspaceRole.mockReset().mockResolvedValue('member');
});

async function putFile(e: Env, ws: string, id: string, text: string, opts: { owner?: string; visibility?: string; version?: number } = {}) {
  const v = opts.version ?? 1;
  const blobId = `blob_${id}_${v}`;
  await e.ARTIFACTS.put(`test/${blobId}`, text);
  await e.DB.prepare("INSERT OR IGNORE INTO asset_deliverables (id, workspace_id, owner_id, name, visibility) VALUES (?, ?, ?, ?, ?)")
    .bind(id, ws, opts.owner ?? 'u1', `${id}.md`, opts.visibility ?? 'workspace').run();
  await e.DB.prepare("INSERT INTO blobs (id, filename, mime_type, r2_key, size_bytes, deliverable_id, version_no) VALUES (?, ?, 'text/markdown', ?, ?, ?, ?)")
    .bind(blobId, `${id}.md`, `test/${blobId}`, text.length, id, v).run();
  await queueKnowledgeSource(e, undefined, { workspaceId: ws, kind: 'asset', refId: id }, blobId);
}

const execCtx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
async function get<T = unknown>(e: Env, ws: string, sub: string): Promise<{ status: number; body: T }> {
  const res = await routeKnowledgeApi(createFetchContext(
    new Request(`https://shareout.site/v1/workspaces/${ws}/knowledge/${sub}`, { headers: { Cookie: 'shareout_session=x' } }), e, execCtx,
  ));
  const text = await res!.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* markdown */ }
  return { status: res!.status, body: body as T };
}

type EntityList = { types: { type: string; count: number }[]; entities: { id: string; name: string; type: string; mentions: number; sources: { id: string }[] }[] };

describe('extraction validation', () => {
  const chunks = [{ ord: 3, text: 'Acme Inc. signed with Northwind in March.' }];

  it('keeps only items whose quote is really in their chunk', () => {
    const x = validateExtraction({
      entities: [
        { chunk: 0, name: 'Acme Inc.', type: 'organization', quote: 'acme inc. signed with' },
        { chunk: 0, name: 'Ghost', type: 'Organization', quote: 'not in the text at all' },
        { chunk: 7, name: 'Northwind', type: 'Organization', quote: 'Northwind in March' },
      ],
      relations: [
        { chunk: 0, from: 'Acme Inc.', type: 'Signed With', to: 'Northwind', quote: 'signed with Northwind' },
        { chunk: 0, from: 'Acme', type: 'same', to: 'ACME Inc', quote: 'Acme Inc. signed' },
      ],
      facts: [{ chunk: 0, entity: 'Acme', predicate: 'Signed On', value: 'March', valid_from: 'March', quote: 'in March.' }],
    }, chunks);
    expect(x.entities).toEqual([{ name: 'Acme Inc.', type: 'Organization', aliases: [], ord: 3, quote: 'acme inc. signed with' }]);
    expect(x.relations).toEqual([{ from: 'Acme Inc.', type: 'signed_with', to: 'Northwind', ord: 3, quote: 'signed with Northwind' }]);
    expect(x.facts[0]).toMatchObject({ predicate: 'signed_on', value: 'March', validFrom: null });
  });

  it('survives garbage model output', () => {
    expect(validateExtraction(null, chunks)).toEqual({ entities: [], relations: [], facts: [] });
    expect(validateExtraction({ entities: 'nope', relations: [1, null] }, chunks)).toEqual({ entities: [], relations: [], facts: [] });
  });

  it('normalizes names and types for merging', () => {
    expect(normalizeName('Acme Inc.')).toBe('acme');
    expect(normalizeName('ÁCME, S.A.')).toBe('acme');
    expect(normalizeType('organization')).toBe('Organization');
    expect(normalizeType('')).toBe('Other');
  });
});

describe('knowledge graph', () => {
  it('merges the same entity across Files and links facts and relations', async () => {
    const e = withModel();
    const ws = nextWs();
    await setKnowledgeEnabled(e, ws, true);
    await putFile(e, ws, 'dlv_g1', '# Accounts\n\nAcme Inc. is a client of Northwind. Acme\'s budget is 50k.');
    await putFile(e, ws, 'dlv_g2', 'Weekly notes: ACME asked for a new proposal.');

    const { body } = await get<EntityList>(e, ws, 'entities');
    const acme = body.entities.find((x) => x.name === 'Acme Inc.')!;
    expect(acme).toMatchObject({ type: 'Organization', mentions: 2 });
    expect(acme.sources.map((s) => s.id).sort()).toEqual(['dlv_g1', 'dlv_g2']);
    expect(body.entities.some((x) => x.name === 'Ghost Corp')).toBe(false);
    expect(body.types).toContainEqual({ type: 'Organization', count: 2 });

    const one = await get<{ facts: { predicate: string; value: string; source: { id: string } }[]; relations: { type: string; direction: string; other: { name: string } }[]; mentions: { cite: string }[] }>(e, ws, `entities/${acme.id}`);
    expect(one.body.facts).toEqual([expect.objectContaining({ predicate: 'budget', value: '50k', source: expect.objectContaining({ id: 'dlv_g1' }) })]);
    expect(one.body.relations).toEqual([expect.objectContaining({ type: 'client_of', direction: 'out', other: expect.objectContaining({ name: 'Northwind' }) })]);
    expect(one.body.mentions.map((m) => m.cite)).toContain('dlv_g1.md — Accounts');

    const md = await get<string>(e, ws, `entities/${acme.id}?format=md`);
    expect(md.body).toContain('# Acme Inc. (Organization)');
    expect(md.body).toContain('- budget: 50k USD (from 2026-01-01)');
    expect(md.body).toContain('- Acme Inc. client_of Northwind (Organization)');

    const g = await get<{ nodes: { name: string }[]; edges: { type: string }[] }>(e, ws, `graph?focus=${acme.id}&depth=1`);
    expect(g.body.nodes.map((x) => x.name).sort()).toEqual(['Acme Inc.', 'Northwind']);
    expect(g.body.edges).toEqual([expect.objectContaining({ type: 'client_of' })]);
  });

  it('hides entities whose only evidence is someone else’s private File', async () => {
    const e = withModel();
    const ws = nextWs();
    await setKnowledgeEnabled(e, ws, true);
    await putFile(e, ws, 'dlv_g3', 'Contoso is a client of Northwind.', { owner: 'u2', visibility: 'private' });
    const { body } = await get<EntityList>(e, ws, 'entities');
    expect(body.entities).toHaveLength(0);

    getSessionUser.mockResolvedValue({ id: 'u2', email: 'u2@example.com' });
    const owner = await get<EntityList>(e, ws, 'entities');
    const contoso = owner.body.entities.find((x) => x.name === 'Contoso')!;
    expect(contoso).toBeTruthy();

    getSessionUser.mockResolvedValue({ id: 'u1', email: 'me@example.com' });
    expect((await get(e, ws, `entities/${contoso.id}`)).status).toBe(404);
  });

  it('replaces a File’s evidence when it is re-learned, and forgets it when deleted', async () => {
    const e = withModel();
    const ws = nextWs();
    await setKnowledgeEnabled(e, ws, true);
    await putFile(e, ws, 'dlv_g4', "Northwind's budget is 10k.");
    await putFile(e, ws, 'dlv_g4', "Northwind's budget is 25k.", { version: 2 });
    await putFile(e, ws, 'dlv_g5', "Northwind is a client of Contoso. Northwind's budget is 30k.");
    const nw = async () => (await get<EntityList>(e, ws, 'entities')).body.entities.find((x) => x.name === 'Northwind');
    const facts = async (id: string) => (await get<{ facts: { value: string }[] }>(e, ws, `entities/${id}`)).body.facts.map((f) => f.value).sort();

    const before = (await nw())!;
    expect(before.sources.map((x) => x.id).sort()).toEqual(['dlv_g4', 'dlv_g5']);
    expect(await facts(before.id)).toEqual(['25k', '30k']); // v1's 10k is gone

    await e.DB.prepare("DELETE FROM asset_deliverables WHERE id = 'dlv_g5'").run();
    await queueKnowledgeSource(e, undefined, { workspaceId: ws, kind: 'asset', refId: 'dlv_g5' }, 'deleted');
    const after = (await nw())!;
    expect(after.sources.map((x) => x.id)).toEqual(['dlv_g4']);
    expect(await facts(after.id)).toEqual(['25k']);
    expect((await get<EntityList>(e, ws, 'entities')).body.entities.find((x) => x.name === 'Contoso')).toBeUndefined();
  });

  it('meters every extraction call at the model’s price', async () => {
    const e = withModel();
    const ws = nextWs();
    await setKnowledgeEnabled(e, ws, true);
    await putFile(e, ws, 'dlv_g6', 'Acme Inc. is a client of Northwind.');
    const row = await base.DB.prepare("SELECT model, units, unit_kind, base_cost_micro_usd AS cost FROM ai_usage_events WHERE workspace_id = ? AND kind = 'knowledge_extraction'")
      .bind(ws).first<{ model: string; units: number; unit_kind: string; cost: number }>();
    expect(row).toEqual({
      model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', units: 1200, unit_kind: 'tokens', cost: Math.round(1000 * 0.293 + 200 * 2.253),
    });
  });

  it('keeps the File searchable when extraction fails', async () => {
    const e = withModel();
    (e.AI as unknown as { run: ReturnType<typeof vi.fn> }).run.mockImplementation(async () => { throw new Error('JSON Mode couldn’t be met'); });
    const ws = nextWs();
    await setKnowledgeEnabled(e, ws, true);
    await putFile(e, ws, 'dlv_g7', 'Plain notes about the offsite.');
    const sources = await get<{ counts: { ready: number } }>(e, ws, 'sources');
    expect(sources.body.counts.ready).toBe(1);
  });
});
