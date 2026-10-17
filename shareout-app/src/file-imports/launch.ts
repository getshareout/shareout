/**
 * Start a run: as a FileImportWorkflow instance when the binding exists, else inline in
 * waitUntil (fine for small folders; large imports want the Workflow so a batch that
 * outlives the request is not cut short).
 */
import type { Env } from '../types';
import { markFailed, runImport } from './sync';

export async function launchRun(env: Env, ctx: { waitUntil(p: Promise<unknown>): void } | undefined, runId: string): Promise<void> {
  if (env.FILE_IMPORT) {
    try {
      await env.FILE_IMPORT.create({ id: runId, params: { runId } });
    } catch (err) {
      await markFailed(env, runId, err);
    }
    return;
  }
  const run = runImport(env, runId).catch(() => {});
  if (ctx) ctx.waitUntil(run);
  else await run;
}
