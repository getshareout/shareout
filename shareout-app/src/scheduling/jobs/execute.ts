/**
 * Cron tick execution and manual job runs.
 */
import type { Env } from '../../types';
import { generateId } from '../../crypto-utils';
import { createLogger } from '../../logging';
import {
  MAX_TEST_JOBS_PER_TICK,
  TEST_JOBS_BUDGET_MS,
} from './constants';
import { getNextRunTime } from './cron';
import { canManageJob } from './permissions';
import { calculateBackoffDelay } from './retry';
import { executeJobAction, recordJobSteps } from './runner';
import type { DeliveryStep } from '../../delivery/types';
import type { RetryConfig, RunJobResult, ScheduledJob } from './types';

/** Process due cron jobs (up to 50 per tick) with retry and artifact_test throttling. */
export async function runScheduledJobs(env: Env): Promise<{ executed: number; failed: number }> {
  const now = Math.floor(Date.now() / 1000);

  const dueJobs = await env.DB.prepare(`
    SELECT * FROM scheduled_jobs
    WHERE enabled = 1 AND trigger_type = 'cron' AND next_run_at <= ?
    ORDER BY next_run_at ASC
    LIMIT 50
  `).bind(now).all<ScheduledJob>();

  let executed = 0;
  let failed = 0;
  let testJobsRun = 0;
  let testBudgetMs = 0;
  let testJobsDeferred = 0;

  for (const job of dueJobs.results || []) {
    if (job.action === 'artifact_test' &&
        (testJobsRun >= MAX_TEST_JOBS_PER_TICK || testBudgetMs >= TEST_JOBS_BUDGET_MS)) {
      testJobsDeferred++;
      continue;
    }
    const config = JSON.parse(job.config as unknown as string);
    const startTime = Date.now();
    let result: { success: boolean; error?: string; disable?: boolean };

    const retryConfig: RetryConfig = {
      maxAttempts: job.max_attempts ?? 1,
      backoffType: job.backoff_type ?? 'fixed',
      initialDelay: job.initial_delay ?? 300,
    };

    try {
      result = await executeJobAction(env, job.action, job.artifact_id, job.owner_id, config, 'cron');
    } catch (err) {
      result = { success: false, error: `Execution error: ${err}` };
    }

    const duration = Date.now() - startTime;
    if (job.action === 'artifact_test') {
      testJobsRun++;
      testBudgetMs += duration;
    }
    const nextRunAt = job.schedule ? getNextRunTime(job.schedule) : now + 86400;

    let statusStmt;
    if (result.success) {
      statusStmt = env.DB.prepare(`
        UPDATE scheduled_jobs
        SET last_run_at = ?, last_status = 'success', last_error = NULL, retry_count = 0, next_run_at = ?
        WHERE id = ?
      `).bind(now, nextRunAt, job.id);
      executed++;
    } else if (result.disable) {
      statusStmt = env.DB.prepare(`
        UPDATE scheduled_jobs
        SET last_run_at = ?, last_status = 'failed', last_error = ?, enabled = 0
        WHERE id = ?
      `).bind(now, result.error || 'Access revoked', job.id);
      failed++;
    } else {
      // retry_count = retries already done; the current run is attempt retry_count+1.
      // Retry only while total attempts so far is below maxAttempts.
      const shouldRetry = job.retry_count < retryConfig.maxAttempts - 1;

      if (shouldRetry) {
        const delay = calculateBackoffDelay(retryConfig, job.retry_count);
        statusStmt = env.DB.prepare(`
          UPDATE scheduled_jobs
          SET last_run_at = ?, last_status = 'failed', last_error = ?, retry_count = retry_count + 1, next_run_at = ?
          WHERE id = ?
        `).bind(now, result.error || 'Unknown error', now + delay, job.id);
      } else {
        statusStmt = env.DB.prepare(`
          UPDATE scheduled_jobs
          SET last_run_at = ?, last_status = 'failed', last_error = ?, retry_count = 0, next_run_at = ?
          WHERE id = ?
        `).bind(now, result.error || 'Unknown error', nextRunAt, job.id);
      }
      failed++;
    }

    // ponytail: status + log land in one D1 batch (3 round trips → 1 per job);
    // jobs stay sequential — Snowflake-backed actions rate-limit when concurrent.
    const logId = generateId('log');
    await env.DB.batch([
      statusStmt,
      env.DB.prepare(`
        INSERT INTO job_runs (id, job_id, created_at, status, duration_ms, error)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(logId, job.id, now, result.success ? 'success' : 'failed', duration, result.error || null),
    ]);
    await recordJobSteps(env, logId, job.id, result);
  }

  if (testJobsDeferred > 0) {
    createLogger(env, { component: 'scheduled-jobs' }).info(
      'deferred scheduled artifact-test jobs to next tick (per-tick budget reached)',
      { deferred: testJobsDeferred, ran: testJobsRun, budgetMs: testBudgetMs },
    );
  }

  return { executed, failed };
}

export async function runJobManually(
  env: Env,
  userId: string,
  jobId: string,
): Promise<{ result?: RunJobResult; error?: string }> {
  const job = await env.DB.prepare('SELECT * FROM scheduled_jobs WHERE id = ?')
    .bind(jobId)
    .first<ScheduledJob>();

  if (!job) return { error: 'Job not found' };
  if (!(await canManageJob(env, job, userId))) return { error: 'Permission denied' };

  return { result: await executeJobNow(env, job) };
}

/** Run a job immediately and write a log row. No permission check — callers gate. */
export async function executeJobNow(env: Env, job: ScheduledJob): Promise<RunJobResult> {
  const config = JSON.parse(job.config as unknown as string);
  const startTime = Date.now();
  let result: { success: boolean; error?: string; steps?: DeliveryStep[] };

  try {
    result = await executeJobAction(env, job.action, job.artifact_id, job.owner_id, config, 'manual');
  } catch (err) {
    result = { success: false, error: `Execution error: ${err}` };
  }

  const duration = Date.now() - startTime;
  const now = Math.floor(Date.now() / 1000);

  const logId = generateId('log');
  await env.DB.prepare(`
    INSERT INTO job_runs (id, job_id, created_at, status, duration_ms, error)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(logId, job.id, now, result.success ? 'success' : 'failed', duration, result.error || null).run();
  await recordJobSteps(env, logId, job.id, result);

  return {
    success: result.success,
    job_id: job.id,
    execution_id: logId,
    status: result.success ? 'success' : 'failed',
    error: result.error,
    duration_ms: duration,
  };
}
