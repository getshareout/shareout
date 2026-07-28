/**
 * Scheduled jobs — public API barrel.
 *
 * Module layout (`src/scheduling/jobs/`):
 * - `types.ts` — action configs, triggers, persistence shapes
 * - `constants.ts` — rate limits and feature-gate keys
 * - `cron.ts` — schedule parsing and next-run computation (UTC)
 * - `retry.ts` — failure backoff delays
 * - `permissions.ts` — viewer self-delivery and manage checks
 * - `crud.ts` — create, list, update, delete, logs
 * - `runner.ts` — delivery-registry execution and step logging
 * - `execute.ts` — cron tick and manual runs
 * - `event-triggers.ts` — event-driven dispatch
 * - `event-cache.ts` — artifact.viewed job KV cache
 * - `artifact-email.ts` — per-artifact inbound email addresses
 */
export type { EmailConfig } from './email';

export type {
  WebhookConfig,
  SlackConfig,
  DiscordConfig,
  HttpGetConfig,
  TelegramConfig,
  MaterializeConfig,
  RetryConfig,
  JobAction,
  JobTriggerType,
  JobEventType,
  JobConfig,
  ArtifactTestJobConfig,
  QuerySnapshotConfig,
  SheetsAppendConfig,
  ScheduledJob,
  CreateJobRequest,
  RunJobResult,
  JobLog,
} from './jobs/types';

export { parseCronSchedule, getNextRunTime } from './jobs/cron';
export { calculateBackoffDelay } from './jobs/retry';
export { checkViewerSelfDelivery } from './jobs/permissions';
export {
  createJob,
  listJobs,
  listJobsForArtifact,
  getJobLogs,
  deleteJob,
  updateJob,
} from './jobs/crud';
export { runScheduledJobs, runJobManually, executeJobNow } from './jobs/execute';
export { runEventTriggeredJobs } from './jobs/event-triggers';
export { hasEnabledViewEventJob, invalidateViewEventJobCache } from './jobs/event-cache';
export { createArtifactEmail, getArtifactEmail } from './jobs/artifact-email';
