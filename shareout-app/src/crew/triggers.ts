import type { Env } from '../types';
import { getNextRunTime } from '../scheduling/jobs/cron';
import { getCrewById, createRun, reapStaleRuns } from './store';
import { resolveCrewLimits, countActiveRuns, ownerAtCapacity } from './limits';
import { createLogger } from '../logging';
import { buildOwnerDataContextForCrew } from './principal';
import { enqueueCrewRun, drainCrewQueue, ownersWithQueuedRuns } from './queue';
import { runCrew, runCrewToCompletion } from './run-loop';
import { evaluateCondition, validateConditionConfig, clampSeconds, RECHECK_SECONDS } from './condition';
import type { CrewRow, CrewTriggerRow } from './types';

const MAX_CREW_DISPATCH_PER_TICK = 25;
// A trigger that finds its owner busy stays due and is retried each hourly tick for this long, then skips to its next occurrence.
// The hourly invocation is shared by every scheduled task and has one 15 min wall limit; due crews run one after
// another, so stop starting new ones after this long and leave the rest due for the next tick.
export const CREW_TICK_BUDGET_MS = 8 * 60 * 1000;
const BUSY_RETRY_WINDOW_MS = 6 * 3600 * 1000;

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
  const owner = await env.DB.prepare('SELECT disabled FROM users WHERE id = ?').bind(crew.owner_id).first<{ disabled: number | null }>();
  if (owner?.disabled) return false;

  // An orphaned 'running' row (client gone, worker killed) must not hold the slot until the next hourly tick.
  await reapStaleRuns(env).catch(() => 0);
  if (await ownerAtCapacity(env, crew.owner_id)) {
    // An event wake (e.g. a new row = maybe an alert) is queued, not dropped; cron/condition triggers retry via next_run_at.
    if (triggerKind === 'event') await enqueueCrewRun(env, crew, triggerKind);
    return false;
  }

  const ownerCtx = await buildOwnerDataContextForCrew(env, crew);
  const run = await createRun(env, crew, '', null, triggerKind);
  await runCrewToCompletion({ env, crew, run, ownerCtx, input: '', triggerId });
  // Queued runs are NOT drained here: an event dispatch runs inside waitUntil (cut ~30 s after the response),
  // and a cron dispatch is already inside the tick's own time budget. The tick drains with what is left.
  return true;
}

/**
 * Manual "Run now" from the workspace UI: same gates as dispatchCrewRun, but the
 * run streams back as SSE so the user watches each step. Null when the crew is
 * inactive or the owner is at the concurrency limit.
 */
export async function startCrewRunStream(env: Env, crew: CrewRow, initiatedBy: string): Promise<ReadableStream | null> {
  if (crew.status !== 'active') return null;

  await reapStaleRuns(env).catch(() => 0);
  const limits = await resolveCrewLimits(env, crew.owner_id);
  if ((await countActiveRuns(env, crew.owner_id)) >= limits.max_concurrent_runs) return null;

  const ownerCtx = await buildOwnerDataContextForCrew(env, crew);
  const run = await createRun(env, crew, '', initiatedBy, 'manual');
  return runCrew({ env, crew, run, ownerCtx, input: '' });
}

/**
 * Wake crews whose event trigger matches. Called from the data plane (e.g. row
 * insert) and meant to be wrapped in ctx.waitUntil so the run executes after the
 * triggering response, never inside it. Best-effort — never throws into caller.
 */
const EVENT_TRIGGER_COOLDOWN_SECONDS = 60;

export async function emitCrewEvent(env: Env, artifactId: string, eventType: string): Promise<void> {
  try {
    const triggers = await env.DB.prepare(
      `SELECT * FROM crew_triggers
         WHERE artifact_id = ? AND kind = 'event' AND event_type = ? AND enabled = 1`
    )
      .bind(artifactId, eventType)
      .all<CrewTriggerRow>();

    const now = new Date().toISOString();
    for (const trigger of triggers.results) {
      const claimed = await env.DB.prepare(
        `UPDATE crew_triggers SET last_run_at = ?
           WHERE id = ? AND (last_run_at IS NULL OR last_run_at <= ?)`
      )
        .bind(now, trigger.id, isoIn(-EVENT_TRIGGER_COOLDOWN_SECONDS))
        .run();
      if (!claimed.meta.changes) continue;
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

export async function runDueCrewTriggers(env: Env, budgetMs = CREW_TICK_BUDGET_MS): Promise<{ executed: number; failed: number }> {
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

  // Queued event runs first (already due when they arrived), then again after the due triggers with
  // whatever budget is left, so an event that queued behind a cron run in this same tick starts without
  // waiting an hour. Always bounded by the tick budget, never a fresh one.
  const drainQueued = async () => {
    for (const ownerId of await ownersWithQueuedRuns(env).catch(() => [] as string[])) {
      const left = budgetMs - (Date.now() - nowMs);
      if (left <= 0) break;
      executed += await drainCrewQueue(env, ownerId, left).catch(() => 0);
    }
  };
  await drainQueued();

  for (const trigger of due.results) {
    if (Date.now() - nowMs > budgetMs) break; // untouched triggers stay due for the next tick
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

  await drainQueued();

  return { executed, failed };
}

async function runCronTrigger(env: Env, trigger: CrewTriggerRow, now: string): Promise<boolean> {
  // Claim-and-advance: advance next_run_at conditioned on the value we observed,
  // so an overlapping heartbeat can't dispatch the same trigger twice. Doing it
  // FIRST also means a slow/failing run can't re-fire next tick.
  const nextRunAt = trigger.cron ? getNextRunTime(trigger.cron) : null;
  const crew = await getCrewById(env, trigger.crew_id);
  if (crew && (await deferWhileOwnerBusy(env, crew, trigger, now))) return false;
  if (!(await claimTrigger(env, trigger, nextRunAt, now))) return false;

  if (!crew) return false;
  return dispatchCrewRun(env, crew, 'cron', trigger.id);
}

async function runConditionTrigger(env: Env, trigger: CrewTriggerRow, now: string): Promise<boolean> {
  const parsed = validateConditionConfig(trigger.condition_json ? JSON.parse(trigger.condition_json) : {});
  const cfg = parsed.ok ? parsed.config : {};

  const crew = await getCrewById(env, trigger.crew_id);
  if (!crew) {
    await setNextRun(env, trigger.id, isoIn(86400));
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
  if (await deferWhileOwnerBusy(env, crew, trigger, now)) return false;
  if (!(await claimTrigger(env, trigger, isoIn(clampSeconds(cfg.cooldownSeconds)), now))) return false;

  return dispatchCrewRun(env, crew, 'condition', trigger.id);
}

/**
 * Owner already has a crew run active: dispatch would be refused, and claiming first would lose this
 * occurrence (a weekly crew loses a week). Leave the trigger due so the next hourly tick retries; once it
 * has been due longer than the retry window, give up (the caller then advances it) and log.
 * Returns true when the caller should skip this tick without claiming.
 */
async function deferWhileOwnerBusy(env: Env, crew: CrewRow, trigger: CrewTriggerRow, now: string): Promise<boolean> {
  if (!(await ownerAtCapacity(env, crew.owner_id))) return false;
  const overdueMs = Date.parse(now) - Date.parse(String(trigger.next_run_at));
  if (overdueMs <= BUSY_RETRY_WINDOW_MS) return true;
  createLogger(env, { scope: 'crew-triggers' }).warn('crew trigger skipped: owner stayed busy past the retry window', {
    trigger_id: trigger.id,
    crew_id: crew.id,
    overdue_hours: Math.round(overdueMs / 3600000),
  });
  return false;
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
