// Durable per-source ingest: one Workflow instance per Asset/page version, each step
// retried on its own. The steps live in ingest.ts so the inline path runs the same code.
// The same class drains a workspace's Knowledge learning queue (kind 'distill', drain.ts).
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import type { Env } from '../../types';
import { EMBED_BATCH, GRAPH_DEFERRED, embedStep, extractStep, finishStep, graphStep, markFailed, type IngestParams } from './ingest';
import { EXTRACT_BATCH } from './extract';
import { runKnowledgeDistill } from '../distill';
import { DRAIN_BATCH, DRAIN_MAX_STEPS, type KnowledgeWorkflowParams } from '../drain';

export class KnowledgeIngestWorkflow extends WorkflowEntrypoint<Env, KnowledgeWorkflowParams> {
  async run(event: WorkflowEvent<KnowledgeWorkflowParams>, step: WorkflowStep): Promise<void> {
    const q = event.payload;
    if (q.kind === 'distill') {
      // Skipped pages (held, forgotten) still advance the queue; a failed model call leaves
      // its page queued, so two batches in a row that learn nothing end the drain.
      for (let i = 0, idle = 0; i < DRAIN_MAX_STEPS && idle < 2; i++) {
        const r = await step.do(`distill ${i}`, { retries: { limit: 2, delay: '30 seconds', backoff: 'exponential' }, timeout: '5 minutes' },
          () => runKnowledgeDistill(this.env, { workspaceId: q.workspaceId, maxItems: DRAIN_BATCH, maxMs: 90_000 }));
        if (!r.processed && !r.skipped) break;
        idle = r.processed ? 0 : idle + 1;
      }
      return;
    }
    const p: IngestParams = q;
    try {
      const r = await step.do('extract', () => extractStep(this.env, p));
      let graphDeferred = false;
      if (r.status === 'chunked') {
        for (let offset = 0; offset < r.chunkCount; offset += EXTRACT_BATCH) {
          // Retried on its own; if it still fails the graph just misses this batch.
          const n = await step.do(`graph ${offset}`, { retries: { limit: 2, delay: '10 seconds', backoff: 'exponential' } },
            () => graphStep(this.env, p, offset)).catch(() => 0);
          if (n === GRAPH_DEFERRED) { graphDeferred = true; break; }
        }
        for (let offset = 0; offset < r.chunkCount; offset += EMBED_BATCH) {
          await step.do(`embed ${offset}`, () => embedStep(this.env, p, offset));
        }
      }
      await step.do('finish', () => finishStep(this.env, p, r, graphDeferred));
    } catch (err) {
      await step.do('mark failed', () => markFailed(this.env, p, err));
      throw err;
    }
  }
}
