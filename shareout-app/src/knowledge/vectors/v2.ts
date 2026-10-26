// The multilingual index, KNOWLEDGE_VECTORS_V2: one Vectorize namespace per workspace holding
// every vector kind — corpus passages (`page` / `asset` chunks), knowledge notes (`note`) and
// workspace pages (`artifact`) — told apart by metadata. Metadata indexes (wrangler.toml), all
// created before any vector is written, since Vectorize only indexes vectors written after:
//   source_kind  page | asset | note | artifact — a query ranks one kind, not the whole namespace
//   source_id    the page/File id, note path or artifact id — source-scoped queries and
//                exclusions computed at query time
//   embed_model  the model that made the vector — while a model switch is backfilled the
//                namespace holds two models, and cosine across models means nothing
// Visibility and owner are not indexed on purpose: they change in place (visibility edits,
// folder moves, moderation, ownership transfer) without a re-embed, so a filter on them would
// silently drop pages that were just shared. Vectorize is never trusted for access: every
// caller re-checks hits in D1. Reads stay on v1 for a workspace until its v2 vectors are
// complete for the configured model (v2Covers).
import type { Env } from '../../types';
import { sha256 } from '../../crypto-utils';
import { createLogger, logError } from '../../logging';
import { corpusFor } from '../corpus/client';
import { meterKnowledge, PRICING } from '../corpus/usage';
import { EMBED_TEXT_CAP, embedTexts, estimateTokens, readsPreferV2, V1_MODEL, v2Target, type EmbedModel, type V2Target } from './models';

export type V2Kind = 'page' | 'asset' | 'note' | 'artifact';
/** Backfill passes, and what a read needs covered. */
export type VectorPass = 'chunks' | 'notes' | 'artifacts';

export interface VectorState {
  /** Chunks per v2 model ('' = no v2 vector). */
  chunks: Record<string, number>;
  /** Finished backfill passes: pass → model. */
  passes: Record<string, string>;
}

type Store = NonNullable<ReturnType<typeof corpusFor>>;

/** Vectorize takes at most 100 ids per delete (error 40007 past that). */
export const DELETE_BATCH = 100;

// Ids are unique per index, not per namespace, and at most 64 bytes.
export const chunkVectorId = (refId: string, ord: number) => `${refId}:${ord}`;
export const artifactVectorId = (artifactId: string) => `a:${artifactId}`;
/** A note path is neither globally unique nor bounded: hash it with the workspace. */
export async function noteVectorId(workspaceId: string, path: string): Promise<string> {
  return `n:${(await sha256(new TextEncoder().encode(`${workspaceId}\n${path}`).buffer as ArrayBuffer)).slice(0, 40)}`;
}

export function v2Metadata(model: EmbedModel, kind: V2Kind, sourceId: string, extra: Record<string, string> = {}) {
  return { source_kind: kind, source_id: sourceId, embed_model: model.id, ...extra };
}

const keyOf = (id: string) => {
  const i = id.lastIndexOf(':');
  return { refId: id.slice(0, i), ord: Number(id.slice(i + 1)) };
};

export function warnV2(env: Env, message: string, err: unknown, fields: Record<string, unknown> = {}): void {
  logError(createLogger(env, { scope: 'knowledge-vectors' }), message, err, fields);
}

/** Every v2 vector of `pass`'s kinds is from `model` (passages: also when every chunk is). */
export function v2Covers(state: VectorState, pass: VectorPass, model: string): boolean {
  if (state.passes[pass] === model) return true;
  if (pass !== 'chunks') return false;
  const total = Object.values(state.chunks).reduce((n, c) => n + c, 0);
  return (state.chunks[model] ?? 0) === total;
}

/**
 * The v2 index when this workspace's reads of `pass` should use it: v2 is configured, reads
 * prefer it (KNOWLEDGE_VECTORS_READ=v2, or no v1 index), and the workspace's v2 vectors cover
 * the configured model. With no v1 index to fall back to, a partial v2 still beats keyword-only.
 */
export async function readTargetV2(env: Env, workspaceId: string, pass: VectorPass, v1: unknown, store?: Store | null): Promise<V2Target | null> {
  const t = v2Target(env);
  if (!t || !readsPreferV2(env, v1)) return null;
  if (!v1) return t;
  const s = store ?? corpusFor(env, workspaceId);
  if (!s) return null;
  return v2Covers(await s.vectorState(), pass, t.model.id) ? t : null;
}

/** Nearest v2 vectors of `kinds` in the workspace's namespace, made by the configured model. */
export async function queryV2(
  env: Env,
  t: V2Target,
  workspaceId: string,
  q: string,
  opts: { kinds: V2Kind[]; topK: number; metadata?: boolean },
): Promise<VectorizeMatch[]> {
  const [values] = await embedTexts(env, t.model, [q], 'query');
  const res = await t.index.query(values, {
    topK: opts.topK,
    namespace: workspaceId,
    filter: { source_kind: opts.kinds.length === 1 ? opts.kinds[0] : { $in: opts.kinds }, embed_model: t.model.id },
    returnMetadata: opts.metadata ? 'all' : 'none',
  });
  return res.matches || [];
}

export function meterEmbedding(env: Env, workspaceId: string, model: EmbedModel, texts: string[], source: string): Promise<void> {
  const tokens = estimateTokens(texts.map((t) => t.slice(0, EMBED_TEXT_CAP)));
  return meterKnowledge(env, workspaceId, 'knowledge_embedding', {
    model: model.id, units: tokens, unitKind: 'tokens', costMicroUsd: tokens * model.tokenMicroUsd, source,
  });
}

/** One semantic query: its embedding plus the queried dimensions. */
export const queryCostMicroUsd = (model: EmbedModel, q: string) =>
  estimateTokens([q.slice(0, EMBED_TEXT_CAP)]) * model.tokenMicroUsd + model.dimensions * PRICING.queriedDimensionMicroUsd;

function meterQuery(env: Env, workspaceId: string, model: EmbedModel, q: string): Promise<void> {
  return meterKnowledge(env, workspaceId, 'knowledge_search', {
    model: model.id, units: 1, unitKind: 'queries', costMicroUsd: queryCostMicroUsd(model, q),
  });
}

export async function deleteIds(index: VectorizeIndex | Vectorize, ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += DELETE_BATCH) await index.deleteByIds(ids.slice(i, i + DELETE_BATCH));
}

// ----- corpus passages -----

export interface DenseKeys {
  keys: { refId: string; ord: number }[];
  model: EmbedModel;
}

/**
 * Dense candidates for a corpus search: from v2 (this workspace's passages of the configured
 * model) once reads use it, else from v1 exactly as before. An empty or failing v2 answer
 * falls back to v1 while v1 exists. Null = no dense retrieval (keyword only).
 */
export async function denseCorpusKeys(env: Env, store: Store, workspaceId: string, q: string, topK: number): Promise<DenseKeys | null> {
  if (!env.AI) return null;
  const v1 = env.KNOWLEDGE_VECTORS;
  const v2 = await readTargetV2(env, workspaceId, 'chunks', v1, store).catch(() => null);
  if (v2) {
    try {
      const matches = await queryV2(env, v2, workspaceId, q, { kinds: ['page', 'asset'], topK });
      if (matches.length || !v1) return { keys: matches.map((m) => keyOf(m.id)), model: v2.model };
    } catch (err) {
      warnV2(env, 'v2 passage query failed', err, { workspace_id: workspaceId });
      if (!v1) return null;
    }
  }
  if (!v1) return null;
  try {
    const [values] = await embedTexts(env, V1_MODEL, [q], 'query');
    const out = await v1.query(values, { topK, namespace: workspaceId });
    return { keys: (out.matches || []).map((m) => keyOf(m.id)), model: V1_MODEL };
  } catch {
    return null;
  }
}

// ----- knowledge notes -----

export async function writeNoteV2(env: Env, workspaceId: string, path: string, noteKind: string, text: string): Promise<void> {
  const t = v2Target(env);
  if (!t) return;
  try {
    const [values] = await embedTexts(env, t.model, [text], 'document');
    await t.index.upsert([{
      id: await noteVectorId(workspaceId, path), values, namespace: workspaceId,
      metadata: v2Metadata(t.model, 'note', path, { note_kind: noteKind }),
    }]);
    await meterEmbedding(env, workspaceId, t.model, [text], path);
  } catch (err) {
    warnV2(env, 'v2 note write failed', err, { workspace_id: workspaceId, path });
  }
}

export async function deleteNoteV2(env: Env, workspaceId: string, path: string): Promise<void> {
  if (!env.KNOWLEDGE_VECTORS_V2) return;
  try {
    await env.KNOWLEDGE_VECTORS_V2.deleteByIds([await noteVectorId(workspaceId, path)]);
  } catch {
    // best-effort, like v1: a stale note vector only names a path the reader re-checks.
  }
}

/** Note paths by meaning from v2, or null when the caller should ask v1. */
export async function notePathsV2(env: Env, workspaceId: string, q: string, topK: number): Promise<string[] | null> {
  const t = await readTargetV2(env, workspaceId, 'notes', env.VECTORIZE).catch(() => null);
  if (!t) return null;
  try {
    const matches = await queryV2(env, t, workspaceId, q, { kinds: ['note'], topK, metadata: true });
    await meterQuery(env, workspaceId, t.model, q);
    const paths = matches.map((m) => m.metadata?.source_id).filter((p): p is string => typeof p === 'string');
    return paths.length || !env.VECTORIZE ? paths : null;
  } catch (err) {
    warnV2(env, 'v2 note query failed', err, { workspace_id: workspaceId });
    return env.VECTORIZE ? null : [];
  }
}

// ----- workspace pages (artifact semantic search) -----

/** What a page is embedded as: name, description and tags, its concept-bearing fields. */
export function artifactText(row: { name: string; description: string | null; tags: string | null }): string {
  return [row.name, row.description || '', (row.tags || '').replace(/\n/g, ', ')].filter(Boolean).join('\n').slice(0, EMBED_TEXT_CAP);
}

/** Pages outside a workspace have no namespace: they stay on v1 only. */
export async function writeArtifactV2(env: Env, workspaceId: string, artifactId: string, text: string): Promise<void> {
  const t = v2Target(env);
  if (!t) return;
  try {
    const [values] = await embedTexts(env, t.model, [text], 'document');
    await t.index.upsert([{ id: artifactVectorId(artifactId), values, namespace: workspaceId, metadata: v2Metadata(t.model, 'artifact', artifactId) }]);
    await meterEmbedding(env, workspaceId, t.model, [text], artifactId);
  } catch (err) {
    warnV2(env, 'v2 page write failed', err, { workspace_id: workspaceId, artifact_id: artifactId });
  }
}

export async function deleteArtifactV2(env: Env, artifactId: string): Promise<void> {
  if (!env.KNOWLEDGE_VECTORS_V2) return;
  try {
    await env.KNOWLEDGE_VECTORS_V2.deleteByIds([artifactVectorId(artifactId)]);
  } catch {
    // best-effort, like v1.
  }
}

/** Page ids by meaning in one workspace from v2, or null when the caller should ask v1. */
export async function artifactIdsV2(env: Env, workspaceId: string, q: string, topK: number): Promise<string[] | null> {
  const t = await readTargetV2(env, workspaceId, 'artifacts', env.VECTORIZE).catch(() => null);
  if (!t) return null;
  try {
    const matches = await queryV2(env, t, workspaceId, q, { kinds: ['artifact'], topK });
    await meterQuery(env, workspaceId, t.model, q);
    const ids = matches.map((m) => m.id.slice(2));
    return ids.length || !env.VECTORIZE ? ids : null;
  } catch (err) {
    warnV2(env, 'v2 page query failed', err, { workspace_id: workspaceId });
    return env.VECTORIZE ? null : [];
  }
}
