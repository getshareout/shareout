// In-memory stand-ins for Workers AI embeddings and a Vectorize index, for the knowledge
// vector tests: namespaces, metadata filters (implicit $eq, $eq/$ne, $in/$nin) applied before
// ranking as Vectorize does, cosine scores, 100-ids-per-delete like the real index.

type Meta = Record<string, unknown>;

export interface StoredVector {
  id: string;
  values: number[];
  namespace?: string;
  metadata?: Meta;
}

export interface QueryCall {
  namespace?: string;
  filter?: Record<string, unknown>;
  topK?: number;
  returnMetadata?: unknown;
}

const DIMS = 64;

/** Hashed bag of words: texts that share words point the same way, so "by meaning" is testable. */
export function wordVector(text: string): number[] {
  const v = new Array(DIMS).fill(0);
  for (const w of text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []) {
    let h = 2166136261;
    for (let i = 0; i < w.length; i++) h = Math.imul(h ^ w.charCodeAt(i), 16777619);
    v[(h >>> 0) % DIMS] += 1;
  }
  return v;
}

function matches(meta: Meta, filter?: Record<string, unknown>): boolean {
  if (!filter) return true;
  return Object.entries(filter).every(([key, cond]) => {
    const value = meta[key];
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      const c = cond as Record<string, unknown>;
      if ('$in' in c) return (c.$in as unknown[]).includes(value);
      if ('$nin' in c) return !(c.$nin as unknown[]).includes(value);
      if ('$eq' in c) return value === c.$eq;
      if ('$ne' in c) return value !== c.$ne;
      throw new Error(`fake vectorize: unsupported filter ${JSON.stringify(cond)}`);
    }
    return value === cond;
  });
}

export class FakeVectorize {
  rows = new Map<string, StoredVector>();
  queries: QueryCall[] = [];
  deletes: string[][] = [];
  failUpsert = false;

  async upsert(vectors: { id: string; values: ArrayLike<number>; namespace?: string; metadata?: Meta }[]) {
    if (this.failUpsert) throw new Error('vectorize unavailable');
    for (const v of vectors) {
      if (new TextEncoder().encode(v.id).length > 64) throw new Error(`vector id over 64 bytes: ${v.id}`);
      this.rows.set(v.id, { id: v.id, values: Array.from(v.values), namespace: v.namespace, metadata: v.metadata });
    }
    return { mutationId: 'fake', count: vectors.length, ids: vectors.map((v) => v.id) };
  }

  async query(vector: ArrayLike<number>, opts: QueryCall = {}) {
    this.queries.push(opts);
    const q = Array.from(vector);
    const qlen = Math.hypot(...q) || 1;
    const scored = [...this.rows.values()]
      .filter((r) => (opts.namespace === undefined || r.namespace === opts.namespace) && matches(r.metadata ?? {}, opts.filter))
      .map((r) => {
        const dot = r.values.reduce((n, x, i) => n + x * (q[i] ?? 0), 0);
        const withMeta = opts.returnMetadata && opts.returnMetadata !== 'none';
        return { id: r.id, score: dot / ((Math.hypot(...r.values) || 1) * qlen), ...(withMeta ? { metadata: r.metadata } : {}) };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, opts.topK ?? 5);
    return { matches: scored, count: scored.length };
  }

  async deleteByIds(ids: string[]) {
    if (ids.length > 100) throw new Error('40007: too many ids');
    this.deletes.push(ids);
    for (const id of ids) this.rows.delete(id);
    return { mutationId: 'fake', count: ids.length, ids };
  }

  inNamespace(ns: string): StoredVector[] {
    return [...this.rows.values()].filter((r) => r.namespace === ns);
  }
}

export interface AiCall {
  model: string;
  input: Record<string, unknown>;
}

/**
 * Workers AI stand-in for embedding models: records each embedding call; `failAfter` = how many
 * more calls succeed before every call fails (a rate limit). Anything but an embedding call (the
 * graph extractor's LLM) is refused, as in the retrieval eval; ingest carries on without a graph.
 */
export function fakeAi() {
  const calls: AiCall[] = [];
  const ai = {
    calls,
    failAfter: null as number | null,
    async run(model: string, input: Record<string, unknown>) {
      if (!input || !['text', 'documents', 'queries'].some((k) => k in input)) throw new Error(`${model} is not wired (embeddings only)`);
      if (ai.failAfter !== null && ai.failAfter-- <= 0) throw new Error('3040: Capacity temporarily exceeded, please try again.');
      calls.push({ model, input });
      const texts = [].concat((input.text ?? input.documents ?? input.queries) as never) as string[];
      return { shape: [texts.length, DIMS], data: texts.map(wordVector) };
    },
  };
  return ai;
}

/** Texts embedded so far, per model and input field. */
export const embedded = (calls: AiCall[], model: string) =>
  calls.filter((c) => c.model === model).flatMap((c) => Object.values(c.input).flat() as string[]);
