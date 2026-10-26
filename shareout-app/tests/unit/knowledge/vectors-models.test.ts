// Which embedding model feeds which index, and what each model is sent. The inputs must stay
// what the retrieval eval sends (tests/eval/knowledge README, "Dense mode"): `text` for the
// BGE models; `documents` for passages and `queries` for questions for qwen3-embedding, with
// no instruction (the model's default retrieval instruction applies).
import { describe, expect, it } from 'vitest';
import type { Env } from '../../../src/types';
import {
  BGE_BASE, BGE_M3, configuredModel, EMBED_MODELS, EMBED_TEXT_CAP, embedTexts, QWEN3_EMBEDDING, readsPreferV2,
  V1_MODEL, V2_DIMENSIONS, v2Target, writeTargets,
} from '../../../src/knowledge/vectors/models';
import { fakeAi } from '../helpers/fake-vectors';

const index = {} as Vectorize;
const v1 = {} as VectorizeIndex;
const env = (over: Partial<Env> = {}) => ({ AI: fakeAi(), ...over }) as unknown as Env;

describe('KNOWLEDGE_EMBED_MODEL', () => {
  it('defaults to bge-m3 for the 1024-d index (the eval winner); v1 keeps bge-base', () => {
    expect(configuredModel(env())).toEqual({ model: EMBED_MODELS[BGE_M3], problem: null });
    expect(v2Target(env({ KNOWLEDGE_VECTORS_V2: index }))).toEqual({ index, model: EMBED_MODELS[BGE_M3] });
    expect(V1_MODEL.id).toBe(BGE_BASE);
  });

  it('accepts the two multilingual 1024-d models', () => {
    for (const id of [BGE_M3, QWEN3_EMBEDDING]) {
      expect(configuredModel(env({ KNOWLEDGE_EMBED_MODEL: ` ${id} ` }))).toEqual({ model: EMBED_MODELS[id], problem: null });
      expect(EMBED_MODELS[id].dimensions).toBe(V2_DIMENSIONS);
      expect(v2Target(env({ KNOWLEDGE_VECTORS_V2: index, KNOWLEDGE_EMBED_MODEL: id }))).toEqual({ index, model: EMBED_MODELS[id] });
    }
  });

  it('refuses an unknown or 768-d model for v2, naming the supported ones', () => {
    expect(configuredModel(env({ KNOWLEDGE_EMBED_MODEL: '@cf/baai/bge-m4' })).problem).toBe(`KNOWLEDGE_EMBED_MODEL "@cf/baai/bge-m4" is not one of ${BGE_M3}, ${QWEN3_EMBEDDING}`);
    expect(v2Target(env({ KNOWLEDGE_VECTORS_V2: index, KNOWLEDGE_EMBED_MODEL: '@cf/baai/bge-m4' }))).toBeNull();
    expect(configuredModel(env({ KNOWLEDGE_EMBED_MODEL: BGE_BASE })).problem).toMatch(/768-d/);
    expect(v2Target(env({ KNOWLEDGE_VECTORS_V2: index, KNOWLEDGE_EMBED_MODEL: BGE_BASE }))).toBeNull();
  });

  it('needs both the v2 binding and Workers AI', () => {
    expect(v2Target(env({ KNOWLEDGE_EMBED_MODEL: BGE_M3 }))).toBeNull();
    expect(v2Target({ KNOWLEDGE_VECTORS_V2: index, KNOWLEDGE_EMBED_MODEL: BGE_M3 } as unknown as Env)).toBeNull();
  });
});

describe('write and read targets', () => {
  const both = { KNOWLEDGE_VECTORS_V2: index, KNOWLEDGE_EMBED_MODEL: BGE_M3 };

  it('writes v1 only until the v2 index is bound — no behavior change', () => {
    expect(writeTargets(env(), v1).map((t) => [t.version, t.model.id])).toEqual([['v1', BGE_BASE]]);
    expect(writeTargets(env({ KNOWLEDGE_VECTORS_V2: index, KNOWLEDGE_EMBED_MODEL: BGE_BASE }), v1).map((t) => t.version)).toEqual(['v1']);
    expect(writeTargets({} as Env, v1)).toEqual([]);
  });

  it('dual-writes once bound, the index reads use first', () => {
    expect(writeTargets(env({ KNOWLEDGE_VECTORS_V2: index }), v1).map((t) => [t.version, t.model.id])).toEqual([['v1', BGE_BASE], ['v2', BGE_M3]]);
    expect(writeTargets(env({ ...both, KNOWLEDGE_EMBED_MODEL: QWEN3_EMBEDDING }), v1).map((t) => t.model.id)).toEqual([BGE_BASE, QWEN3_EMBEDDING]);
    expect(writeTargets(env({ ...both, KNOWLEDGE_VECTORS_READ: 'v2' }), v1).map((t) => t.version)).toEqual(['v2', 'v1']);
    expect(writeTargets(env(both), undefined).map((t) => t.version)).toEqual(['v2']);
  });

  it('reads prefer v2 when cut over, or when there is no v1 index at all', () => {
    expect(readsPreferV2(env(), v1)).toBe(false);
    expect(readsPreferV2(env({ KNOWLEDGE_VECTORS_READ: 'V2' }), v1)).toBe(true);
    expect(readsPreferV2(env({ KNOWLEDGE_VECTORS_READ: 'v1' }), undefined)).toBe(true);
  });
});

describe('model inputs (the eval harness conventions)', () => {
  it('sends `text` to the BGE models for passages and questions alike', () => {
    for (const id of [BGE_BASE, BGE_M3]) {
      expect(EMBED_MODELS[id].input(['a'], 'document')).toEqual({ text: ['a'] });
      expect(EMBED_MODELS[id].input(['a'], 'query')).toEqual({ text: ['a'] });
    }
  });

  it('sends qwen3-embedding passages as `documents` and questions as `queries`, without an instruction', () => {
    expect(EMBED_MODELS[QWEN3_EMBEDDING].input(['a'], 'document')).toEqual({ documents: ['a'] });
    expect(EMBED_MODELS[QWEN3_EMBEDDING].input(['a'], 'query')).toEqual({ queries: ['a'] });
  });

  it('batches at the model limit and caps each text', async () => {
    const ai = fakeAi();
    const texts = Array.from({ length: 70 }, (_, i) => `t${i} ${'x'.repeat(i === 0 ? 5000 : 1)}`);
    const out = await embedTexts({ AI: ai } as unknown as Env, EMBED_MODELS[QWEN3_EMBEDDING], texts, 'query');
    expect(out).toHaveLength(70);
    expect(ai.calls.map((c) => (c.input.queries as string[]).length)).toEqual([32, 32, 6]);
    expect((ai.calls[0].input.queries as string[])[0]).toHaveLength(EMBED_TEXT_CAP);
    await embedTexts({ AI: ai } as unknown as Env, V1_MODEL, texts, 'document');
    expect(ai.calls.slice(3).map((c) => (c.input.text as string[]).length)).toEqual([70]);
  });

  it('fails loudly on a short or missing answer, and reads the `response` shape too', async () => {
    const short = { AI: { run: async () => ({ data: [[1]] }) } } as unknown as Env;
    await expect(embedTexts(short, EMBED_MODELS[BGE_M3], ['a', 'b'], 'document')).rejects.toThrow(/embedding failed/);
    const response = { AI: { run: async () => ({ response: [[1], [2]] }) } } as unknown as Env;
    expect(await embedTexts(response, EMBED_MODELS[BGE_M3], ['a', 'b'], 'document')).toEqual([[1], [2]]);
  });
});
