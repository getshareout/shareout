// Backfill of the multilingual v2 index for one workspace, re-embedding what is already
// stored — chunk text in the workspace's KnowledgeStore, notes in D1 workspace_files, pages'
// name/description/tags in D1 — so nothing is fetched or re-parsed. Runs as a
// KnowledgeIngestWorkflow instance in `vectors` mode (no new binding), one retried step per
// batch with a pause between batches, so a handful of workspaces at once stay far under
// Workers AI's 3,000 embedding requests a minute; a rate-limit error is retried with backoff.
// Resumable and idempotent: chunks record their v2 model in the store, so a rerun or a new
// instance embeds only what is missing, and vector ids are deterministic, so a retried batch
// overwrites instead of duplicating. Batches are metered as knowledge_embedding, the
// instance's steps as knowledge_ingest — the same ledger as ingest.
import type { WorkflowStep, WorkflowStepConfig } from 'cloudflare:workers';
import type { Env } from '../../types';
import { parseNode } from '../parse';
import type { KnowledgeNode } from '../types';
import { corpusFor } from '../corpus/client';
import { meterKnowledge, PRICING } from '../corpus/usage';
import { configuredModel, embedTexts, readsPreferV2, V1_MODEL, V2_DIMENSIONS, v2Target, type V2Target } from './models';
import {
  artifactText, artifactVectorId, chunkVectorId, meterEmbedding, noteVectorId, v2Covers, v2Metadata,
  type VectorPass, type VectorState,
} from './v2';

export interface VectorBackfillParams {
  kind: 'vectors';
  workspaceId: string;
  /** The model the instance was started for; a config change since makes it a no-op. */
  model: string;
  /** Forget the workspace's v2 records first (the index was recreated). */
  reset?: boolean;
}

export const PASSES: VectorPass[] = ['chunks', 'notes', 'artifacts'];
/** Rows per step: two embedding calls of 32. */
export const BACKFILL_BATCH = 64;
/** Batches per instance (each plus a pause: ~4k of a Workflow's 10k steps); a bigger workspace continues on the next start. */
const MAX_BATCHES = 2_000;
const PACE = '1 second';
const BATCH_RETRY: WorkflowStepConfig = { retries: { limit: 6, delay: '10 seconds', backoff: 'exponential' }, timeout: '5 minutes' };
/** One instance per workspace and model per window: a second start while one runs joins it. */
const WINDOW_MS = 30 * 60_000;
const INLINE_BUDGET_MS = 20_000;
const SOURCE = 'vectors-backfill';
/** The notes v1 embeds (distill.ts, consolidate.ts): v2 holds the same set. */
const NOTE_KINDS = new Set(['artifact-digest', 'topic', 'entity', 'overview']);

export interface BatchResult {
  done: boolean;
  /** Cursor for the next batch: chunk row id, note path or artifact id. */
  after: string;
  embedded: number;
}

const noteText = (n: KnowledgeNode) => [n.title, n.topics.join(' '), n.body].filter(Boolean).join('\n');

async function chunkBatch(env: Env, t: V2Target, ws: string, after: string): Promise<BatchResult> {
  const store = corpusFor(env, ws);
  if (!store) return { done: true, after, embedded: 0 };
  const rows = await store.chunksToEmbed(t.model.id, Number(after) || 0, BACKFILL_BATCH);
  if (rows.length) {
    const texts = rows.map((r) => r.text);
    const values = await embedTexts(env, t.model, texts, 'document');
    await t.index.upsert(rows.map((r, i) => ({
      id: chunkVectorId(r.refId, r.ord), values: values[i], namespace: ws, metadata: v2Metadata(t.model, r.kind, r.refId),
    })));
    await store.markEmbedded(t.model.id, rows.map((r) => ({ refId: r.refId, ord: r.ord })));
    await meterEmbedding(env, ws, t.model, texts, SOURCE);
  }
  const done = rows.length < BACKFILL_BATCH;
  if (done) await store.setVectorPass('chunks', t.model.id);
  return { done, after: rows.length ? String(rows[rows.length - 1].id) : after, embedded: rows.length };
}

async function noteBatch(env: Env, t: V2Target, ws: string, after: string): Promise<BatchResult> {
  const rows = (await env.DB.prepare(
    "SELECT path, content FROM workspace_files WHERE workspace_id = ? AND namespace = 'knowledge' AND path > ? ORDER BY path LIMIT ?",
  ).bind(ws, after, BACKFILL_BATCH).all<{ path: string; content: string }>()).results || [];
  const notes = rows.map((r) => parseNode(r.path, r.content).node).filter((n): n is KnowledgeNode => !!n && NOTE_KINDS.has(n.kind));
  if (notes.length) {
    const texts = notes.map(noteText);
    const values = await embedTexts(env, t.model, texts, 'document');
    const ids = await Promise.all(notes.map((n) => noteVectorId(ws, n.path)));
    await t.index.upsert(notes.map((n, i) => ({
      id: ids[i], values: values[i], namespace: ws, metadata: v2Metadata(t.model, 'note', n.path, { note_kind: n.kind }),
    })));
    await meterEmbedding(env, ws, t.model, texts, SOURCE);
  }
  const done = rows.length < BACKFILL_BATCH;
  if (done) await corpusFor(env, ws)?.setVectorPass('notes', t.model.id);
  return { done, after: rows.length ? rows[rows.length - 1].path : after, embedded: notes.length };
}

async function artifactBatch(env: Env, t: V2Target, ws: string, after: string): Promise<BatchResult> {
  const rows = (await env.DB.prepare(
    `SELECT a.id, a.name, a.description,
            (SELECT GROUP_CONCAT(label, char(10)) FROM artifact_tags WHERE artifact_id = a.id) AS tags
       FROM artifacts a WHERE a.workspace_id = ? AND a.deleted_at IS NULL AND a.id > ? ORDER BY a.id LIMIT ?`,
  ).bind(ws, after, BACKFILL_BATCH).all<{ id: string; name: string; description: string | null; tags: string | null }>()).results || [];
  if (rows.length) {
    const texts = rows.map(artifactText);
    const values = await embedTexts(env, t.model, texts, 'document');
    await t.index.upsert(rows.map((r, i) => ({
      id: artifactVectorId(r.id), values: values[i], namespace: ws, metadata: v2Metadata(t.model, 'artifact', r.id),
    })));
    await meterEmbedding(env, ws, t.model, texts, SOURCE);
  }
  const done = rows.length < BACKFILL_BATCH;
  if (done) await corpusFor(env, ws)?.setVectorPass('artifacts', t.model.id);
  return { done, after: rows.length ? rows[rows.length - 1].id : after, embedded: rows.length };
}

/** One batch of one pass, starting after cursor `after` ('' = from the start). */
export function backfillBatch(env: Env, t: V2Target, ws: string, pass: VectorPass, after: string): Promise<BatchResult> {
  if (pass === 'chunks') return chunkBatch(env, t, ws, after);
  if (pass === 'notes') return noteBatch(env, t, ws, after);
  return artifactBatch(env, t, ws, after);
}

async function resetRecords(env: Env, ws: string): Promise<void> {
  await corpusFor(env, ws)?.resetVectors();
}

/** The Workflow body (corpus/workflow.ts): every pass, batch by batch, then the step count to the ledger. */
export async function runVectorBackfill(env: Env, p: VectorBackfillParams, step: WorkflowStep): Promise<void> {
  const t = v2Target(env);
  if (!t || t.model.id !== p.model) return;
  let steps = 0;
  if (p.reset) {
    await step.do('reset', () => resetRecords(env, p.workspaceId));
    steps++;
  }
  let batches = 0;
  for (const pass of PASSES) {
    let after = '';
    for (let i = 0; batches < MAX_BATCHES; i++, batches++) {
      const cursor = after;
      const r = await step.do(`${pass} ${i}`, BATCH_RETRY, () => backfillBatch(env, t, p.workspaceId, pass, cursor));
      steps++;
      if (r.done) break;
      after = r.after;
      await step.sleep(`${pass} ${i} pause`, PACE);
      steps++;
    }
  }
  steps++;
  await step.do('meter', () => meterKnowledge(env, p.workspaceId, 'knowledge_ingest', {
    model: 'workflow', units: steps, unitKind: 'workflow_steps', costMicroUsd: steps * PRICING.workflowStepMicroUsd, source: SOURCE,
  }));
}

/** Without Workflows: one bounded pass now. Chunks resume where it stopped; call again until done. */
export async function runVectorBackfillInline(env: Env, ws: string, opts: { reset?: boolean; budgetMs?: number } = {}): Promise<{ done: boolean; embedded: number }> {
  const t = v2Target(env);
  if (!t) return { done: false, embedded: 0 };
  if (opts.reset) await resetRecords(env, ws);
  const deadline = Date.now() + (opts.budgetMs ?? INLINE_BUDGET_MS);
  let embedded = 0;
  for (const pass of PASSES) {
    for (let after = ''; ;) {
      if (Date.now() > deadline) return { done: false, embedded };
      const r = await backfillBatch(env, t, ws, pass, after);
      embedded += r.embedded;
      if (r.done) break;
      after = r.after;
    }
  }
  return { done: true, embedded };
}

export function backfillInstanceId(ws: string, model: string, now: number, reset = false): string {
  const slug = (model.split('/').pop() ?? model).replace(/[^a-z0-9]+/gi, '-');
  return `vectors-${ws}-${slug}-${Math.floor(now / WINDOW_MS)}${reset ? '-reset' : ''}`;
}

export type BackfillStart =
  | { started: true; instance: string }
  | { started: false; reason: string; inline?: { done: boolean; embedded: number } };

/** Start (or join) the workspace's backfill; without Workflows, run a bounded pass inline. */
export async function startVectorBackfill(env: Env, ws: string, opts: { reset?: boolean; now?: number } = {}): Promise<BackfillStart> {
  const t = v2Target(env);
  if (!t) return { started: false, reason: v2Problem(env) ?? 'v2 is not configured' };
  if (!env.KNOWLEDGE_INGEST) {
    return { started: false, reason: 'no_workflows', inline: await runVectorBackfillInline(env, ws, { reset: opts.reset }) };
  }
  const id = backfillInstanceId(ws, t.model.id, opts.now ?? Date.now(), opts.reset);
  const params: VectorBackfillParams = { kind: 'vectors', workspaceId: ws, model: t.model.id, ...(opts.reset ? { reset: true } : {}) };
  // An existing id means this window's backfill already runs: joining it is not an error.
  await env.KNOWLEDGE_INGEST.create({ id, params }).catch(() => {});
  return { started: true, instance: id };
}

/** Start backfills for workspaces after `after`, by id (instance admin rollout). */
export async function startVectorBackfills(env: Env, opts: { after?: string; limit: number; reset?: boolean }): Promise<{ instances: string[]; next: string | null }> {
  const rows = (await env.DB.prepare('SELECT id FROM workspaces WHERE id > ? ORDER BY id LIMIT ?')
    .bind(opts.after ?? '', opts.limit).all<{ id: string }>()).results || [];
  const instances: string[] = [];
  for (const r of rows) {
    const s = await startVectorBackfill(env, r.id, { reset: opts.reset });
    if (s.started) instances.push(s.instance);
  }
  return { instances, next: rows.length === opts.limit ? rows[rows.length - 1].id : null };
}

/** The workspace has v2 gaps a backfill would fill: a chunk without a current vector, or a pass not run for the model. */
export function needsBackfill(state: VectorState, model: string): boolean {
  const total = Object.values(state.chunks).reduce((n, c) => n + c, 0);
  return (state.chunks[model] ?? 0) !== total || PASSES.some((p) => state.passes[p] !== model);
}

/** Why v2 is bound but unused, or null (unbound, or working). */
export function v2Problem(env: Env): string | null {
  if (!env.KNOWLEDGE_VECTORS_V2) return null;
  if (!env.AI) return 'the AI binding is missing';
  return configuredModel(env).problem;
}

type Reading = 'v1' | 'v2' | 'none';

export interface VectorStatus {
  v1: { model: string; dimensions: number; passages: boolean; notes_and_pages: boolean };
  v2: { bound: boolean; model: string | null; dimensions: number; active: boolean; problem: string | null };
  /** KNOWLEDGE_VECTORS_READ as applied: reads prefer v2 (or there is no v1 index). */
  read: 'v1' | 'v2';
  workspace: {
    chunks: { total: number; by_model: Record<string, number>; missing: number };
    passes: Record<string, string>;
    reading: Record<VectorPass, Reading>;
    /** Vectors of more than one model, or of a model other than the configured one. */
    mixed: boolean;
  } | null;
}

/** What this instance writes and reads, and where this workspace's v2 vectors stand. */
export async function vectorStatus(env: Env, ws: string): Promise<VectorStatus> {
  const t = v2Target(env);
  const { model } = configuredModel(env);
  const store = corpusFor(env, ws);
  const state = store ? await store.vectorState() : null;
  const v1For: Record<VectorPass, unknown> = { chunks: env.KNOWLEDGE_VECTORS, notes: env.VECTORIZE, artifacts: env.VECTORIZE };
  const reading = (pass: VectorPass): Reading => {
    const v1 = v1For[pass];
    if (t && readsPreferV2(env, v1) && (!v1 || (state && v2Covers(state, pass, t.model.id)))) return 'v2';
    return v1 && env.AI ? 'v1' : 'none';
  };
  let workspace: VectorStatus['workspace'] = null;
  if (state) {
    const total = Object.values(state.chunks).reduce((n, c) => n + c, 0);
    const byModel = Object.fromEntries(Object.entries(state.chunks).map(([m, n]) => [m || 'none', n]));
    const models = new Set([...Object.keys(state.chunks).filter(Boolean), ...Object.values(state.passes)]);
    workspace = {
      chunks: { total, by_model: byModel, missing: t ? total - (state.chunks[t.model.id] ?? 0) : total },
      passes: state.passes,
      reading: { chunks: reading('chunks'), notes: reading('notes'), artifacts: reading('artifacts') },
      mixed: models.size > 1 || (!!t && models.size === 1 && !models.has(t.model.id)),
    };
  }
  return {
    v1: { model: V1_MODEL.id, dimensions: V1_MODEL.dimensions, passages: !!env.KNOWLEDGE_VECTORS, notes_and_pages: !!env.VECTORIZE },
    v2: { bound: !!env.KNOWLEDGE_VECTORS_V2, model: env.KNOWLEDGE_VECTORS_V2 ? model.id : null, dimensions: V2_DIMENSIONS, active: !!t, problem: v2Problem(env) },
    read: t && readsPreferV2(env, env.KNOWLEDGE_VECTORS) ? 'v2' : 'v1',
    workspace,
  };
}
