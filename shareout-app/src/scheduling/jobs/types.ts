/**
 * Scheduled job domain types — action configs, triggers, and persistence shapes.
 *
 * Each `JobAction` maps to a destination in `src/delivery/`; config interfaces
 * mirror what those destinations validate and deliver.
 */
import type { EmailConfig } from '../email';

export type { EmailConfig };

export interface WebhookConfig {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  includeArtifactData?: boolean;
}

export interface SlackConfig {
  /** Incoming-webhook URL (legacy delivery). Optional when `connection` is set. */
  webhookUrl?: string;
  channel?: string;
  username?: string;
  iconEmoji?: string;
  includeArtifactLink?: boolean;
  customMessage?: string;
  /** connections.name (workspace scope) holding a Slack bot token (OAuth app delivery). */
  connection?: string;
  /** Bot-token target: a channel (default) or a direct message to a user. */
  targetType?: 'channel' | 'dm';
  /** Slack channel id to post to when using a bot-token connection (targetType 'channel'). */
  channelId?: string;
  /** Slack member id (U…) to DM when targetType is 'dm'. */
  slackUserId?: string;
  /** Bot-token delivery payload: message, snapshot image, PDF, or message+snapshot. */
  mode?: 'message' | 'snapshot' | 'pdf' | 'both';
  /** Max ms to wait for artifact data to load before capturing image/PDF. */
  waitMs?: number;
}

export interface DiscordConfig {
  webhookUrl: string;
  username?: string;
  avatarUrl?: string;
  embedTitle?: string;
  embedColor?: number;
  includeArtifactLink?: boolean;
  customMessage?: string;
}

export interface HttpGetConfig {
  url: string;
  headers?: Record<string, string>;
}

export interface TelegramConfig {
  /** Chat to deliver to. Omit to use the creator's own linked Telegram chat. */
  chatId?: string;
  /** message (default), an image snapshot, a PDF, or message + snapshot. */
  mode?: 'message' | 'snapshot' | 'pdf' | 'both';
  customMessage?: string;
  includeArtifactLink?: boolean;
  /** Max ms to wait for artifact data to load before capturing image/PDF. */
  waitMs?: number;
}

export interface MaterializeConfig {
  connection: string;
  query: string | Record<string, unknown>;
  target: { type: 'dataset' | 'table'; name: string };
  mode?: 'replace' | 'append';
  format?: 'json' | 'csv';
  options?: { params?: Record<string, unknown> };
}

/**
 * The four `scheduled_jobs` enums. These lists are the only definition — the type
 * is derived from the array, so a value cannot exist in one and not the other.
 *
 * D1 used to enforce these with BEFORE INSERT/UPDATE triggers, which meant every
 * new action shipped as a migration (0038, 0065, 0070, 0071, 0087, 0126 exist for
 * exactly that) and still drifted: the trigger allowed `report_daily` long after
 * the union stopped listing it. 0135 dropped the triggers; the guards below are
 * the replacement, applied at the write path in crud.ts.
 */
export const JOB_ACTIONS = [
  'email',
  'webhook',
  'slack',
  'discord',
  'http_get',
  'materialize',
  'telegram',
  'query_snapshot',
  'sheets_append',
  'artifact_test',
  'asset_delivery',
] as const;

export const JOB_TRIGGER_TYPES = ['cron', 'event'] as const;

export const JOB_EVENT_TYPES = [
  'artifact.updated',
  'artifact.viewed',
  'comment.added',
  'email.received',
] as const;

export const JOB_BACKOFF_TYPES = ['fixed', 'linear', 'exponential'] as const;

export type JobAction = (typeof JOB_ACTIONS)[number];
export type JobTriggerType = (typeof JOB_TRIGGER_TYPES)[number];
export type JobEventType = (typeof JOB_EVENT_TYPES)[number];
export type JobBackoffType = (typeof JOB_BACKOFF_TYPES)[number];

const oneOf = <T extends readonly string[]>(allowed: T) =>
  (value: unknown): value is T[number] =>
    typeof value === 'string' && (allowed as readonly string[]).includes(value);

export const isJobAction = oneOf(JOB_ACTIONS);
export const isJobTriggerType = oneOf(JOB_TRIGGER_TYPES);
export const isJobEventType = oneOf(JOB_EVENT_TYPES);
export const isJobBackoffType = oneOf(JOB_BACKOFF_TYPES);

export interface RetryConfig {
  maxAttempts: number;
  backoffType: JobBackoffType;
  initialDelay: number;
}

/** Config for the `artifact_test` action: run the artifact's own enabled tests
 *  against its live version on schedule. No fields — the artifact_tests config is
 *  the source of truth, so there is nothing for the user or agent to author. */
export interface ArtifactTestJobConfig {
  /** Reserved for future per-schedule overrides; empty today. */
  note?: string;
}

/** Config for the `query_snapshot` action: a generic, deterministic data refresh. */
export interface QuerySnapshotConfig {
  connection: string;
  params?: Record<string, unknown>;
  queries: Array<{
    query: string;
    target: { type: 'dataset' | 'table' | 'json'; name: string; path?: string };
    mode?: 'replace' | 'append';
  }>;
}

/** Config for the `sheets_append` action: append query rows to a Google Sheet. */
export interface SheetsAppendConfig {
  spreadsheetId?: string;
  spreadsheetUrl?: string;
  range?: string;
  connection: string;
  params?: Record<string, unknown>;
  query: string | Record<string, unknown>;
  columns?: string[];
  skipIfEmpty?: boolean;
}

export type JobConfig =
  | EmailConfig
  | WebhookConfig
  | SlackConfig
  | DiscordConfig
  | HttpGetConfig
  | MaterializeConfig
  | TelegramConfig
  | QuerySnapshotConfig
  | SheetsAppendConfig
  | ArtifactTestJobConfig
  | AssetDeliveryConfig;

/** Config for the `asset_delivery` action: email a file collection's download link on a
 *  schedule. The job is anchored to the workspace's asset-bucket artifact. (work/042 P4) */
export interface AssetDeliveryConfig {
  collectionId: string;
  recipients: string[];
  expiresDays?: number;
}

export interface ScheduledJob {
  id: string;
  artifact_id: string;
  owner_id: string;
  title: string | null;
  description: string | null;
  action: JobAction;
  schedule: string;
  config: JobConfig;
  trigger_type: JobTriggerType;
  event_type: JobEventType | null;
  max_attempts: number;
  backoff_type: 'fixed' | 'linear' | 'exponential';
  initial_delay: number;
  next_run_at: string;
  last_run_at: string | null;
  last_status: 'success' | 'failed' | 'pending' | null;
  last_error: string | null;
  retry_count: number;
  enabled: boolean;
  created_at: string;
  artifact_name?: string | null;
  artifact_slug?: string | null;
}

export interface CreateJobRequest {
  artifact_id: string;
  action: JobAction;
  schedule?: string;
  config: JobConfig;
  trigger_type?: JobTriggerType;
  event_type?: JobEventType;
  retry_config?: Partial<RetryConfig>;
  title?: string;
  description?: string;
}

export interface RunJobResult {
  success: boolean;
  job_id: string;
  execution_id: string;
  status: 'success' | 'failed';
  error?: string;
  duration_ms: number;
}

export interface JobLog {
  id: string;
  created_at: string;
  status: string;
  duration_ms: number;
  error: string | null;
}
