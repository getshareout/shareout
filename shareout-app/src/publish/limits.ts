/**
 * Publish limit copy + envelopes shared by every publish path (token API and the
 * session /create builder), so both enforce the same caps and say the same thing.
 * These are instance settings — there are no plans to upgrade to in this build.
 */
import { RATE_LIMIT_MAX } from '../api-auth';
import type { QuotaCheck } from '../quota';
import { json } from './http';

const MB = 1_000_000;

function roughly(seconds: number): string {
  const mins = Math.max(1, Math.ceil(seconds / 60));
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'}`;
  const hours = Math.round(mins / 60);
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}

export function rateLimitMessage(reset: number, nowMs = Date.now()): string {
  const retryAfter = Math.max(1, reset - Math.floor(nowMs / 1000));
  const at = new Date(reset * 1000).toISOString().slice(11, 16);
  return `Daily publish limit reached (${RATE_LIMIT_MAX} per day). It resets at ${at} UTC, in about ${roughly(retryAfter)}.`;
}

export function rateLimitExceededResponse(reset: number, nowMs = Date.now()): Response {
  const retryAfter = Math.max(1, reset - Math.floor(nowMs / 1000));
  const res = json({
    success: false,
    error: rateLimitMessage(reset, nowMs),
    code: 'RATE_LIMIT_EXCEEDED',
    limit: RATE_LIMIT_MAX,
    remaining: 0,
    reset,
    retryAfter,
  }, 429);
  res.headers.set('X-RateLimit-Remaining', '0');
  res.headers.set('X-RateLimit-Reset', String(reset));
  res.headers.set('Retry-After', String(retryAfter));
  return res;
}

export function storageLimitMessage(quota: QuotaCheck): string {
  const used = Math.round(quota.used / MB);
  const max = Math.round(quota.max / MB);
  return `Storage limit reached: ${used} MB of ${max} MB used on this account. Delete artifacts you no longer need, or ask your ShareOut admin to raise STORAGE_QUOTA_BYTES.`;
}

export function storageLimitExceededResponse(quota: QuotaCheck): Response {
  return json({
    success: false,
    error: storageLimitMessage(quota),
    code: 'STORAGE_LIMIT_EXCEEDED',
    used: quota.used,
    max: quota.max,
  }, 413);
}

export function publicLimitNotice(max: number): string {
  return `Public artifact limit reached (${max} per account). Published privately. Make another artifact private, or ask your ShareOut admin to raise PUBLIC_ARTIFACT_LIMIT.`;
}
