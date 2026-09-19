/**
 * Owner alert when a scheduled job starts failing. The bell already lists every
 * failed run (Needs You); this adds one email per success→failed flip so a job
 * that breaks overnight doesn't fail silently on every tick after.
 */
import type { Env } from '../../types';
import { dispatchLifecycleEmail } from '../../email/gateway';
import type { ScheduledJob } from './types';

export async function notifyJobFailed(env: Env, job: ScheduledJob, error: string): Promise<void> {
  try {
    await dispatchLifecycleEmail(env, {
      type: 'job_failed',
      toUserId: job.owner_id,
      data: { jobName: job.title || `${job.action} schedule`, error },
    });
  } catch {
    // Best-effort; never break the cron batch.
  }
}
