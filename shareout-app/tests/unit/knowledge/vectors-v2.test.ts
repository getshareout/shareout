// The multilingual v2 index end to end, on the real KnowledgeStore and D1 schema: dual-write
// from ingest into one namespace per workspace with kind/source/model metadata, reads that stay
// on v1 until a workspace is covered (and fall back when v2 answers nothing), a resumable and
// idempotent backfill (inline and as a Workflow), mixed-model detection, notes and pages.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { applyMigrations, e } from '../helpers/migrated-db';
import type { Env } from '../../../src/types';
import { corpusFor } from '../../../src/knowledge/corpus/client';
import { finishStep, queueKnowledgeSource } from '../../../src/knowledge/corpus/ingest';
import { searchCorpus } from '../../../src/knowledge/corpus/search';
import { runCorpusRefresh, REFRESH_MAX_VECTOR_BACKFILLS } from '../../../src/knowledge/corpus/reindex';
import { KnowledgeIngestWorkflow } from '../../../src/knowledge/corpus/workflow';
import { setKnowledgeEnabled, upsertKnowledgeFile } from '../../../src/knowledge';
import { deleteKnowledgeVector, upsertKnowledgeVector } from '../../../src/knowledge/distill';
import { BGE_BASE, BGE_M3, EMBED_MODELS, QWEN3_EMBEDDING } from '../../../src/knowledge/vectors/models';
import {
  backfillInstanceId, needsBackfill, runVectorBackfillInline, startVectorBackfill, startVectorBackfills, vectorStatus,
} from '../../../src/knowledge/vectors/backfill';
import { artifactIdsV2, notePathsV2 } from '../../../src/knowledge/vectors/v2';
import { indexArtifactVector, removeArtifactVector } from '../../../src/search/semantic';
import { embedded, fakeAi, FakeVectorize } from '../helpers/fake-vectors';

const OWNER = 'usr_vec_owner';
const MEMBER = 'usr_vec_member';
const OTHER = 'usr_vec_other';
let n = 0;

beforeAll(async () => {
  await applyMigrations();
  await e.DB.prepare("INSERT INTO users (id, email, name) VALUES (?, 'owner@vec.example', 'Owner'), (?, 'member@vec.example', 'Member'), (?, 'other@vec.example', 'Other')")
    .bind(OWNER, MEMBER, OTHER).run();
});

async function newWorkspace(): Promise<string> {
  const ws = `wsp_vec_${++n}`;
  await e.DB.prepare('INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, ?, ?, ?)').bind(ws, ws, `vec-${n}`, OWNER).run();
  await setKnowledgeEnabled(e, ws, true);
  return ws;
}

/** A workspace page with one passage per section. */
async function publishPage(
  env: Env, ws: string, id: string, sections: string[], name = id,
  opts: { owner?: string; visibility?: string; held?: boolean } = {},
): Promise<void> {
  const html = `<!doctype html><html><body><h1>${name}</h1>${sections.map((s, i) => `<h2>Section ${i}</h2><p>${s}</p>`).join('')}</body></html>`;
  const key = `test/vec/${id}/index.html`;
  await e.ARTIFACTS.put(key, html);
  await e.DB.batch([
    e.DB.prepare('INSERT INTO artifacts (id, owner_id, name, slug, visibility, workspace_id) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, opts.owner ?? OWNER, name, id, opts.visibility ?? 'workspace', ws),
    ...(opts.held ? [e.DB.prepare("INSERT INTO artifact_moderation (artifact_id, status) VALUES (?, 'pending')").bind(id)] : []),
    e.DB.prepare("INSERT INTO versions (id, artifact_id, version_no, entrypoint) VALUES (?, ?, 1, 'index.html')").bind(`ver_${id}`, id),
    e.DB.prepare("INSERT INTO deployments (id, artifact_id, version_id, channel, slug) VALUES (?, ?, ?, 'production', ?)").bind(`dep_${id}`, id, `ver_${id}`, id),
    e.DB.prepare("INSERT INTO assets (id, version_id, path, r2_key, mime, size_bytes, sha256) VALUES (?, ?, 'index.html', ?, 'text/html', ?, 'x')")
      .bind(`ast_${id}`, `ver_${id}`, key, html.length),
  ]);
  await queueKnowledgeSource(env, undefined, { workspaceId: ws, kind: 'page', refId: id }, `ver_${id}`);
}

function vecEnv(opts: { v1?: FakeVectorize; v2?: FakeVectorize; notes?: FakeVectorize; model?: string; read?: string } = {}) {
  const ai = fakeAi();
  const env = {
    ...e, AI: ai, KNOWLEDGE_VECTORS: opts.v1, KNOWLEDGE_VECTORS_V2: opts.v2, VECTORIZE: opts.notes,
    KNOWLEDGE_EMBED_MODEL: opts.model, KNOWLEDGE_VECTORS_READ: opts.read,
  } as unknown as Env;
  return { env, ai };
}

const ledger = async (ws: string, kind: string) =>
  (await e.DB.prepare('SELECT model, units, unit_kind, base_cost_micro_usd AS cost, source FROM ai_usage_events WHERE workspace_id = ? AND kind = ? ORDER BY rowid')
    .bind(ws, kind).all<{ model: string; units: number; unit_kind: string; cost: number; source: string | null }>()).results;
const lastSearchModel = async (ws: string) => (await ledger(ws, 'knowledge_search')).at(-1)?.model;
const state = (env: Env, ws: string) => corpusFor(env, ws)!.vectorState();
const sectionsOf = (count: number) => Array.from({ length: count }, (_, i) => `fact number ${i} about item${i}`);

describe('dual-write from ingest', () => {
  it('writes each passage to v1 and into the workspace namespace of v2, recording the model per chunk', async () => {
    const ws = await newWorkspace();
    const v1 = new FakeVectorize();
    const v2 = new FakeVectorize();
    const { env, ai } = vecEnv({ v1, v2, model: BGE_M3 });
    const id = `art_vec_dual_${n}`;
    await publishPage(env, ws, id, ['alpha beta', 'gamma delta', 'epsilon zeta']);

    expect([...v1.rows.values()].map((r) => [r.id, r.namespace, r.metadata])).toEqual([0, 1, 2].map((o) => [`${id}:${o}`, ws, undefined]));
    expect(v2.inNamespace(ws).map((r) => [r.id, r.metadata])).toEqual(
      [0, 1, 2].map((o) => [`${id}:${o}`, { source_kind: 'page', source_id: id, embed_model: BGE_M3 }]),
    );
    expect(ai.calls.map((c) => [c.model, Object.keys(c.input)])).toEqual([[BGE_BASE, ['text']], [BGE_M3, ['text']]]);
    expect((await state(env, ws)).chunks).toEqual({ [BGE_M3]: 3 });

    const metered = await ledger(ws, 'knowledge_embedding');
    expect(metered.map((r) => r.model)).toEqual([BGE_BASE, BGE_M3]);
    for (const r of metered) expect(r.cost).toBe(Math.round(r.units * EMBED_MODELS[r.model].tokenMicroUsd));
  });

  it('a failed v2 write never fails ingest while v1 is read; its chunks stay open for the backfill', async () => {
    const ws = await newWorkspace();
    const v1 = new FakeVectorize();
    const v2 = Object.assign(new FakeVectorize(), { failUpsert: true });
    const { env } = vecEnv({ v1, v2, model: BGE_M3 });
    const id = `art_vec_fail_${n}`;
    await publishPage(env, ws, id, ['one', 'two']);
    expect((await corpusFor(env, ws)!.getSource(id))?.status).toBe('ready');
    expect(v1.rows.size).toBe(2);
    expect((await state(env, ws)).chunks).toEqual({ '': 2 });
  });

  it('once reads are cut over, v2 is the write that must succeed', async () => {
    const ws = await newWorkspace();
    const v2 = Object.assign(new FakeVectorize(), { failUpsert: true });
    const { env } = vecEnv({ v1: new FakeVectorize(), v2, model: BGE_M3, read: 'v2' });
    const id = `art_vec_primary_${n}`;
    await publishPage(env, ws, id, ['one', 'two']);
    expect((await corpusFor(env, ws)!.getSource(id))?.status).toBe('failed');
  });

  it('drops stale passages from both indexes, in deletes of at most 100 ids', async () => {
    const v1 = new FakeVectorize();
    const v2 = new FakeVectorize();
    const { env } = vecEnv({ v1, v2, model: BGE_M3 });
    await finishStep(env, { workspaceId: 'wsp_vec_gone', kind: 'asset', refId: 'dlv_vec_gone' }, { status: 'gone', chunkCount: 0, previousCount: 250 }).catch(() => {});
    expect(v1.deletes.map((d) => d.length)).toEqual([100, 100, 50]);
    expect(v2.deletes.map((d) => d.length)).toEqual([100, 100, 50]);
  });
});

describe('reads', () => {
  it('stay on v1 until the workspace is covered, then query v2 inside its namespace by kind and model', async () => {
    const ws = await newWorkspace();
    const v1 = new FakeVectorize();
    const id = `art_vec_read_${n}`;
    await publishPage(vecEnv({ v1 }).env, ws, id, ['alpha beta', 'gamma delta', 'epsilon zeta']);
    const v2 = new FakeVectorize();
    const { env } = vecEnv({ v1, v2, model: BGE_M3, read: 'v2' });

    await searchCorpus(env, ws, MEMBER, 'gamma');
    expect(v2.queries).toEqual([]);
    expect(await lastSearchModel(ws)).toBe(BGE_BASE);
    expect((await vectorStatus(env, ws)).workspace).toMatchObject({ chunks: { total: 3, missing: 3 }, reading: { chunks: 'v1' } });

    expect(await runVectorBackfillInline(env, ws)).toEqual({ done: true, embedded: 4 }); // 3 passages + the page
    const after = await vectorStatus(env, ws);
    expect(after.workspace).toMatchObject({
      chunks: { missing: 0, by_model: { [BGE_M3]: 3 } },
      passes: { chunks: BGE_M3, notes: BGE_M3, artifacts: BGE_M3 },
      reading: { chunks: 'v2', notes: 'v2', artifacts: 'v2' }, // no VECTORIZE here: nothing else to read
      mixed: false,
    });
    expect(after).toMatchObject({ read: 'v2', v2: { bound: true, active: true, model: BGE_M3, problem: null } });

    const r = await searchCorpus(env, ws, MEMBER, 'gamma delta');
    expect(v2.queries).toEqual([{
      topK: 30, namespace: ws, filter: { source_kind: { $in: ['page', 'asset'] }, embed_model: BGE_M3 }, returnMetadata: 'none',
    }]);
    expect(r.mode).toBe('hybrid');
    expect(r.hits[0]).toMatchObject({ source: { id } });
    expect(r.hits[0].text).toContain('gamma delta');
    expect(await lastSearchModel(ws)).toBe(BGE_M3);
  });

  it('fall back to v1 when v2 answers nothing (an index recreated, or writes not visible yet)', async () => {
    const ws = await newWorkspace();
    const v1 = new FakeVectorize();
    const v2 = new FakeVectorize();
    const { env } = vecEnv({ v1, v2, model: BGE_M3, read: 'v2' });
    const id = `art_vec_empty_${n}`;
    await publishPage(env, ws, id, ['alpha beta', 'gamma delta']);
    v2.rows.clear();

    const r = await searchCorpus(env, ws, MEMBER, 'zzz unrelated words');
    expect(v2.queries).toHaveLength(1);
    expect(await lastSearchModel(ws)).toBe(BGE_BASE);
    expect(r.mode).toBe('hybrid');
    expect(r.hits.map((h) => h.source.id)).toContain(id); // by meaning, from v1
  });

  it('read v2 even while partial when there is no v1 index to fall back to (default model: bge-m3)', async () => {
    const ws = await newWorkspace();
    const v2 = new FakeVectorize();
    const { env } = vecEnv({ v2 });
    await publishPage(env, ws, `art_vec_only_${n}`, ['alpha beta']);
    await searchCorpus(env, ws, MEMBER, 'alpha');
    expect(v2.queries).toHaveLength(1);
    expect(await lastSearchModel(ws)).toBe(BGE_M3);
  });
});

describe('backfill', () => {
  it('resumes where it stopped and never embeds a passage twice', async () => {
    const ws = await newWorkspace();
    const id = `art_vec_resume_${n}`;
    await publishPage(vecEnv({ v1: new FakeVectorize() }).env, ws, id, sectionsOf(150));
    const v2 = new FakeVectorize();
    const { env, ai } = vecEnv({ v2, model: BGE_M3, v1: new FakeVectorize() });

    ai.failAfter = 2; // the first batch (2 calls of 32) lands, then Workers AI rate-limits
    await expect(runVectorBackfillInline(env, ws)).rejects.toThrow(/Capacity/);
    expect((await state(env, ws)).chunks).toEqual({ [BGE_M3]: 64, '': 86 });
    expect(v2.inNamespace(ws)).toHaveLength(64);

    ai.failAfter = null;
    expect(await runVectorBackfillInline(env, ws)).toEqual({ done: true, embedded: 87 }); // 86 passages + the page
    const passages = embedded(ai.calls, BGE_M3).filter((t) => t.includes('fact number'));
    expect(passages).toHaveLength(150);
    expect(new Set(passages).size).toBe(150);
    expect((await state(env, ws)).chunks).toEqual({ [BGE_M3]: 150 });

    const calls = ai.calls.length;
    await runVectorBackfillInline(env, ws);
    expect(embedded(ai.calls.slice(calls), BGE_M3).filter((t) => t.includes('fact number'))).toEqual([]);
    expect(v2.inNamespace(ws)).toHaveLength(151);
    const metered = await ledger(ws, 'knowledge_embedding');
    expect(metered.filter((r) => r.source === 'vectors-backfill' && r.model === BGE_M3).length).toBeGreaterThan(0);
  });

  it('reset forgets the records, so a recreated index is filled again', async () => {
    const ws = await newWorkspace();
    const v2 = new FakeVectorize();
    const { env } = vecEnv({ v2, model: BGE_M3 });
    await publishPage(env, ws, `art_vec_reset_${n}`, ['one', 'two']);
    v2.rows.clear();
    expect(await runVectorBackfillInline(env, ws)).toMatchObject({ embedded: 1 }); // only the page: passages look done
    expect(await runVectorBackfillInline(env, ws, { reset: true })).toEqual({ done: true, embedded: 3 });
    expect(v2.inNamespace(ws)).toHaveLength(3);
  });

  it('runs as a paced, metered Workflow and does nothing for a model it was not started for', async () => {
    const ws = await newWorkspace();
    const v2 = new FakeVectorize();
    const { env } = vecEnv({ v2, model: BGE_M3 });
    await publishPage(vecEnv().env, ws, `art_vec_wf_${n}`, sectionsOf(70));
    await upsertKnowledgeFile(env, ws, { path: 'topics/pricing.md', content: '---\nkind: topic\nid: topic.pricing\ntitle: Pricing\n---\nPrices rise in March.' });

    const names: string[] = [];
    const step = {
      do: vi.fn(async (name: string, a: unknown, b?: unknown) => { names.push(name); return (typeof a === 'function' ? a : b as () => unknown)(); }),
      sleep: vi.fn(async (name: string) => { names.push(`sleep:${name}`); }),
    };
    const wf = Object.create(KnowledgeIngestWorkflow.prototype) as KnowledgeIngestWorkflow;
    (wf as unknown as { env: Env }).env = env;
    await wf.run({ payload: { kind: 'vectors', workspaceId: ws, model: QWEN3_EMBEDDING } } as never, step as never);
    expect(names).toEqual([]);

    await wf.run({ payload: { kind: 'vectors', workspaceId: ws, model: BGE_M3 } } as never, step as never);
    expect(names).toEqual(['chunks 0', 'sleep:chunks 0 pause', 'chunks 1', 'notes 0', 'artifacts 0', 'meter']);
    expect(v2.inNamespace(ws).map((r) => r.metadata?.source_kind).sort()).toEqual([...Array(70).fill('page'), 'artifact', 'note'].sort());
    expect(await ledger(ws, 'knowledge_ingest')).toContainEqual(expect.objectContaining({ model: 'workflow', unit_kind: 'workflow_steps', units: 6, source: 'vectors-backfill' }));
  });

  it('starts one Workflow instance per workspace, model and window', async () => {
    const created: { id: string; params: unknown }[] = [];
    const { env } = vecEnv({ v2: new FakeVectorize(), model: QWEN3_EMBEDDING });
    const withWf = { ...env, KNOWLEDGE_INGEST: { create: async (o: { id: string; params: unknown }) => { created.push(o); } } } as unknown as Env;
    const ws = 'wsp_0123456789abcdef01234567';
    const r = await startVectorBackfill(withWf, ws, { now: 1_800_000 * 1000, reset: true });
    expect(r).toEqual({ started: true, instance: `vectors-${ws}-qwen3-embedding-0-6b-1000-reset` });
    expect(created[0].params).toEqual({ kind: 'vectors', workspaceId: ws, model: QWEN3_EMBEDDING, reset: true });
    expect(backfillInstanceId(ws, QWEN3_EMBEDDING, Date.now(), true).length).toBeLessThanOrEqual(100);
    expect(await startVectorBackfill(vecEnv().env, ws)).toMatchObject({ started: false, reason: 'v2 is not configured' });

    const page = await startVectorBackfills(withWf, { after: '', limit: 2 });
    expect(page.instances).toHaveLength(2);
    expect(page.next).toEqual(expect.any(String));
  });

  it('the nightly refresh starts a few backfills for workspaces with v2 gaps', async () => {
    const create = vi.fn(async () => ({}));
    const { env } = vecEnv({ v1: new FakeVectorize(), v2: new FakeVectorize(), model: QWEN3_EMBEDDING });
    const r = await runCorpusRefresh({ ...env, KNOWLEDGE_INGEST: { create } } as unknown as Env);
    expect(r.vectorBackfills).toBeGreaterThan(0);
    expect(r.vectorBackfills).toBeLessThanOrEqual(REFRESH_MAX_VECTOR_BACKFILLS);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ params: expect.objectContaining({ kind: 'vectors', model: QWEN3_EMBEDDING }) }));
  });
});

describe('mixed models', () => {
  it('are detected, never ranked against each other, and healed by a backfill', async () => {
    const ws = await newWorkspace();
    const v1 = new FakeVectorize();
    const v2 = new FakeVectorize();
    const id = `art_vec_mixed_${n}`;
    await publishPage(vecEnv({ v1, v2, model: BGE_M3 }).env, ws, id, ['alpha beta', 'gamma delta']);
    await runVectorBackfillInline(vecEnv({ v1, v2, model: BGE_M3 }).env, ws);

    // The operator switches models: every v2 vector is now from the other one.
    const { env, ai } = vecEnv({ v1, v2, model: QWEN3_EMBEDDING, read: 'v2' });
    const s = await vectorStatus(env, ws);
    expect(s.workspace).toMatchObject({ mixed: true, chunks: { total: 2, missing: 2, by_model: { [BGE_M3]: 2 } }, reading: { chunks: 'v1' } });
    expect(needsBackfill(await state(env, ws), QWEN3_EMBEDDING)).toBe(true);
    await searchCorpus(env, ws, MEMBER, 'gamma');
    expect(v2.queries).toEqual([]);
    expect(await lastSearchModel(ws)).toBe(BGE_BASE);

    // Without v1 to fall back to, v2 is read, but only the configured model's vectors rank.
    const only = vecEnv({ v2, model: QWEN3_EMBEDDING });
    const partial = await searchCorpus(only.env, ws, MEMBER, 'gamma delta');
    expect(v2.queries.at(-1)?.filter).toEqual({ source_kind: { $in: ['page', 'asset'] }, embed_model: QWEN3_EMBEDDING });
    expect(only.ai.calls.at(-1)?.input).toEqual({ queries: ['gamma delta'] });
    expect(partial.hits.map((h) => h.source.id)).toEqual([id]); // the keyword hit only

    await runVectorBackfillInline(env, ws);
    expect(ai.calls.filter((c) => c.model === QWEN3_EMBEDDING).every((c) => Object.keys(c.input)[0] === 'documents')).toBe(true);
    expect((await vectorStatus(env, ws)).workspace).toMatchObject({ mixed: false, chunks: { missing: 0, by_model: { [QWEN3_EMBEDDING]: 2 } }, reading: { chunks: 'v2' } });
  });
});

describe('notes and pages', () => {
  const TOPIC = '---\nkind: topic\nid: topic.retention\ntitle: Retention\ntopics: [retention]\n---\nDay-0 retention is 42%.';

  it('a note lands in the workspace namespace under a hashed id of at most 64 bytes, and is deleted from both indexes', async () => {
    const ws = await newWorkspace();
    const v2 = new FakeVectorize();
    const notes = new FakeVectorize();
    const { env } = vecEnv({ v2, notes, model: BGE_M3 });
    const path = 'artifacts/art_0123456789abcdef01234567.md';
    await upsertKnowledgeVector(env, ws, path, 'artifact-digest', 'Acme retention digest');
    const [row] = v2.inNamespace(ws);
    expect(row.id).toMatch(/^n:[0-9a-f]{40}$/);
    expect(row.metadata).toEqual({ source_kind: 'note', source_id: path, embed_model: BGE_M3, note_kind: 'artifact-digest' });
    await deleteKnowledgeVector(env, ws, path);
    expect(v2.rows.size).toBe(0);
    expect(notes.deletes).toEqual([[`kn:${ws}:${path}`]]);
  });

  it('notes and pages are read from v2 once their backfill pass ran, never personal pages', async () => {
    const ws = await newWorkspace();
    const v2 = new FakeVectorize();
    const notes = new FakeVectorize();
    const { env } = vecEnv({ v2, notes, v1: new FakeVectorize(), model: BGE_M3, read: 'v2' });
    await upsertKnowledgeFile(env, ws, { path: 'topics/retention.md', content: TOPIC });
    const id = `art_vec_page_${n}`;
    await e.DB.prepare("INSERT INTO artifacts (id, owner_id, name, slug, visibility, workspace_id, description) VALUES (?, ?, 'Retention dashboard', ?, 'workspace', ?, 'cohort retention')")
      .bind(id, OWNER, id, ws).run();
    const personal = `art_vec_personal_${n}`;
    await e.DB.prepare("INSERT INTO artifacts (id, owner_id, name, slug, visibility) VALUES (?, ?, 'My retention notes', ?, 'private')").bind(personal, OWNER, personal).run();

    await indexArtifactVector(env, id);
    await indexArtifactVector(env, personal);
    expect(v2.inNamespace(ws).map((r) => [r.id, r.metadata?.source_kind])).toEqual([[`a:${id}`, 'artifact']]);
    expect([...notes.rows.keys()].sort()).toEqual([id, personal].sort());

    expect(await notePathsV2(env, ws, 'retention', 15)).toBeNull(); // not covered yet: v1 answers
    expect(await artifactIdsV2(env, ws, 'retention', 40)).toBeNull();
    await runVectorBackfillInline(env, ws);
    expect(await notePathsV2(env, ws, 'retention', 15)).toEqual(['topics/retention.md']);
    expect(await artifactIdsV2(env, ws, 'retention dashboard', 40)).toEqual([id]);
    expect(v2.queries.at(-1)).toMatchObject({ namespace: ws, filter: { source_kind: 'artifact', embed_model: BGE_M3 } });

    await removeArtifactVector(env, id);
    expect(v2.rows.has(`a:${id}`)).toBe(false);
  });
});

describe('dense candidates for the member asking', () => {
  it('ingest records who may see each source, and the store counts what is hidden from whom', async () => {
    const ws = await newWorkspace();
    const { env } = vecEnv();
    await publishPage(env, ws, `art_vec_seen_${n}`, ['open to everyone']);
    await publishPage(env, ws, `art_vec_mine_${n}`, ['only for other'], undefined, { owner: OTHER, visibility: 'private' });
    await publishPage(env, ws, `art_vec_held_${n}`, ['waiting for review'], undefined, { held: true });
    const store = corpusFor(env, ws)!;
    expect(await store.hiddenCount(MEMBER)).toBe(2);
    expect(await store.hiddenCount(OTHER)).toBe(1); // held for moderation: hidden from its owner too
  });

  for (const index of ['v1', 'v2'] as const) {
    it(`${index}: another member's private copies don't crowd the dense pool — more are fetched, D1 keeps the visible ones`, async () => {
      const ws = await newWorkspace();
      const fake = new FakeVectorize();
      const { env } = vecEnv(index === 'v1' ? { v1: fake } : { v2: fake });
      const visible = `art_vec_crowd_${index}_${n}`;
      await publishPage(env, ws, visible, ['zeta omega quarterly figures']);
      // 40 nearer passages in another member's private page: more than a plain fetch (30) holds.
      await publishPage(env, ws, `art_vec_copies_${index}_${n}`, Array(40).fill('zeta omega'), 'Z', { owner: OTHER, visibility: 'private' });

      const r = await searchCorpus(env, ws, MEMBER, 'zeta omega');
      const asked = fake.queries.at(-1)!;
      expect(asked.topK).toBe(100);
      expect(asked.filter?.source_id).toBeUndefined(); // nothing left out on the store's say-so
      expect(r.hits.map((h) => h.source.id)).toEqual([visible]);
      // First in both lists as the member sees them: the 40 private copies took no dense slot.
      expect(r.hits[0].score).toBe(Number((2 / 61).toFixed(4)));

      await searchCorpus(env, ws, OTHER, 'zeta omega');
      expect(fake.queries.at(-1)!.topK).toBe(30); // nothing hidden from the copies' owner
    });
  }
});
