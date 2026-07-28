/**
 * Scheduled job CRUD — create, list, update, delete, and execution logs.
 */
import type { Env } from '../../types';
import { getUserRole } from '../../artifacts';
import { getDestination } from '../../delivery/registry';
import { isFeatureEnabled } from '../../features/flags';
import { generateId } from '../../crypto-utils';
import { enableInbound, disableInbound } from '../../email/inbox-store';
import { DEST_FEATURE, JOB_LIMIT_PER_USER } from './constants';
import { getNextRunTime, parseCronSchedule } from './cron';
import { invalidateViewEventJobCache } from './event-cache';
import { checkViewerSelfDelivery, canManageJob } from './permissions';
import {
  JOB_BACKOFF_TYPES,
  JOB_EVENT_TYPES,
  JOB_TRIGGER_TYPES,
  isJobBackoffType,
  isJobEventType,
  isJobTriggerType,
} from './types';
import type {
  CreateJobRequest,
  JobConfig,
  JobLog,
  RetryConfig,
  ScheduledJob,
} from './types';

export async function createJob(
  env: Env,
  userId: string,
  request: CreateJobRequest,
): Promise<{ job?: ScheduledJob; error?: string }> {
  const triggerType = request.trigger_type || 'cron';
  const eventType = request.event_type || null;

  // Enum guards for the columns D1 used to police with triggers (dropped in 0135).
  if (!isJobTriggerType(triggerType)) {
    return { error: `trigger_type must be one of: ${JOB_TRIGGER_TYPES.join(', ')}` };
  }

  if (triggerType === 'cron') {
    if (!request.schedule) {
      return { error: 'schedule required for cron jobs' };
    }
    const cronResult = parseCronSchedule(request.schedule);
    if (!cronResult.valid) {
      return { error: cronResult.error };
    }
  } else if (triggerType === 'event') {
    if (!eventType) {
      return { error: 'event_type required for event-triggered jobs' };
    }
    if (!isJobEventType(eventType)) {
      return { error: `event_type must be one of: ${JOB_EVENT_TYPES.join(', ')}` };
    }
  }

  const artifact = await env.DB.prepare(
    'SELECT id, workspace_id FROM artifacts WHERE id = ?',
  ).bind(request.artifact_id).first<{ id: string; workspace_id: string | null }>();

  if (!artifact) {
    return { error: 'Artifact not found' };
  }

  const schedFeature = triggerType === 'event' ? 'automation.event_triggers' : 'automation.scheduled_jobs';
  if (!(await isFeatureEnabled(env, schedFeature, artifact.workspace_id))) {
    return { error: 'Scheduling is disabled for this workspace' };
  }
  const createDestFeature = DEST_FEATURE[request.action];
  if (createDestFeature && !(await isFeatureEnabled(env, createDestFeature, artifact.workspace_id))) {
    return { error: `Delivery to ${request.action} is disabled for this workspace` };
  }

  const role = await getUserRole(env, request.artifact_id, userId);
  if (!role) {
    return { error: 'Permission denied: no access to this artifact' };
  }
  if (role !== 'owner' && role !== 'editor') {
    const selfError = await checkViewerSelfDelivery(env, userId, request.action, request.config);
    if (selfError) {
      return { error: selfError };
    }
  }

  const today = new Date().toISOString().split('T')[0];
  const jobCount = await env.DB.prepare(
    "SELECT count FROM rate_limits WHERE principal_type = 'user' AND principal_id = ? AND action = ? AND window_start = ?",
  ).bind(userId, 'schedule:job', today).first<{ count: number }>();

  if ((jobCount?.count || 0) >= JOB_LIMIT_PER_USER) {
    return { error: `Job limit reached (${JOB_LIMIT_PER_USER} per user)` };
  }

  const destination = getDestination(request.action);
  if (!destination) {
    return { error: `Unknown action: ${request.action}` };
  }
  const configError = await destination.validate(
    env,
    { artifactId: request.artifact_id, createdBy: userId, triggeredVia: 'manual' },
    request.config,
  );
  if (configError) {
    return { error: configError };
  }

  const backoffType = request.retry_config?.backoffType ?? 'fixed';
  if (!isJobBackoffType(backoffType)) {
    return { error: `backoff_type must be one of: ${JOB_BACKOFF_TYPES.join(', ')}` };
  }

  const retryConfig: RetryConfig = {
    maxAttempts: Math.min(Math.max(request.retry_config?.maxAttempts ?? 1, 0), 10),
    backoffType,
    initialDelay: Math.min(Math.max(request.retry_config?.initialDelay ?? 300, 60), 3600),
  };

  const id = generateId('job');
  const nextRunAt = triggerType === 'cron' && request.schedule
    ? getNextRunTime(request.schedule)
    : Math.floor(Date.now() / 1000) + 86400;

  const title = typeof request.title === 'string' ? request.title.slice(0, 200) : null;
  const description = typeof request.description === 'string' ? request.description.slice(0, 1000) : null;

  await env.DB.prepare(`
    INSERT INTO scheduled_jobs (
      id, artifact_id, owner_id, title, description, action, schedule, config,
      trigger_type, event_type, max_attempts, backoff_type, initial_delay,
      next_run_at, enabled
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).bind(
    id,
    request.artifact_id,
    userId,
    title,
    description,
    request.action,
    request.schedule || '',
    JSON.stringify(request.config),
    triggerType,
    eventType,
    retryConfig.maxAttempts,
    retryConfig.backoffType,
    retryConfig.initialDelay,
    nextRunAt,
  ).run();

  await env.DB.prepare(`
    INSERT INTO rate_limits (principal_type, principal_id, action, window_start, count)
    VALUES ('user', ?, 'schedule:job', ?, 1)
    ON CONFLICT (principal_type, principal_id, action, window_start) DO UPDATE SET count = count + 1
  `).bind(userId, today).run();

  const job = await env.DB.prepare('SELECT * FROM scheduled_jobs WHERE id = ?')
    .bind(id)
    .first<ScheduledJob>();

  await invalidateViewEventJobCache(env, request.artifact_id);

  if (eventType === 'email.received') {
    await enableInbound(env, request.artifact_id);
  }

  return { job: job ? { ...job, config: JSON.parse(job.config as unknown as string) } : undefined };
}

export async function listJobs(env: Env, userId: string, artifactId?: string): Promise<ScheduledJob[]> {
  let query = "SELECT sj.*, a.name AS artifact_name, COALESCE(d.slug, a.slug) AS artifact_slug FROM scheduled_jobs sj LEFT JOIN artifacts a ON a.id = sj.artifact_id LEFT JOIN deployments d ON d.artifact_id = a.id AND d.channel = 'production' WHERE sj.owner_id = ?";
  const params: string[] = [userId];

  if (artifactId) {
    query += ' AND sj.artifact_id = ?';
    params.push(artifactId);
  }

  query += ' ORDER BY sj.created_at DESC';

  const result = await env.DB.prepare(query).bind(...params).all<ScheduledJob>();

  return (result.results || []).map(job => ({
    ...job,
    config: JSON.parse(job.config as unknown as string),
    enabled: Boolean(job.enabled),
  }));
}

/** Owner/editor sees all jobs on the artifact; others see only their own. */
export async function listJobsForArtifact(
  env: Env,
  artifactId: string,
  requesterId: string,
): Promise<ScheduledJob[]> {
  const role = await getUserRole(env, artifactId, requesterId);
  const canManageAll = role === 'owner' || role === 'editor';

  const query = canManageAll
    ? 'SELECT * FROM scheduled_jobs WHERE artifact_id = ? ORDER BY created_at DESC'
    : 'SELECT * FROM scheduled_jobs WHERE artifact_id = ? AND owner_id = ? ORDER BY created_at DESC';
  const params = canManageAll ? [artifactId] : [artifactId, requesterId];

  const result = await env.DB.prepare(query).bind(...params).all<ScheduledJob>();
  return (result.results || []).map(job => ({
    ...job,
    config: JSON.parse(job.config as unknown as string),
    enabled: Boolean(job.enabled),
  }));
}

export async function getJobLogs(
  env: Env,
  userId: string,
  jobId: string,
): Promise<{ logs?: JobLog[]; error?: string }> {
  const job = await env.DB.prepare('SELECT owner_id, artifact_id FROM scheduled_jobs WHERE id = ?')
    .bind(jobId).first<{ owner_id: string; artifact_id: string }>();
  if (!job) return { error: 'Job not found' };
  if (!(await canManageJob(env, job, userId))) return { error: 'Permission denied' };

  const result = await env.DB.prepare(
    `SELECT id, created_at, status, duration_ms, error FROM job_runs
     WHERE job_id = ? ORDER BY created_at DESC LIMIT 50`,
  ).bind(jobId).all<JobLog>();
  return { logs: result.results || [] };
}

export async function deleteJob(
  env: Env,
  userId: string,
  jobId: string,
): Promise<{ success: boolean; error?: string }> {
  const job = await env.DB.prepare('SELECT owner_id, artifact_id, trigger_type, event_type FROM scheduled_jobs WHERE id = ?')
    .bind(jobId)
    .first<{ owner_id: string; artifact_id: string; trigger_type: string; event_type: string | null }>();

  if (!job) {
    return { success: false, error: 'Job not found' };
  }

  if (!(await canManageJob(env, job, userId))) {
    return { success: false, error: 'Permission denied' };
  }

  await env.DB.prepare('DELETE FROM scheduled_jobs WHERE id = ?').bind(jobId).run();

  await invalidateViewEventJobCache(env, job.artifact_id);

  if (job.trigger_type === 'event' && job.event_type === 'email.received') {
    const remaining = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM scheduled_jobs
        WHERE artifact_id = ? AND trigger_type = 'event' AND event_type = 'email.received'`,
    ).bind(job.artifact_id).first<{ n: number }>();
    if ((remaining?.n ?? 0) === 0) {
      await disableInbound(env, job.artifact_id);
    }
  }

  return { success: true };
}

export async function updateJob(
  env: Env,
  userId: string,
  jobId: string,
  updates: { enabled?: boolean; schedule?: string; config?: JobConfig; title?: string | null; description?: string | null },
): Promise<{ job?: ScheduledJob; error?: string }> {
  const job = await env.DB.prepare('SELECT * FROM scheduled_jobs WHERE id = ?')
    .bind(jobId)
    .first<ScheduledJob>();

  if (!job) {
    return { error: 'Job not found' };
  }

  if (!(await canManageJob(env, job, userId))) {
    return { error: 'Permission denied' };
  }

  const sets: string[] = [];
  const params: (string | number | boolean | null)[] = [];

  if (updates.enabled !== undefined) {
    sets.push('enabled = ?');
    params.push(updates.enabled ? 1 : 0);
  }

  if (updates.schedule) {
    const cronResult = parseCronSchedule(updates.schedule);
    if (!cronResult.valid) {
      return { error: cronResult.error };
    }
    sets.push('schedule = ?');
    params.push(updates.schedule);
    sets.push('next_run_at = ?');
    params.push(getNextRunTime(updates.schedule));
  }

  if (updates.config) {
    sets.push('config = ?');
    params.push(JSON.stringify(updates.config));
  }

  if (updates.title !== undefined) {
    sets.push('title = ?');
    params.push(updates.title === null ? null : String(updates.title).slice(0, 200));
  }

  if (updates.description !== undefined) {
    sets.push('description = ?');
    params.push(updates.description === null ? null : String(updates.description).slice(0, 1000));
  }

  if (sets.length === 0) {
    return { error: 'No updates provided' };
  }

  sets.push('updated_at = ?');
  params.push(Math.floor(Date.now() / 1000));
  params.push(jobId);

  await env.DB.prepare(`UPDATE scheduled_jobs SET ${sets.join(', ')} WHERE id = ?`).bind(...params).run();

  const updated = await env.DB.prepare('SELECT * FROM scheduled_jobs WHERE id = ?')
    .bind(jobId)
    .first<ScheduledJob>();

  await invalidateViewEventJobCache(env, job.artifact_id);

  return { job: updated ? { ...updated, config: JSON.parse(updated.config as unknown as string) } : undefined };
}
