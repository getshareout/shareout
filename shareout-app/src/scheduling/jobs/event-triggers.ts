/**
 * Event-triggered job dispatch (artifact.updated, viewed, comment, email.received).
 */
import type { Env, EmailReceivedPayload } from '../../types';
import { generateId } from '../../crypto-utils';
import { executeJobAction, recordJobSteps } from './runner';
import type { JobEventType, ScheduledJob } from './types';

export async function runEventTriggeredJobs(
  env: Env,
  artifactId: string,
  eventType: JobEventType,
  eventPayload?: EmailReceivedPayload,
): Promise<{ executed: number; failed: number }> {
  const jobs = await env.DB.prepare(`
    SELECT * FROM scheduled_jobs
    WHERE artifact_id = ? AND trigger_type = 'event' AND event_type = ? AND enabled = 1
  `).bind(artifactId, eventType).all<ScheduledJob>();

  let executed = 0;
  let failed = 0;

  for (const job of jobs.results || []) {
    const config = JSON.parse(job.config as unknown as string);
    const startTime = Date.now();
    let result: { success: boolean; error?: string; disable?: boolean };

    try {
      result = await executeJobAction(
        env, job.action, job.artifact_id, job.owner_id, config, 'event', eventPayload,
      );
    } catch (err) {
      result = { success: false, error: `Execution error: ${err}` };
    }

    const duration = Date.now() - startTime;
    const now = Math.floor(Date.now() / 1000);

    await env.DB.prepare(`
      UPDATE scheduled_jobs
      SET last_run_at = ?, last_status = ?, last_error = ?${result.disable ? ', enabled = 0' : ''}
      WHERE id = ?
    `).bind(now, result.success ? 'success' : 'failed', result.error || null, job.id).run();

    const logId = generateId('log');
    await env.DB.prepare(`
      INSERT INTO job_runs (id, job_id, created_at, status, duration_ms, error)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(logId, job.id, now, result.success ? 'success' : 'failed', duration, result.error || null).run();
    await recordJobSteps(env, logId, job.id, result);

    result.success ? executed++ : failed++;
  }

  return { executed, failed };
}
