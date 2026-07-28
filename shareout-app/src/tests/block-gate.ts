// Artifact Tests — BLOCK-mode promotion gating. A failing new version is held back
// on a 'candidate' deployment channel while the last-good version keeps serving on
// 'production'; the candidate is promoted only if its tests pass. See specs §3.
//
// BLOCK engages only when a passing baseline already exists (config.baseline_version_id)
// — so first/never-passed publishes go live immediately and never go dark.

import type { Env } from '../types';
import { generateId } from '../crypto-utils';
import { getTestConfig } from './config';
import { runTests } from './runner';
import { invalidateDeploymentCache } from '../serve/deployment-cache';

/** True when this publish should be held as a candidate rather than going live. */
export async function shouldBlockPublish(env: Env, artifactId: string): Promise<boolean> {
  const c = await getTestConfig(env, artifactId);
  return !!(c?.enabled && c.mode === 'block' && c.baseline_version_id);
}

/** Stage the new version on the 'candidate' channel without advancing production. */
export async function stageCandidate(env: Env, artifactId: string, versionId: string, slug: string): Promise<void> {
  await env.DB.prepare(`
    INSERT INTO deployments (id, artifact_id, version_id, channel, slug, updated_at)
    VALUES (?, ?, ?, 'candidate', ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ON CONFLICT(artifact_id, channel) DO UPDATE SET
      version_id = excluded.version_id, slug = excluded.slug, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  `).bind(generateId('dep'), artifactId, versionId, slug).run();
}

/** Shared post-publish test trigger for every publish path (API + both editors).
 *  When blocking, run the candidate gate (promote only on pass). Otherwise MONITOR:
 *  run tests if enabled and alert on failure — the version is already live. No-op
 *  when tests are disabled. Callers stage the candidate row before invoking this. */
export async function runPostPublishTests(
  env: Env,
  artifactId: string,
  workspaceId: string,
  versionId: string,
  slug: string,
  blocking: boolean,
): Promise<void> {
  if (blocking) return runBlockGate(env, artifactId, workspaceId, versionId, slug);
  const c = await getTestConfig(env, artifactId);
  if (!c?.enabled) return;
  await runTests(env, { artifactId, workspaceId, versionId, trigger: 'publish', triggeredBy: null });
}

/** Run the candidate's tests; promote to production only if it passes AND is still
 *  the newest candidate (a later republish supersedes it — monotonic, no lost-update
 *  regression to an older version). Run off the response via waitUntil. */
export async function runBlockGate(
  env: Env,
  artifactId: string,
  workspaceId: string,
  versionId: string,
  slug: string,
): Promise<void> {
  const outcome = await runTests(env, { artifactId, workspaceId, versionId, trigger: 'publish', triggeredBy: null });
  // Hold: production stays at the baseline, candidate is kept for inspection.
  // (runTests already alerted the owner on failure/error.)
  if (!outcome || !outcome.promotable) return;

  // Monotonic guard: only promote if the candidate still points at this version.
  const cand = await env.DB.prepare(
    "SELECT version_id FROM deployments WHERE artifact_id = ? AND channel = 'candidate'",
  ).bind(artifactId).first<{ version_id: string }>();
  if (!cand || cand.version_id !== versionId) return; // superseded by a newer republish

  await env.DB.prepare(`
    INSERT INTO deployments (id, artifact_id, version_id, channel, slug, updated_at)
    VALUES (?, ?, ?, 'production', ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ON CONFLICT(artifact_id, channel) DO UPDATE SET
      version_id = excluded.version_id, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  `).bind(generateId('dep'), artifactId, versionId, slug).run();
  await invalidateDeploymentCache(env, slug, artifactId);

  // Candidate is now live — clear it so the next publish starts clean.
  await env.DB.prepare(
    "DELETE FROM deployments WHERE artifact_id = ? AND channel = 'candidate'",
  ).bind(artifactId).run();
}
