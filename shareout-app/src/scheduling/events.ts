import type { Env, EmailReceivedPayload } from '../types';
import { runEventTriggeredJobs, hasEnabledViewEventJob, type JobEventType } from './jobs';

export type { JobEventType } from './jobs';

export async function emitJobEvent(
  env: Env,
  artifactId: string,
  eventType: JobEventType,
  payload?: EmailReceivedPayload
): Promise<void> {
  try {
    await runEventTriggeredJobs(env, artifactId, eventType, payload);
  } catch {
    // Silent fail - event processing should never break main functionality
  }
}

const viewThrottleCache = new Map<string, number>();
const VIEW_THROTTLE_MS = 3600000; // 1 hour

export async function maybeEmitViewEvent(
  env: Env,
  artifactId: string,
  request: Request
): Promise<void> {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const key = `${artifactId}:${ip}`;
  const now = Date.now();
  const lastEmit = viewThrottleCache.get(key) || 0;

  if (now - lastEmit < VIEW_THROTTLE_MS) return;

  viewThrottleCache.set(key, now);

  // Clean up old entries periodically
  if (viewThrottleCache.size > 10000) {
    const cutoff = now - VIEW_THROTTLE_MS;
    for (const [k, v] of viewThrottleCache) {
      if (v < cutoff) viewThrottleCache.delete(k);
    }
  }

  // Most artifacts have no view-triggered job — the KV negative cache lets us skip
  // the scheduled_jobs D1 read (and the emit) on the hot path for those.
  if (!(await hasEnabledViewEventJob(env, artifactId))) return;

  await emitJobEvent(env, artifactId, 'artifact.viewed');
}
