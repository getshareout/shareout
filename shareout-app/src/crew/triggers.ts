import type { Env } from '../types';
import { getNextRunTime } from '../scheduling/jobs';
import { getCrewById, createRun, reapStaleRuns } from './store';
import { resolveCrewLimits, countActiveRuns } from './limits';
import { buildOwnerDataContextForCrew } from './principal';
import { runCrewToCompletion } from './run-loop';
import { evaluateCondition, validateConditionConfig, clampSeconds, RECHECK_SECONDS } from './condition';
import type { CrewRow, CrewTriggerRow } from './types';

const MAX_CREW_DISPATCH_PER_TICK = 25;

/**
 * Run a crew autonomously (cron/event/condition). Honors status + the per-tenant
 * concurrency cap. Returns true if a run was started. Uses the crew's standing
 * instructions as the goal (input='' → the loop falls back to instructions).
 * triggerId, when passed, lets the crew set its own next wake via finish.
 */
export async function dispatchCrewRun(
  env: Env,
  crew: CrewRow,
  triggerKind: 'cron' | 'event' | 'condition',
  triggerId?: string
): Promise<boolean> {
  if (crew.status !== 'active') return false;

  const limits = await resolveCrewLimits(env, crew.owner_id);
  if ((await countActiveRuns(env, crew.owner_id)) >= limits.max_concurrent_runs) return false;

  const ownerCtx = await buildOwnerDataContextForCrew(env, crew);
  const run = await createRun(env, crew, '', null, triggerKind);
  await runCrewToCompletion({ env, crew, run, ownerCtx, input: '', triggerId });
  return true;
}

/**
 * Wake crews whose event trigger matches. Called from the data plane (e.g. row
 * insert) and meant to be wrapped in ctx.waitUntil so the run executes after the
 * triggering response, never inside it. Best-effort — never throws into caller.
 */
export async function emitCrewEvent(env: Env, artifactId: string, eventType: string): Promise<void> {
  try {
    const triggers = await env.DB.prepare(
      `SELECT * FROM crew_triggers
         WHERE artifact_id = ? AND kind = 'event' AND event_type = ? AND enabled = 1`
    )
      .bind(artifactId, eventType)
      .all<CrewTriggerRow>();

    for (const trigger of triggers.results) {
      const crew = await getCrewById(env, trigger.crew_id);
      if (!crew) continue;
      await dispatchCrewRun(env, crew, 'event');
    }
  } catch {
    // Event dispatch must never break the operation that emitted it.
  }
}

/** Dispatch all due cron + condition triggers. Called from the hourly scheduled handler. */
/** ISO instant `seconds` from now, for the TEXT `*_at` columns. */
function isoIn(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

export async function runDueCrewTriggers(env: Env): Promise<{ executed: number; failed: number }> {
  // Free concurrency slots held by runs the platform killed before finalize, so
  // a crash can't permanently lock out this tenant's autonomous runs.
  await reapStaleRuns(env).catch(() => 0);

  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const due = await env.DB.prepare(
    `SELECT * FROM crew_triggers
       WHERE kind IN ('cron','condition') AND enabled = 1
         AND next_run_at IS NOT NULL AND next_run_at <= ?
       ORDER BY next_run_at LIMIT ?`
  )
    .bind(now, MAX_CREW_DISPATCH_PER_TICK)
    .all<CrewTriggerRow>();

  let executed = 0;
  let failed = 0;

  for (const trigger of due.results) {
    try {
      const ran =
        trigger.kind === 'condition'
          ? await runConditionTrigger(env, trigger, now)
          : await runCronTrigger(env, trigger, now);
      if (ran) executed++;
      else failed++;
    } catch {
      failed++;
      // Storm guard: a throw here (predicate eval, crew load, dispatch) leaves
      // next_run_at untouched, so the trigger stays due and re-fires every tick.
      // Back off an hour so a broken trigger can't hammer the heartbeat.
      try {
        await setNextRun(env, trigger.id, isoIn(RECHECK_SECONDS));
      } catch {
        /* best-effort — don't let the backoff write break the batch */
      }
    }
  }

  return { executed, failed };
}

async function runCronTrigger(env: Env, trigger: CrewTriggerRow, now: string): Promise<boolean> {
  // Claim-and-advance: advance next_run_at conditioned on the value we observed,
  // so an overlapping heartbeat can't dispatch the same trigger twice. Doing it
  // FIRST also means a slow/failing run can't re-fire next tick.
  const nextRunAt = trigger.cron ? getNextRunTime(trigger.cron) : null;
  if (!(await claimTrigger(env, trigger, nextRunAt, now))) return false;

  const crew = await getCrewById(env, trigger.crew_id);
  if (!crew) return false;
  return dispatchCrewRun(env, crew, 'cron', trigger.id);
}

async function runConditionTrigger(env: Env, trigger: CrewTriggerRow, now: string): Promise<boolean> {
  const parsed = validateConditionConfig(trigger.condition_json ? JSON.parse(trigger.condition_json) : {});
  const cfg = parsed.ok ? parsed.config : {};

  const crew = await getCrewById(env, trigger.crew_id);
  if (!crew) {
    await setNextRun(env, trigger.id, now + 86400);
    return false;
  }

  // Optional predicate gate — when present and false, re-check next hour (cheap),
  // don't burn the cooldown or spend LLM tokens.
  if (cfg.predicate) {
    const ownerCtx = await buildOwnerDataContextForCrew(env, crew);
    const ev = await evaluateCondition(ownerCtx, cfg.predicate);
    if ('error' in ev || !ev.matched) {
      await setNextRun(env, trigger.id, isoIn(RECHECK_SECONDS));
      return false;
    }
  }

  // About to run: claim the trigger by advancing next_run_at (storm guard +
  // race guard). If another heartbeat already claimed it, don't dispatch again.
  // The crew can still override the wake via finish(nextRunInHours).
  if (!(await claimTrigger(env, trigger, isoIn(clampSeconds(cfg.cooldownSeconds)), now))) return false;

  return dispatchCrewRun(env, crew, 'condition', trigger.id);
}

/**
 * Compare-and-swap claim: advance next_run_at only if it still holds the value
 * we observed when the trigger was selected as due. Returns true if this caller
 * won the claim (and should dispatch), false if a concurrent tick beat it.
 */
export async function claimTrigger(
  env: Env,
  trigger: CrewTriggerRow,
  nextRunAt: string | null,
  now: string
): Promise<boolean> {
  const r = await env.DB.prepare(
    `UPDATE crew_triggers SET next_run_at = ?, last_run_at = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE id = ? AND next_run_at = ?`
  )
    .bind(nextRunAt, now, trigger.id, trigger.next_run_at)
    .run();
  return (r.meta.changes || 0) > 0;
}

async function setNextRun(env: Env, triggerId: string, nextRunAt: string): Promise<void> {
  await env.DB.prepare("UPDATE crew_triggers SET next_run_at = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
    .bind(nextRunAt, triggerId)
    .run();
}
