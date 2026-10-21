// Dropping a source's stale vectors stays under Vectorize's 100-ids-per-delete cap.
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';
import { finishStep } from '../../../src/knowledge/corpus/ingest';

describe('finishStep', () => {
  it('deletes stale vectors in batches of at most 100', async () => {
    const deleteByIds = vi.fn(async () => ({}));
    const env = { KNOWLEDGE_VECTORS: { deleteByIds } } as unknown as Env;
    // A file that had 250 chunks and is gone now; the rest of the step is not under test.
    await finishStep(env, { workspaceId: 'wsp_x', kind: 'asset', refId: 'dlv_x' }, { status: 'gone', chunkCount: 0, previousCount: 250 }).catch(() => {});
    expect(deleteByIds.mock.calls.map((c) => (c as unknown as [string[]])[0].length)).toEqual([100, 100, 50]);
  });
});
