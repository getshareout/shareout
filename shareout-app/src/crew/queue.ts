import type { Env } from '../types';
import { createLogger } from '../logging';
import { generateId } from '../crypto-utils';
import { getCrewById, reapStaleRuns } from './store';
import { ownerAtCapacity } from './limits';
import { buildOwnerDataContextForCrew } from './principal';
import { runCrewToCompletion } from './run-loop';
import type { CrewRow, CrewRunRow } from './types';

// Event-triggered runs that find their owner at the concurrency cap are queued, not dropped: a
// table.row.inserted wake may be a safety alert. A queued run is a crew_runs row with status 'queued'
// (it does not count toward the cap). It starts, oldest first, as soon as a run finishes or the next
// hourly tick, whichever comes first.
export const QUEUE_MAX_PER_OWNER = 20;
export const QUEUE_MAX_AGE_HOURS = 24;

/** Queue a run for later. False (logged) when the owner's queue is full. */
export async function enqueueCrewRun(env: Env, crew: CrewRow, triggerKind: string): Promise<boolean> {
  const n = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM crew_runs r JOIN crews c ON c.id = r.crew_id WHERE c.owner_id = ? AND r.status = 'queued'`
  ).bind(crew.owner_id).first<{ n: number }>();
  if ((n?.n ?? 0) >= QUEUE_MAX_PER_OWNER) {
    createLogger(env, { scope: 'crew-queue' }).warn('crew run dropped: owner queue is full', { crew_id: crew.id, owner_id: crew.owner_id, trigger_kind: triggerKind });
    return false;
  }
  await env.DB.prepare(
    `INSERT INTO crew_runs (id, crew_id, artifact_id, trigger_kind, status) VALUES (?, ?, ?, ?, 'queued')`
  ).bind(generateId('crun'), crew.id, crew.artifact_id, triggerKind).run();
  return true;
}

async function expireOld(env: Env, ownerId: string): Promise<void> {
  const r = await env.DB.prepare(
    `UPDATE crew_runs SET status = 'error', termination_reason = 'queue_expired', ended_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE status = 'queued' AND started_at < strftime('%Y-%m-%dT%H:%M:%fZ','now', '-' || ? || ' hours')
         AND crew_id IN (SELECT id FROM crews WHERE owner_id = ?)`
  ).bind(QUEUE_MAX_AGE_HOURS, ownerId).run();
  if (r.meta.changes) {
    createLogger(env, { scope: 'crew-queue' }).warn('queued crew runs expired without a free slot', { owner_id: ownerId, count: r.meta.changes });
  }
}

/** Start queued runs for one owner, oldest first, while a slot is free. Returns how many ran. */
export async function drainCrewQueue(env: Env, ownerId: string, budgetMs = 8 * 60 * 1000): Promise<number> {
  const t0 = Date.now();
  await reapStaleRuns(env).catch(() => 0);
  await expireOld(env, ownerId).catch(() => {});
  let ran = 0;
  while (Date.now() - t0 < budgetMs && !(await ownerAtCapacity(env, ownerId))) {
    const next = await env.DB.prepare(
      `SELECT r.* FROM crew_runs r JOIN crews c ON c.id = r.crew_id
        WHERE c.owner_id = ? AND r.status = 'queued' ORDER BY r.started_at, r.id LIMIT 1`
    ).bind(ownerId).first<CrewRunRow>();
    if (!next) break;
    // Claim: only one drainer wins a given row.
    const claimed = await env.DB.prepare(
      `UPDATE crew_runs SET status = 'running', started_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND status = 'queued'`
    ).bind(next.id).run();
    if (!claimed.meta.changes) continue;
    const crew = await getCrewById(env, next.crew_id);
    if (!crew || crew.status !== 'active') {
      await env.DB.prepare(`UPDATE crew_runs SET status = 'error', termination_reason = 'crew_inactive', ended_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).bind(next.id).run();
      continue;
    }
    try {
      const run = (await env.DB.prepare('SELECT * FROM crew_runs WHERE id = ?').bind(next.id).first<CrewRunRow>())!;
      await runCrewToCompletion({ env, crew, run, ownerCtx: await buildOwnerDataContextForCrew(env, crew), input: '' });
      ran++;
    } catch (err) {
      await env.DB.prepare(`UPDATE crew_runs SET status = 'error', termination_reason = 'error', ended_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND status = 'running'`).bind(next.id).run();
      createLogger(env, { scope: 'crew-queue' }).warn('queued crew run failed', { run_id: next.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return ran;
}

/** Owners with queued runs (for the hourly tick). */
export async function ownersWithQueuedRuns(env: Env): Promise<string[]> {
  const rows = await env.DB.prepare(
    `SELECT DISTINCT c.owner_id FROM crew_runs r JOIN crews c ON c.id = r.crew_id WHERE r.status = 'queued'`
  ).all<{ owner_id: string }>();
  return (rows.results || []).map((r) => r.owner_id);
}
