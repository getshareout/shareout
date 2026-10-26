// Verify results live in R2 next to the artifact's own files (`<artifactId>/…`, so the
// usage ledger bills them to its workspace): the latest run as JSON plus its
// screenshots. Only the latest run is kept; a new run deletes the previous shots.
import type { Env } from '../types';
import type { VerifyResult, Viewport } from './types';
import { VIEWPORT_NAMES } from './types';

const latestKey = (artifactId: string) => `${artifactId}/verify/latest.json`;

export function shotKey(artifactId: string, runId: string, viewport: Viewport): string {
  return `${artifactId}/verify/${runId}/${viewport}.webp`;
}

/** API path that serves a run's screenshot to editors. */
export function shotPath(artifactId: string, runId: string, viewport: Viewport): string {
  return `/v1/artifacts/${artifactId}/verify/${runId}/${viewport}.webp`;
}

export async function readLatestRun(env: Env, artifactId: string): Promise<VerifyResult | null> {
  const obj = await env.ARTIFACTS.get(latestKey(artifactId));
  if (!obj) return null;
  try {
    return JSON.parse(await obj.text()) as VerifyResult;
  } catch {
    return null;
  }
}

export async function saveRun(
  env: Env,
  result: VerifyResult,
  shots: Partial<Record<Viewport, Uint8Array>>,
): Promise<void> {
  const previous = await readLatestRun(env, result.artifact_id).catch(() => null);
  await Promise.all(Object.entries(shots).map(([viewport, bytes]) =>
    env.ARTIFACTS.put(shotKey(result.artifact_id, result.id, viewport as Viewport), bytes, {
      httpMetadata: { contentType: 'image/webp' },
    })));
  await env.ARTIFACTS.put(latestKey(result.artifact_id), JSON.stringify(result), {
    httpMetadata: { contentType: 'application/json' },
  });
  if (previous && previous.id !== result.id) {
    await Promise.all(VIEWPORT_NAMES.map((vp) =>
      env.ARTIFACTS.delete(shotKey(result.artifact_id, previous.id, vp)).catch(() => {})));
  }
}

export function readShot(env: Env, artifactId: string, runId: string, viewport: Viewport): Promise<R2ObjectBody | null> {
  return env.ARTIFACTS.get(shotKey(artifactId, runId, viewport));
}

/** Everything verify stored for an artifact (purge). Lists the prefix, so stray runs go too. */
export async function deleteVerifyRuns(env: Env, artifactId: string): Promise<void> {
  const prefix = `${artifactId}/verify/`;
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const listed = await env.ARTIFACTS.list({ prefix, cursor });
    const keys = listed.objects.map((o) => o.key);
    if (keys.length) await env.ARTIFACTS.delete(keys);
    if (!listed.truncated) return;
    cursor = listed.cursor;
  }
}
