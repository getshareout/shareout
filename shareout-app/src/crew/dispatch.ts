import type { Env } from '../types';
import { getCrew, createRun, getRun } from './store';
import { resolveCrewLimits, countActiveRuns } from './limits';
import { buildOwnerDataContextForCrew } from './principal';
import { runCrewToCompletion } from './run-loop';

export type CrewDispatchResult =
  | { ok: false; error: string }
  | { ok: true; runId: string; resultText: string };

/**
 * Run an artifact's crew to completion with a custom instruction. Honors the
 * per-owner concurrency cap and the crew's own runtime/budget bounds. Shared by
 * the Telegram ask_crew action and metric-alert crew-following.
 */
export async function runCrewForArtifact(
  env: Env,
  artifactId: string,
  instruction: string,
  initiatedBy: string | null,
  triggerKind = 'manual'
): Promise<CrewDispatchResult> {
  const crew = await getCrew(env, artifactId);
  if (!crew) return { ok: false, error: 'That page doesn’t have a crew set up.' };
  if (crew.status !== 'active') return { ok: false, error: 'That page’s crew isn’t active right now.' };

  const limits = await resolveCrewLimits(env, crew.owner_id);
  if ((await countActiveRuns(env, crew.owner_id)) >= limits.max_concurrent_runs) {
    return { ok: false, error: 'The crew is busy with another run — try again shortly.' };
  }

  const ownerCtx = await buildOwnerDataContextForCrew(env, crew);
  const run = await createRun(env, crew, instruction, initiatedBy, triggerKind);
  await runCrewToCompletion({ env, crew, run, ownerCtx, input: instruction });
  const done = await getRun(env, run.id);
  return { ok: true, runId: run.id, resultText: done?.result_text || '' };
}
