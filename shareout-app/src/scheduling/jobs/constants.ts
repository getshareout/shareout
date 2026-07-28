/**
 * Scheduling limits and feature-gate keys shared across job modules.
 */

/** Delivery action → workspace feature key (1:1). Actions without an entry are not gated. */
export const DEST_FEATURE: Record<string, string> = {
  slack: 'dest.slack',
  discord: 'dest.discord',
  webhook: 'dest.webhook',
  email: 'dest.email',
  http_get: 'dest.http_get',
  materialize: 'dest.materialize',
  asset_delivery: 'dest.email',
};

/** Max scheduled jobs a user may create per UTC day. */
export const JOB_LIMIT_PER_USER = 5;

/** Browser-heavy `artifact_test` jobs throttled per cron tick. */
export const MAX_TEST_JOBS_PER_TICK = 5;
export const TEST_JOBS_BUDGET_MS = 60_000;

/** KV TTL for the artifact.viewed event-job negative cache. */
export const VIEW_EVENT_JOB_CACHE_TTL = 3600;
