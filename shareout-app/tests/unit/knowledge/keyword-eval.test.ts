// Keyword-only retrieval eval over a small labelled Spanish/English corpus
// (helpers/keyword-eval-corpus.ts), through the real KnowledgeStore. Floors, not targets:
// they hold the numbers this search reached, so a change that loses them fails here.
//   probe (18 queries): recall@5 0.56 → 0.78, zero-result 5 → 2 when stemming landed;
//   the remaining misses are the four English questions about Spanish passages.
import { expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import type { Env } from '../../../src/types';
import { corpusFor } from '../../../src/knowledge/corpus/client';
import { EVAL_SOURCES, EXTRA_QUERIES, PROBE_QUERIES, type EvalQuery } from '../helpers/keyword-eval-corpus';

const e = env as unknown as Env;

async function measure(queries: EvalQuery[]) {
  const store = corpusFor(e, `wsp_kw_eval_${Date.now()}`)!;
  for (const [i, src] of EVAL_SOURCES.entries()) {
    const meta = { refId: `src${i}`, kind: 'asset' as const, version: 'v1', title: src.title, ownerId: 'u1' };
    await store.replaceChunks(meta, src.passages.map((text, ord) => ({ ord, locator: '', text })));
    await store.setStatus(meta, 'ready');
  }
  const misses: string[] = [];
  let found = 0;
  let empty = 0;
  for (const { q, relevant: [src, ord], tag } of queries) {
    const hits = await store.search(q, 30);
    if (!hits.length) empty++;
    const rank = hits.findIndex((h) => h.refId === `src${src}` && h.ord === ord);
    if (rank >= 0 && rank < 5) found++;
    else misses.push(`[${tag}] ${q}`);
  }
  return { recallAt5: found / queries.length, zeroResults: empty, misses };
}

it('keeps the probe’s recall: every Spanish query finds its passage in the top 5', async () => {
  const probe = await measure(PROBE_QUERIES);
  expect(probe.misses.filter((m) => !m.startsWith('[EN→ES]'))).toEqual([]);
  expect(probe.recallAt5).toBeGreaterThanOrEqual(0.77);
  expect(probe.zeroResults).toBeLessThanOrEqual(2);
});

it('finds partial words, accent-less words and English passages', async () => {
  const extra = await measure(EXTRA_QUERIES);
  expect(extra.misses).toEqual([]);
  expect(extra.zeroResults).toBe(0);
});
