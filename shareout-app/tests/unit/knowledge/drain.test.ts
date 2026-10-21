// "Learn from existing pages" drains the whole queue: a durable KnowledgeIngestWorkflow run
// in `distill` mode, one bounded batch per retried step, instead of a single ~25s pass.
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';

const runKnowledgeDistill = vi.hoisted(() => vi.fn());
vi.mock('../../../src/knowledge/distill', () => ({ runKnowledgeDistill }));

import { DRAIN_BATCH, DRAIN_MAX_STEPS, startDistillDrain } from '../../../src/knowledge/drain';
import { KnowledgeIngestWorkflow } from '../../../src/knowledge/corpus/workflow';

const step = { do: vi.fn((_name: string, a: unknown, b?: unknown) => (typeof a === 'function' ? a : b as () => unknown)()) };
const run = (params: unknown) => {
  const wf = Object.create(KnowledgeIngestWorkflow.prototype) as KnowledgeIngestWorkflow;
  (wf as unknown as { env: Env }).env = {} as Env;
  return wf.run({ payload: params } as never, step as never);
};

describe('startDistillDrain', () => {
  it('starts one drain per workspace per 30-minute window', async () => {
    const create = vi.fn(async () => ({}));
    const env = { KNOWLEDGE_INGEST: { create } } as unknown as Env;
    const t0 = 1_800_000 * 1000;
    expect(await startDistillDrain(env, 'wsp_1', t0)).toBe(true);
    await startDistillDrain(env, 'wsp_1', t0 + 60_000);
    await startDistillDrain(env, 'wsp_1', t0 + 1_800_000);
    expect(create.mock.calls.map((c) => (c as unknown as [{ id: string; params: unknown }])[0])).toEqual([
      { id: 'distill-wsp_1-1000', params: { kind: 'distill', workspaceId: 'wsp_1' } },
      { id: 'distill-wsp_1-1000', params: { kind: 'distill', workspaceId: 'wsp_1' } },
      { id: 'distill-wsp_1-1001', params: { kind: 'distill', workspaceId: 'wsp_1' } },
    ]);
  });

  it('a duplicate id (drain already running) is not an error; no Workflows → false', async () => {
    const env = { KNOWLEDGE_INGEST: { create: vi.fn(async () => { throw new Error('instance exists'); }) } } as unknown as Env;
    expect(await startDistillDrain(env, 'wsp_1')).toBe(true);
    expect(await startDistillDrain({} as Env, 'wsp_1')).toBe(false);
  });
});

describe('KnowledgeIngestWorkflow distill mode', () => {
  it('learns batch after batch until the queue is empty', async () => {
    runKnowledgeDistill.mockReset()
      .mockResolvedValueOnce({ processed: 5, skipped: 0 })
      .mockResolvedValueOnce({ processed: 3, skipped: 2 })
      .mockResolvedValueOnce({ processed: 0, skipped: 0 });
    await run({ kind: 'distill', workspaceId: 'wsp_1' });
    expect(runKnowledgeDistill).toHaveBeenCalledTimes(3);
    expect(runKnowledgeDistill).toHaveBeenCalledWith({}, expect.objectContaining({ workspaceId: 'wsp_1', maxItems: DRAIN_BATCH }));
  });

  it('keeps going through skipped-only batches, but stops after two batches that learn nothing', async () => {
    runKnowledgeDistill.mockReset().mockResolvedValue({ processed: 0, skipped: 5 });
    await run({ kind: 'distill', workspaceId: 'wsp_1' });
    expect(runKnowledgeDistill).toHaveBeenCalledTimes(2);
  });

  it('is bounded', async () => {
    runKnowledgeDistill.mockReset().mockResolvedValue({ processed: 5, skipped: 0 });
    await run({ kind: 'distill', workspaceId: 'wsp_1' });
    expect(runKnowledgeDistill).toHaveBeenCalledTimes(DRAIN_MAX_STEPS);
  });
});
