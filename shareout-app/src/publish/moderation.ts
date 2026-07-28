/**
 * Publish-time content moderation — safety check on open visibility transitions.
 * Non-approved verdicts force the artifact private until reviewed.
 */
import type { Env } from '../types';
import { runPublishSafetyCheck, contentHash, classifyAndPersist, clearModerationHold, type ModerationStatus } from '../moderation/check';
import { extractSignals, outboundHosts } from '../moderation/extract';
import { submitHostScan } from '../moderation/url-scanner';
import { fireAlert } from '../observability/alerts';
import { getPlatformOrigin } from '../config/origins';
import { setModeration } from '../artifacts/satellites';

const HELD_RETRY_MS = 30_000;

async function alertModerationHold(
  env: Env,
  artifactId: string,
  reason: string,
  executionCtx?: ExecutionContext,
): Promise<void> {
  const send = (async () => {
    const meta = await env.DB.prepare(
      `SELECT COALESCE(dep.slug, a.slug) AS slug, a.workspace_id AS ws
         FROM artifacts a
         LEFT JOIN deployments dep ON dep.artifact_id = a.id AND dep.channel = 'production'
        WHERE a.id = ?`
    ).bind(artifactId).first<{ slug: string; ws: string | null }>();
    const base = getPlatformOrigin(env);
    const text = [
      '🛑 Artifact held for review',
      `${meta?.slug || artifactId}${meta?.ws ? ` · ws ${meta.ws}` : ''}`,
      reason ? `reason: ${reason}` : '',
      `${base}/admin?view=moderation`,
    ].filter(Boolean).join('\n');
    await fireAlert(env, `moderation:held:${artifactId}`, text, 6 * 3600);
  })().catch(() => {});
  if (executionCtx) executionCtx.waitUntil(send);
  else await send;
}

export interface PublishModerationResult {
  status: ModerationStatus;
  /** Classifier / heuristic reason — shown to the publisher when forced private. */
  reason?: string;
  forcedPrivate: boolean;
}

export async function runPublishModeration(
  env: Env,
  artifactId: string,
  htmlContent: string,
  effectiveVisibility: string,
  executionCtx?: ExecutionContext,
): Promise<PublishModerationResult> {
  if (effectiveVisibility !== 'public') {
    // The owner republished as non-public: drop any stale held-from-public marker so
    // a later re-classify can't flip the page public against their explicit choice.
    await clearModerationHold(env, artifactId);
    return { status: 'approved', forcedPrivate: false };
  }

  const prior = await env.DB.prepare(
    `SELECT status AS moderation_status, reason AS moderation_reason,
            content_hash AS moderation_content_hash
       FROM artifact_moderation WHERE artifact_id = ?`
  ).bind(artifactId).first<{
    moderation_status: string;
    moderation_reason: string | null;
    moderation_content_hash: string | null;
  }>();
  const hash = await contentHash(htmlContent);

  let moderationStatus: ModerationStatus;
  let reason: string | undefined;
  if (prior?.moderation_content_hash === hash && prior.moderation_status) {
    moderationStatus = prior.moderation_status as ModerationStatus;
    reason = prior.moderation_reason ?? undefined;
  } else {
    const check = await runPublishSafetyCheck(env, htmlContent);
    moderationStatus = check.status;
    reason = check.reason || undefined;
    await setModeration(env, artifactId, {
      status: check.status,
      reason: check.reason,
      checked_at: new Date().toISOString(),
      content_hash: check.contentHash,
    });

    if (executionCtx) {
      const hosts = outboundHosts(extractSignals(htmlContent)).slice(0, 5);
      executionCtx.waitUntil(Promise.all(hosts.map((h) => submitHostScan(env, `https://${h}`))));
    }

    if (check.status !== 'approved') {
      await alertModerationHold(env, artifactId, check.reason, executionCtx);
    }

    // Classifier unavailable/timeout/unparseable held the artifact, not a real
    // verdict — retry once in the background so a transient failure self-heals.
    if (check.verdict === 'error' && executionCtx) {
      executionCtx.waitUntil((async () => {
        await new Promise((r) => setTimeout(r, HELD_RETRY_MS));
        await classifyAndPersist(env, artifactId).catch(() => {});
      })());
    }
  }

  const forcedPrivate = moderationStatus !== 'approved';
  if (forcedPrivate) {
    await env.DB.prepare('UPDATE artifacts SET visibility = ? WHERE id = ?')
      .bind('private', artifactId).run();
    await setModeration(env, artifactId, { held_visibility: effectiveVisibility });
  }

  return { status: moderationStatus, reason, forcedPrivate };
}
