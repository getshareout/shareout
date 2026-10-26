// Embedding models for workspace Knowledge and page search, and which index each one feeds.
//
// Two index generations (ShareOut's, not Vectorize's own legacy/V2 API versions):
//   v1  KNOWLEDGE_VECTORS (passages) + VECTORIZE (notes, pages): 768-d, English-only
//       @cf/baai/bge-base-en-v1.5. Never changes model: its vectors are already stored.
//   v2  KNOWLEDGE_VECTORS_V2: 1024-d, cosine, one namespace per workspace for every vector
//       kind (vectors/v2.ts), embedded with a multilingual model: @cf/baai/bge-m3 unless
//       KNOWLEDGE_EMBED_MODEL names @cf/qwen/qwen3-embedding-0.6b. bge-m3 won the retrieval
//       eval (416 Spanish-first questions, hybrid R@10 0.924 vs qwen3 0.919 vs bge-base 0.780).
//
// Input conventions are the retrieval eval's (tests/eval/knowledge, `npm run eval:knowledge
// -- --model <id>`), so production embeds exactly what the eval measured: the BGE models take
// `text`; qwen3-embedding takes `documents` for passages and `queries` for questions, with the
// model's own default retrieval instruction. List prices checked 2026-10-25
// (developers.cloudflare.com/workers-ai/platform/pricing).
import type { Env } from '../../types';

export type EmbedRole = 'document' | 'query';

export interface EmbedModel {
  id: string;
  dimensions: number;
  /** Most texts one AI.run call takes. */
  maxBatch: number;
  /** List price, micro-USD per input token. */
  tokenMicroUsd: number;
  input(texts: string[], role: EmbedRole): Record<string, string[]>;
}

export const BGE_BASE = '@cf/baai/bge-base-en-v1.5';
export const BGE_M3 = '@cf/baai/bge-m3';
export const QWEN3_EMBEDDING = '@cf/qwen/qwen3-embedding-0.6b';

const asText = (texts: string[]) => ({ text: texts });

export const EMBED_MODELS: Readonly<Record<string, EmbedModel>> = {
  [BGE_BASE]: { id: BGE_BASE, dimensions: 768, maxBatch: 100, tokenMicroUsd: 0.067, input: asText },
  [BGE_M3]: { id: BGE_M3, dimensions: 1024, maxBatch: 32, tokenMicroUsd: 0.012, input: asText },
  [QWEN3_EMBEDDING]: {
    id: QWEN3_EMBEDDING,
    dimensions: 1024,
    maxBatch: 32,
    tokenMicroUsd: 0.012,
    input: (texts, role) => ({ [role === 'query' ? 'queries' : 'documents']: texts }),
  },
};

/** The model of the v1 indexes. */
export const V1_MODEL = EMBED_MODELS[BGE_BASE];
/** The v2 index's model when KNOWLEDGE_EMBED_MODEL is unset. */
export const V2_DEFAULT_MODEL = EMBED_MODELS[BGE_M3];
/** Dimensions KNOWLEDGE_VECTORS_V2 is created with (wrangler.toml). */
export const V2_DIMENSIONS = 1024;
/** Longest text embedded for one passage, note, page or query (bge-base's ~512 tokens). */
export const EMBED_TEXT_CAP = 2000;

export interface V2Target {
  index: Vectorize;
  model: EmbedModel;
}

/** The v2 model (KNOWLEDGE_EMBED_MODEL, default bge-m3), and why it can't feed v2 if it can't. */
export function configuredModel(env: Pick<Env, 'KNOWLEDGE_EMBED_MODEL'>): { model: EmbedModel; problem: string | null } {
  const id = env.KNOWLEDGE_EMBED_MODEL?.trim();
  if (!id) return { model: V2_DEFAULT_MODEL, problem: null };
  const model = EMBED_MODELS[id];
  if (!model) {
    const supported = Object.values(EMBED_MODELS).filter((m) => m.dimensions === V2_DIMENSIONS).map((m) => m.id);
    return { model: V2_DEFAULT_MODEL, problem: `KNOWLEDGE_EMBED_MODEL "${id}" is not one of ${supported.join(', ')}` };
  }
  if (model.dimensions !== V2_DIMENSIONS) return { model, problem: `${id} makes ${model.dimensions}-d vectors; KNOWLEDGE_VECTORS_V2 is ${V2_DIMENSIONS}-d` };
  return { model, problem: null };
}

/** The v2 index and its model, when it is bound (and KNOWLEDGE_EMBED_MODEL, if set, names a 1024-d model). */
export function v2Target(env: Env): V2Target | null {
  if (!env.AI || !env.KNOWLEDGE_VECTORS_V2) return null;
  const { model, problem } = configuredModel(env);
  return problem ? null : { index: env.KNOWLEDGE_VECTORS_V2, model };
}

/** Reads prefer v2: KNOWLEDGE_VECTORS_READ=v2, or there is no v1 index to read instead. */
export function readsPreferV2(env: Env, v1: unknown): boolean {
  return env.KNOWLEDGE_VECTORS_READ?.trim().toLowerCase() === 'v2' || !v1;
}

export interface WriteTarget {
  version: 'v1' | 'v2';
  index: VectorizeIndex | Vectorize;
  model: EmbedModel;
}

/**
 * Indexes a vector is written to, the one reads use first. A failed write to the first is an
 * error (retried like before); a write to the other is best-effort, healed by the backfill.
 */
export function writeTargets(env: Env, v1: VectorizeIndex | undefined): WriteTarget[] {
  if (!env.AI) return [];
  const out: WriteTarget[] = v1 ? [{ version: 'v1', index: v1, model: V1_MODEL }] : [];
  const v2 = v2Target(env);
  if (v2) {
    const t: WriteTarget = { version: 'v2', ...v2 };
    if (readsPreferV2(env, v1)) out.unshift(t);
    else out.push(t);
  }
  return out;
}

type LooseAi = { run(model: string, input: Record<string, unknown>): Promise<unknown> };

/** Embed `texts` (each capped at EMBED_TEXT_CAP) with `model`, in calls of at most maxBatch. */
export async function embedTexts(env: Env, model: EmbedModel, texts: string[], role: EmbedRole): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += model.maxBatch) {
    const batch = texts.slice(i, i + model.maxBatch).map((t) => t.slice(0, EMBED_TEXT_CAP));
    const res = (await (env.AI as unknown as LooseAi).run(model.id, model.input(batch, role))) as { data?: unknown; response?: unknown };
    const data = Array.isArray(res?.data) ? res.data : res?.response;
    if (!Array.isArray(data) || data.length !== batch.length || !data.every(Array.isArray)) {
      throw new Error(`embedding failed (${model.id})`);
    }
    out.push(...(data as number[][]));
  }
  return out;
}

/** Workers AI returns no token counts for embeddings: ~4 characters per token. */
export const estimateTokens = (texts: string[]) => Math.ceil(texts.reduce((n, t) => n + t.length, 0) / 4);
