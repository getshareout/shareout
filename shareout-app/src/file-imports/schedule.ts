/**
 * Daily sync: the hourly cron starts a run for each daily source that is due, at most
 * SCHEDULED_SOURCES_PER_TICK per tick (oldest first), and moves it a day on. A source
 * whose connection was revoked has daily sync off and connection_id NULL, so it is
 * never picked.
 */
import type { Env } from '../types';
import { SCHEDULED_SOURCES_PER_TICK } from './types';
import { createRun, type SourceRow } from './runs';
import { launchRun } from './launch';

export async function runDueFileImports(env: Env, now = new Date()): Promise<{ started: number }> {
  const due = (await env.DB.prepare(`
    SELECT * FROM file_import_sources
    WHERE daily_sync_enabled = 1 AND connection_id IS NOT NULL AND next_sync_at IS NOT NULL AND next_sync_at <= ?
    ORDER BY next_sync_at LIMIT ?
  `).bind(now.toISOString(), SCHEDULED_SOURCES_PER_TICK).all<SourceRow>()).results || [];
  let started = 0;
  for (const s of due) {
    await env.DB.prepare('UPDATE file_import_sources SET next_sync_at = ? WHERE id = ?')
      .bind(new Date(now.getTime() + 24 * 3600_000).toISOString(), s.id).run();
    const r = await createRun(env, s, 'schedule', null);
    if ('conflict' in r) continue;
    await launchRun(env, undefined, r.runId);
    started++;
  }
  return { started };
}
