/**
 * KV cache for artifact.viewed event jobs — avoids a D1 read on every page view.
 */
import type { Env } from '../../types';
import { VIEW_EVENT_JOB_CACHE_TTL } from './constants';

function viewEventJobCacheKey(artifactId: string): string {
  return `evtjobs:view:${artifactId}`;
}

/** Whether the artifact has at least one enabled artifact.viewed event job. */
export async function hasEnabledViewEventJob(env: Env, artifactId: string): Promise<boolean> {
  const kv = env.PROXY_CACHE;
  if (kv) {
    const cached = await kv.get(viewEventJobCacheKey(artifactId));
    if (cached === '1') return true;
    if (cached === '0') return false;
  }

  const row = await env.DB.prepare(`
    SELECT 1 FROM scheduled_jobs
    WHERE artifact_id = ? AND trigger_type = 'event' AND event_type = 'artifact.viewed' AND enabled = 1
    LIMIT 1
  `).bind(artifactId).first<{ 1: number }>();

  const has = !!row;
  if (kv) {
    await kv.put(viewEventJobCacheKey(artifactId), has ? '1' : '0', {
      expirationTtl: VIEW_EVENT_JOB_CACHE_TTL,
    });
  }
  return has;
}

/** Drop the view-event cache entry after any job create/update/delete on the artifact. */
export async function invalidateViewEventJobCache(env: Env, artifactId: string): Promise<void> {
  if (!env.PROXY_CACHE) return;
  try {
    await env.PROXY_CACHE.delete(viewEventJobCacheKey(artifactId));
  } catch {
    // Best-effort: a stale flag self-heals at TTL.
  }
}
