// Durable folder import: one Workflow instance per run (instance id = run id), each
// batch a step with its own retries. Throttling that outlasts in-call backoff is
// retried here, minutes later. The steps live in sync.ts so the inline path is the same.
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import type { Env } from '../types';
import type { FileImportParams } from './types';
import { runImport } from './sync';

export class FileImportWorkflow extends WorkflowEntrypoint<Env, FileImportParams> {
  async run(event: WorkflowEvent<FileImportParams>, step: WorkflowStep): Promise<void> {
    await runImport(this.env, event.payload.runId, (name, fn) =>
      step.do(name, { retries: { limit: 5, delay: '1 minute', backoff: 'exponential' }, timeout: '10 minutes' }, fn as () => Promise<never>));
  }
}
