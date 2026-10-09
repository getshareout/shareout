// Durable per-source ingest: one Workflow instance per Asset/page version, each step
// retried on its own. The steps live in ingest.ts so the inline path runs the same code.
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import type { Env } from '../../types';
import { EMBED_BATCH, embedStep, extractStep, finishStep, graphStep, markFailed, type IngestParams } from './ingest';
import { EXTRACT_BATCH } from './extract';

export class KnowledgeIngestWorkflow extends WorkflowEntrypoint<Env, IngestParams> {
  async run(event: WorkflowEvent<IngestParams>, step: WorkflowStep): Promise<void> {
    const p = event.payload;
    try {
      const r = await step.do('extract', () => extractStep(this.env, p));
      if (r.status === 'chunked') {
        for (let offset = 0; offset < r.chunkCount; offset += EXTRACT_BATCH) {
          // Retried on its own; if it still fails the graph just misses this batch.
          await step.do(`graph ${offset}`, { retries: { limit: 2, delay: '10 seconds', backoff: 'exponential' } },
            () => graphStep(this.env, p, offset)).catch(() => 0);
        }
        for (let offset = 0; offset < r.chunkCount; offset += EMBED_BATCH) {
          await step.do(`embed ${offset}`, () => embedStep(this.env, p, offset));
        }
      }
      await step.do('finish', () => finishStep(this.env, p, r));
    } catch (err) {
      await step.do('mark failed', () => markFailed(this.env, p, err));
      throw err;
    }
  }
}
