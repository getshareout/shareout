import type { Env } from '../types';
import { runDueFileImports } from '../file-imports/schedule';
import { runVersionNoticeSweep } from '../notify/review-notify';
import { getUserRole } from '../artifacts/roles';
import { purgeSoftDeleted } from '../artifacts/crud';
import { createJob, listJobs, listJobsForArtifact, deleteJob, updateJob, getJobLogs } from './jobs/crud';
import { createArtifactEmail, getArtifactEmail } from './jobs/artifact-email';
import { runScheduledJobs, runJobManually } from './jobs/execute';
import { type CreateJobRequest, type JobConfig, type JobLog, type ScheduledJob } from './jobs/types';
import { aggregateDailyStats, cleanupOldEvents } from '../analytics';
import { cleanupExpiredAdminSessions, cleanupOldRateLimits } from '../api-auth';
import { cleanupExpiredDeviceCodes } from '../auth/device-auth';
import { cleanupMcpOAuth } from '../mcp/oauth';
import { cronCadenceNotice } from './jobs/cron';
import { runDueCrewTriggers } from '../crew/triggers';
import { runModerationRescan, recheckPendingModeration, recheckFailOpenModeration } from '../moderation/rescan';
import { checkContentDomainReputation, runBandwidthAutoPause } from '../moderation/maintenance';
import { checkPublicAutoRollback } from '../public-rollout';
import { reapStaleApprovals } from '../crew/approvals';
import { autoCloseIdleTickets } from '../support/store';
import { runDueMetricAlerts } from '../metric-alerts/rules';
import { cleanupObservability } from '../observability/store';
import { cleanupBuildTraces } from '../build-agent/trace';
import { cleanupAuditLog } from '../audit';
import { createLogger } from '../logging';
import { runStorageSnapshots } from '../storage-snapshots';
import { reconcileAiUsage } from '../data/ai-usage-reconcile';
import { checkDailyAiSpend } from '../data/agent/ai-ops-alerts';
import { rollupWorkspaceUsage, utcDay } from '../workspaces/usage-ledger';
import { runLifecycleEmails } from '../email/lifecycle-cron';
import { runWeeklyWorkspaceDigest } from '../email/weekly-digest';
import { runStaleDataSweep } from '../data/sheets/stale-sweep';
import { runUnusedArtifactSweep } from '../artifacts/unused-sweep';
import { runMetricWatchSweep } from '../metric-watch/watches';
import { runSummaryBackfill } from '../publish/summary-backfill';
import { syncOfficialSkills, officialSkillsSynced } from '../official-skills/sync';
import { runKnowledgeDistill } from '../knowledge/distill';
import { runKnowledgeConsolidate } from '../knowledge/consolidate';
import { runCorpusRefresh } from '../knowledge/corpus/reindex';
import { simpleApiError } from '../http/api-error';
import { JOB_ACTIONS, isJobAction } from './jobs/types';

interface AuthenticatedUser {
  id: string;
  email: string | null;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(error: string, code: string, status: number): Response {
  return simpleApiError(error, code, status);
}

/** scheduled_jobs/job_runs keep unix-seconds timestamps; the API speaks ISO 8601. */
function isoTime(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number' || /^\d+(\.\d+)?$/.test(String(v))) return new Date(Number(v) * 1000).toISOString();
  return String(v);
}

/** One response shape for create/get/list/patch: ISO timestamps, boolean enabled,
 *  next_run_at only for cron jobs (event jobs have no schedule). */
export function toApiJob(job: ScheduledJob & { updated_at?: unknown }) {
  return {
    ...job,
    enabled: Boolean(job.enabled),
    next_run_at: job.trigger_type === 'event' ? null : isoTime(job.next_run_at),
    last_run_at: isoTime(job.last_run_at),
    created_at: isoTime(job.created_at),
    updated_at: isoTime(job.updated_at),
  };
}

function toApiLog(log: JobLog) {
  return { ...log, created_at: isoTime(log.created_at) };
}

function mapCreateJobConstraintError(err: unknown): string | null {
  const message = err instanceof Error ? err.message : String(err);
  if (!message.includes('SQLITE_CONSTRAINT')) return null;
  const cleaned = message
    .replace(/^D1_ERROR:\s*/i, '')
    .replace(/:\s*SQLITE_CONSTRAINT.*$/i, '')
    .trim();
  return cleaned || 'Invalid job configuration';
}

export async function handleCreateJob(request: Request, env: Env, user: AuthenticatedUser): Promise<Response> {
  let body: CreateJobRequest;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON', 'INVALID_JSON', 400);
  }

  if (!body.artifact_id) {
    return errorResponse('artifact_id required', 'INVALID_REQUEST', 400);
  }

  if (!isJobAction(body.action)) {
    return errorResponse(`action must be one of: ${JOB_ACTIONS.join(', ')}`, 'INVALID_REQUEST', 400);
  }

  const triggerType = body.trigger_type || 'cron';
  if (triggerType === 'cron' && !body.schedule) {
    return errorResponse('schedule required for cron jobs', 'INVALID_REQUEST', 400);
  }

  if (triggerType === 'event' && !body.event_type) {
    return errorResponse('event_type required for event-triggered jobs', 'INVALID_REQUEST', 400);
  }

  if (!body.config) {
    return errorResponse('config required', 'INVALID_REQUEST', 400);
  }

  let result;
  try {
    result = await createJob(env, user.id, body);
  } catch (err) {
    const mapped = mapCreateJobConstraintError(err);
    if (mapped) {
      return errorResponse(mapped, 'INVALID_REQUEST', 400);
    }
    throw err;
  }

  if (result.error) {
    if (/^(Permission denied|Viewers can only)/.test(result.error)) {
      return errorResponse(result.error, 'FORBIDDEN', 403);
    }
    return errorResponse(result.error, 'INVALID_REQUEST', 400);
  }

  const notice = triggerType === 'cron' && body.schedule ? cronCadenceNotice(body.schedule) : null;
  return jsonResponse({ job: result.job && toApiJob(result.job), ...(notice ? { notice } : {}) }, 201);
}

export async function handleListJobs(request: Request, env: Env, user: AuthenticatedUser): Promise<Response> {
  const url = new URL(request.url);
  const artifactId = url.searchParams.get('artifact_id') || undefined;
  const workspaceId = url.searchParams.get('workspace_id') || undefined;

  // Scoped to an artifact: owners/editors see its shared schedules plus their own
  // DM subscriptions (other people's stay private). Unscoped: the user's own schedules across artifacts,
  // optionally narrowed to one workspace.
  const jobs = artifactId
    ? await listJobsForArtifact(env, artifactId, user.id)
    : await listJobs(env, user.id, undefined, workspaceId);

  return jsonResponse({ jobs: jobs.map(toApiJob) });
}

export async function handleGetJobLogs(env: Env, user: AuthenticatedUser, jobId: string): Promise<Response> {
  const result = await getJobLogs(env, user.id, jobId);
  if (result.error) {
    const status = result.error === 'Job not found' ? 404 : 403;
    return errorResponse(result.error, result.error === 'Job not found' ? 'NOT_FOUND' : 'FORBIDDEN', status);
  }
  return jsonResponse({ logs: (result.logs || []).map(toApiLog) });
}

export async function handleGetJob(env: Env, user: AuthenticatedUser, jobId: string): Promise<Response> {
  const jobs = await listJobs(env, user.id);
  const job = jobs.find(j => j.id === jobId);

  if (!job) {
    return errorResponse('Job not found', 'NOT_FOUND', 404);
  }

  return jsonResponse({ job: toApiJob(job) });
}

export async function handleUpdateJob(
  request: Request,
  env: Env,
  user: AuthenticatedUser,
  jobId: string
): Promise<Response> {
  let body: { enabled?: boolean; schedule?: string; config?: JobConfig; title?: string | null; description?: string | null };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON', 'INVALID_JSON', 400);
  }

  const result = await updateJob(env, user.id, jobId, body);

  if (result.error) {
    const status = result.error === 'Job not found' ? 404 : result.error === 'Permission denied' ? 403 : 400;
    return errorResponse(result.error, result.error === 'Job not found' ? 'NOT_FOUND' : 'INVALID_REQUEST', status);
  }

  return jsonResponse({ job: result.job && toApiJob(result.job) });
}

export async function handleDeleteJob(env: Env, user: AuthenticatedUser, jobId: string): Promise<Response> {
  const result = await deleteJob(env, user.id, jobId);

  if (result.error) {
    const status = result.error === 'Job not found' ? 404 : 403;
    return errorResponse(result.error, result.error === 'Job not found' ? 'NOT_FOUND' : 'FORBIDDEN', status);
  }

  return jsonResponse({ success: true });
}

export async function handleRunJob(env: Env, user: AuthenticatedUser, jobId: string): Promise<Response> {
  const result = await runJobManually(env, user.id, jobId);

  if (result.error) {
    const status = result.error === 'Job not found' ? 404 : result.error === 'Permission denied' ? 403 : 400;
    return errorResponse(result.error, result.error === 'Job not found' ? 'NOT_FOUND' : 'FORBIDDEN', status);
  }

  return jsonResponse({
    message: result.result?.success ? 'Job executed successfully' : 'Job execution failed',
    execution: result.result,
  });
}

export async function handleCreateArtifactEmail(
  request: Request,
  env: Env,
  user: AuthenticatedUser,
  artifactId: string
): Promise<Response> {
  let body: { reply_to?: string } = {};
  try {
    body = await request.json();
  } catch {
    // Empty body is fine
  }

  const result = await createArtifactEmail(env, user.id, artifactId, body.reply_to);

  if (result.error) {
    const status = result.error === 'Artifact not found' ? 404 : result.error.includes('Permission') ? 403 : 400;
    return errorResponse(result.error, result.error === 'Artifact not found' ? 'NOT_FOUND' : 'INVALID_REQUEST', status);
  }

  return jsonResponse({ email: result.email }, 201);
}

export async function handleGetArtifactEmail(env: Env, user: AuthenticatedUser, artifactId: string): Promise<Response> {
  const role = await getUserRole(env, artifactId, user.id);
  if (!role) {
    return errorResponse('Artifact not found or no access', 'NOT_FOUND', 404);
  }

  const email = await getArtifactEmail(env, artifactId);

  return jsonResponse({ email });
}

export async function handleScheduledEvent(env: Env, scheduledTime?: number): Promise<void> {
  const logger = createLogger(env, { scope: 'scheduling', event: 'cron.daily' });
  // Gate off the cron's intended fire time, not wall-clock. If the worker runs a
  // few seconds late (or its clock sits at :01 when the :00 cron fires), a
  // wall-clock `new Date()` slips past the `minute === 0` / `hour === N` windows
  // and the whole daily job (digest, moderation, trial reminders, snapshots)
  // silently no-ops for the day. scheduledTime is the exact scheduled instant.
  const now = scheduledTime !== undefined ? new Date(scheduledTime) : new Date();
  const hour = now.getUTCHours();
  const minute = now.getUTCMinutes();

  // User scheduled jobs: once per cron tick (hourly — wrangler.toml `crons`).
  const jobResult = await runScheduledJobs(env);

  // Daily folder syncs from Google Drive / OneDrive / SharePoint (src/file-imports),
  // capped per tick. Cheap no-op SELECT when nothing is due.
  const fileImports = await runDueFileImports(env).catch(() => ({ started: 0 }));
  if (fileImports.started > 0) logger.info('file import syncs started', { started: fileImports.started });

  // Dispatch due crew cron triggers (Phase 1). Hourly granularity.
  const crewResult = await runDueCrewTriggers(env);

  // Evaluate due metric alert rules (Follow Metric Alerts). Per-minute granularity.
  const alertResult = await runDueMetricAlerts(env);

  // Stale-data sentinel: flag artifacts whose Sheets source hasn't synced in 7+
  // days. Self-deduped via last_notified_stale_at cooldown, so safe every hour.
  const staleResult = await runStaleDataSweep(env).catch(() => ({ notified: 0 }));
  if (staleResult.notified > 0) {
    logger.info('stale data sweep finished', { notified: staleResult.notified });
  }
  // Metric watch: re-read each watched metric, advance its baseline, and drop a
  // bell event when it moved ≥ threshold. Self-deduped via the 6h cooldown.
  const watchResult = await runMetricWatchSweep(env).catch(() => ({ alerted: 0 }));
  if (watchResult.alerted > 0) {
    logger.info('metric watch sweep finished', { alerted: watchResult.alerted });
  }
  // New-version notices: one per artifact once publishing has been quiet for 10 minutes,
  // to its followers and collaborators. Claims each version in email_log, so safe hourly.
  const versionNotices = await runVersionNoticeSweep(env).catch(() => ({ notified: 0 }));
  if (versionNotices.notified > 0) {
    logger.info('version notice sweep finished', { notified: versionNotices.notified });
  }
  // AI spend: replace call-time estimates with the gateway's debited cost, reprice rows
  // whose model wasn't priced yet, and log an error to /admin health when credit runs low.
  const aiUsage = await reconcileAiUsage(env).catch((err) => { logger.error('AI usage reconcile failed', { error: String(err) }); return null; });
  if (aiUsage && aiUsage.actual + aiUsage.repriced > 0) {
    logger.info('AI usage reconciled', aiUsage);
  }
  // Daily spend line (AI_SPEND_ALERT_USD_PER_DAY): one Telegram alert per UTC day once crossed.
  await checkDailyAiSpend(env).catch((err) => { logger.error('AI spend check failed', { error: String(err) }); });
  // Never-viewed janitor: flag workspaces with 3+ published pages nobody's opened in
  // 90+ days. Self-gated to at most once/30 days per workspace (last_janitor_at), so
  // safe to call every hour — it's a cheap no-op SELECT when nothing is due.
  const janitorResult = await runUnusedArtifactSweep(env).catch(() => ({ notified: 0 }));
  if (janitorResult.notified > 0) {
    logger.info('unused-artifact janitor finished', { notified: janitorResult.notified });
  }
  // Auto-summary drip backfill: generate TL;DR + tags for existing html artifacts
  // published before auto-summary shipped. Self-terminating (auto-summary_hash gets
  // stamped even on unparseable output), so the backlog drains and the sweep becomes
  // a cheap no-op SELECT. Capped at 25 LLM calls/run.
  const backfillResult = await runSummaryBackfill(env).catch(() => ({ processed: 0 }));
  if (backfillResult.processed > 0) {
    logger.info('summary backfill finished', { processed: backfillResult.processed });
  }

  // Pending-hold self-heal (work/045 A): re-classify the oldest held artifacts every
  // hour. A hold from a transient classifier error or a since-fixed false-positive
  // flips to approved and its held visibility is restored. Cheap no-op when empty.
  const recheck = await recheckPendingModeration(env).catch(() => ({ checked: 0, approved: 0 }));
  if (recheck.approved > 0) {
    logger.info('moderation recheck finished', { approved: recheck.approved, checked: recheck.checked });
  }
  // Fail-open recheck: pages approved unreviewed during a classifier outage get their
  // real verdict; anything no longer clean is pulled private.
  const failOpen = await recheckFailOpenModeration(env).catch(() => ({ checked: 0, held: 0 }));
  if (failOpen.checked > 0) {
    logger.info('fail-open moderation recheck finished', { checked: failOpen.checked, held: failOpen.held });
  }

  // Public-artifacts moderation re-scan (Workstream D3): URL-reputation sweep over
  // the oldest-checked approved public artifacts. Daily at 04:00 UTC.
  if (hour === 4 && minute === 0) {
    await runModerationRescan(env).catch(() => {});
    // Daily public-artifacts maintenance (Workstreams G/H): content-domain
    // reputation watch + estimated-bandwidth auto-pause for free accounts.
    await checkContentDomainReputation(env).catch(() => {});
    await runBandwidthAutoPause(env).catch(() => {});
  }

  // Support: auto-close resolved tickets left idle past the window. Daily at 05:00 UTC.
  if (hour === 5 && minute === 0) {
    await autoCloseIdleTickets(env).catch(() => {});
  }

  // Storage snapshots (work/032). 12:00 UTC, idempotent per day.
  if (hour === 12 && minute === 0) {
    const snap = await runStorageSnapshots(env).catch(() => ({ workspaces: 0, overCap: 0 }));
    if (snap.workspaces > 0) {
      logger.info('storage snapshots finished', {
        workspaces: snap.workspaces,
        over_cap: snap.overCap,
      });
    }
  }

  // Workspace usage ledger: roll up the UTC day that just ended. Storage is measured
  // from R2 now, i.e. as of that day's close.
  if (hour === 0 && minute === 0) {
    const yesterday = utcDay(new Date(now.getTime() - 86_400_000));
    await rollupWorkspaceUsage(env, yesterday, { measureStorage: true }).catch((err) => {
      logger.error('usage rollup failed', { day: yesterday, error: err instanceof Error ? err.message : String(err) });
    });
  }

  // Official skills: keep the "Recommended by ShareOut" catalog fresh in every
  // workspace's Skill Library. Re-publishes only skills whose content changed. Daily
  // 06:00 UTC, plus a one-time bootstrap if the catalog is empty (first deploy) so it
  // populates within the hour instead of waiting for the window.
  if (minute === 0) {
    if (hour === 6 || !(await officialSkillsSynced(env).catch(() => true))) {
      await syncOfficialSkills(env).catch(() => {});
    }
  }

  // Auto-rollback (every run): trip the public-rollout kill switch if abuse spikes.
  await checkPublicAutoRollback(env).catch(() => {});

  // Workspace Knowledge (work/041): drain the distill queue into artifact digests.
  // Self-limits per run (caps in distill.ts); cheap no-op when the queue is empty.
  const knowledge = await runKnowledgeDistill(env).catch(() => ({ processed: 0, skipped: 0 }));
  if (knowledge.processed > 0) {
    logger.info('knowledge distill finished', {
      knowledge_processed: knowledge.processed,
      knowledge_skipped: knowledge.skipped,
    });
  }

  // Workspace Knowledge (work/041 P1): nightly consolidation — evolve topic/entity
  // pages, prune dead digests, refresh trunk + timeline. Daily 03:00 UTC (quiet slot;
  // cleanup owns 01:00, backups 04:00/05:00). Self-limits (caps in consolidate.ts).
  if (hour === 3 && minute === 0) {
    const cons = await runKnowledgeConsolidate(env).catch((err) => {
      // Silent failure here means the KB silently stops evolving — log it, but keep
      // the cron running by returning null.
      logger.error('knowledge consolidate failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    });
    if (cons && (cons.workspaces > 0 || cons.pruned > 0)) {
      logger.info('knowledge consolidate finished', {
        kn_ws: cons.workspaces,
        kn_topics: cons.topicPages,
        kn_entities: cons.entityPages,
        kn_pruned: cons.pruned,
        kn_llm: cons.llmCalls,
        kn_skipped: cons.skipped,
      });
    }
    // Corpus refresh: re-learn sources chunked by an older chunker, and failed ones past
    // their backoff. Self-limits (caps in knowledge/corpus/reindex.ts).
    const refresh = await runCorpusRefresh(env).catch((err) => {
      logger.error('knowledge corpus refresh failed', { error: err instanceof Error ? err.message : String(err) });
      return null;
    });
    if (refresh && refresh.queued > 0) {
      logger.info('knowledge corpus refresh finished', {
        kn_refresh_ws: refresh.workspaces,
        kn_refresh_outdated: refresh.outdated,
        kn_refresh_failed: refresh.failed,
      });
    }
  }

  // Scheduled lifecycle emails (activation nudge hourly; win-back + first-view daily;
  // weekly digest Monday). Self-gates by hour/day; idempotent via the email log.
  await runLifecycleEmails(env).catch(() => {});

  // Weekly workspace digest — the retention email. Monday 13:00 UTC, one per active
  // workspace to its members. Idempotent via email_log (workspace+ISO-week).
  if (now.getUTCDay() === 1 && hour === 13 && minute === 0) {
    await runWeeklyWorkspaceDigest(env, now.toISOString().slice(0, 10)).catch(() => {});
  }

  // Advance the analytics rollup cursor every tick (opt-006): it aggregates a bounded
  // slice of artifacts per run instead of a whole day at once, so it can't blow the
  // subrequest cap. Idle ticks are one cheap lookup. cleanupOldEvents stays daily and
  // only deletes days the cursor has fully aggregated (watermark-gated).
  const aggregated = await aggregateDailyStats(env).catch(() => 0);
  if (aggregated > 0) {
    logger.info('analytics rollup advanced', { analytics_agg: aggregated });
  }

  if (hour === 1 && minute === 0) {
    const [cleanedEvents, cleanedSessions] = await Promise.all([
      cleanupOldEvents(env),
      cleanupExpiredAdminSessions(env),
    ]);
    await cleanupExpiredDeviceCodes(env).catch(() => 0);
    await cleanupMcpOAuth(env).catch(() => undefined);
    const obs = await cleanupObservability(env).catch(() => ({ errors: 0, hours: 0 }));
    const buildTraces = await cleanupBuildTraces(env).catch(() => 0);
    const audit = await cleanupAuditLog(env).catch(() => ({ rows: 0 }));
    const approvalsExpired = await reapStaleApprovals(env).catch(() => 0);
    const artifactsPurged = await purgeSoftDeleted(env).catch(() => 0);
    const rateLimitsPruned = await cleanupOldRateLimits(env).catch(() => 0);
    logger.info('daily cleanup completed', {
      events_cleaned: cleanedEvents,
      sessions_cleaned: cleanedSessions,
      rate_limits_pruned: rateLimitsPruned,
      obs_errors_pruned: obs.errors,
      obs_hours_pruned: obs.hours,
      build_traces_pruned: buildTraces,
      audit_rows_pruned: audit.rows,
      crew_approvals_expired: approvalsExpired,
      artifacts_purged: artifactsPurged,
    });
  }

  if (jobResult.executed > 0 || jobResult.failed > 0) {
    logger.info('scheduled jobs batch finished', {
      executed: jobResult.executed,
      failed: jobResult.failed,
    });
  }

  if (crewResult.executed > 0 || crewResult.failed > 0) {
    logger.info('crew cron triggers finished', {
      executed: crewResult.executed,
      failed: crewResult.failed,
    });
  }

  if (alertResult.evaluated > 0) {
    logger.info('metric alerts batch finished', {
      evaluated: alertResult.evaluated,
      triggered: alertResult.triggered,
    });
  }
}
