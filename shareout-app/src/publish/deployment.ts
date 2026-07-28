/**
 * Deployment promotion, URL building, and publish response assembly.
 */
import type { Env, PublishResponse, PWAConfig, ArtifactType } from '../types';
import type { AuthUser } from '../api-auth';
import { generateId } from '../crypto-utils';
import { dispatchLifecycleEmail } from '../email/gateway';
import { buildSubdomainUrl } from '../subdomain';
import { invalidateDeploymentCache } from '../serve/deployment-cache';
import { indexArtifactVector } from '../search/semantic';
import { scanFileUsage } from '../assets/usage';
import { emitJobEvent } from '../scheduling/events';
import { generateArtifactThumbnail } from '../screenshots';
import { generateArtifactSummary } from './auto-summary';
import { shouldBlockPublish, stageCandidate, runBlockGate } from '../tests/block-gate';
import type { ModerationStatus } from '../moderation/check';
import type { ReadinessProfile } from '../../shared/editor-readiness/model';
import { maybeRunMonitorTests } from './monitor-tests';
import { isKnowledgeEnabled, enqueueIngest } from '../knowledge';

export interface WorkspaceUrls {
  namespacedUrl?: string;
  subdomainUrl?: string;
}

// Shared moderation-hold copy — one source of truth so the story never drifts across
// the publish response, GET /v1/artifacts/:id, and the PATCH 202 body. Workstream A
// makes held pages self-heal (hourly re-check + auto-restore), so the copy says so.
export const MODERATION_PENDING_MESSAGE =
  'Public pages get an automated safety check at publish. This one is held private for now — it is re-checked automatically within the hour (our team is alerted too) and goes public by itself once it clears.';
export const MODERATION_BLOCKED_MESSAGE =
  'Your artifact was blocked by automated safety checks and stays private. Contact support if you believe this is a mistake.';

export async function buildWorkspaceUrls(
  env: Env,
  baseUrl: string,
  workspaceId: string | null,
  folderId: string | null,
  humanSlug: string,
): Promise<WorkspaceUrls> {
  if (!workspaceId) return {};

  const workspace = await env.DB.prepare('SELECT slug FROM workspaces WHERE id = ?')
    .bind(workspaceId).first<{ slug: string }>();
  if (!workspace) return {};

  let folderPath = '';
  if (folderId) {
    const segments: string[] = [];
    let currentFolderId: string | null = folderId;
    while (currentFolderId) {
      const folderResult: { slug: string; parent_id: string | null } | null = await env.DB.prepare(
        'SELECT slug, parent_id FROM folders WHERE id = ?'
      ).bind(currentFolderId).first();
      if (!folderResult) break;
      segments.unshift(folderResult.slug);
      currentFolderId = folderResult.parent_id;
    }
    folderPath = segments.join('/');
  }

  const humanPath = folderPath ? `${folderPath}/${humanSlug}` : humanSlug;
  return {
    namespacedUrl: `${baseUrl}/@${workspace.slug}/${humanPath}/`,
    subdomainUrl: buildSubdomainUrl(baseUrl, workspace.slug, humanPath),
  };
}

export async function promoteVersion(
  env: Env,
  artifactId: string,
  versionId: string,
  routingSlug: string,
): Promise<boolean> {
  const blocking = await shouldBlockPublish(env, artifactId);
  if (blocking) {
    await stageCandidate(env, artifactId, versionId, routingSlug);
    return true;
  }

  const deploymentId = generateId('dep');
  await env.DB.prepare(`
    INSERT INTO deployments (id, artifact_id, version_id, channel, slug, updated_at)
    VALUES (?, ?, ?, 'production', ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ON CONFLICT(artifact_id, channel) DO UPDATE SET
      version_id = excluded.version_id,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  `).bind(deploymentId, artifactId, versionId, routingSlug).run();

  await invalidateDeploymentCache(env, routingSlug, artifactId);
  return false;
}

export async function isFirstPublishForUser(env: Env, userId: string): Promise<boolean> {
  return !(await env.DB.prepare(
    `SELECT 1 FROM deployments d JOIN artifacts a ON a.id = d.artifact_id
       WHERE a.owner_id = ? AND d.channel = 'production' LIMIT 1`
  ).bind(userId).first());
}

export interface AssembleResponseInput {
  artifactId: string;
  artifactType: ArtifactType;
  versionId: string;
  versionNo: number;
  routingSlug: string;
  humanSlug: string;
  name: string;
  hasMobile: boolean;
  pwa?: PWAConfig;
  workspaceUrls: WorkspaceUrls;
  editorReadiness?: ReadinessProfile;
  moderationStatus: ModerationStatus;
  /** Classifier reason when held private — surfaces in the API response. */
  moderationReason?: string | null;
  policyNotice?: string;
  approvalRequired?: number;
  blocking: boolean;
}

export function assemblePublishResponse(env: Env, input: AssembleResponseInput): PublishResponse {
  const baseUrl = env.SHAREOUT_BASE_URL.replace(/\/$/, '');
  const { subdomainUrl, namespacedUrl } = input.workspaceUrls;

  const response: PublishResponse = {
    artifact: { id: input.artifactId, type: input.artifactType },
    version: { id: input.versionId, version_no: input.versionNo },
    deployment: {
      slug: input.routingSlug,
      url: `${baseUrl}/a/${input.routingSlug}/`,
      ...(subdomainUrl ? { subdomain_url: subdomainUrl } : {}),
      namespaced_url: namespacedUrl,
      embed_url: `${baseUrl}/embed/${input.routingSlug}/`,
      ...(input.hasMobile ? { mobile_url: `${baseUrl}/a/${input.routingSlug}/?v=mobile` } : {}),
    },
  };

  if (input.editorReadiness) response.editor_readiness = input.editorReadiness;

  if (input.moderationStatus !== 'approved') {
    const reason = input.moderationReason?.trim();
    response.moderation = input.moderationStatus === 'pending'
      ? {
          status: 'pending',
          ...(reason ? { reason } : {}),
          message: MODERATION_PENDING_MESSAGE,
          requested_visibility: 'public',
          forced_private: true,
        }
      : { status: 'blocked', message: MODERATION_BLOCKED_MESSAGE, forced_private: true };
  }

  if (input.policyNotice) response.notice = input.policyNotice;
  if (input.approvalRequired !== undefined) {
    response.approval_required = { required: input.approvalRequired, artifact_id: input.artifactId };
  }

  if (input.pwa?.enabled) {
    response.pwa = {
      manifest_url: `${baseUrl}/a/${input.routingSlug}/manifest.json`,
      service_worker_url: `${baseUrl}/a/${input.routingSlug}/sw.js`,
      installable: true,
    };
  }

  if (input.blocking) {
    response.tests = { mode: 'block', pending: true };
  }

  return response;
}

/** Background tasks after a successful publish (off the hot path). */
export function schedulePostPublishTasks(
  env: Env,
  user: AuthUser,
  executionCtx: ExecutionContext | undefined,
  opts: {
    artifactId: string;
    artifactType: ArtifactType;
    versionId: string;
    workspaceId: string | null;
    routingSlug: string;
    blocking: boolean;
    firstPublish: boolean;
    name: string;
    publicUrl: string;
  },
): void {
  if (!executionCtx) return;

  executionCtx.waitUntil(indexArtifactVector(env, opts.artifactId).catch(() => {}));

  if (opts.firstPublish && !opts.blocking) {
    executionCtx.waitUntil(
      dispatchLifecycleEmail(env, {
        type: 'first_publish',
        toUserId: user.id,
        toEmail: user.email ?? undefined,
        data: { pageName: opts.name || 'your page', url: opts.publicUrl },
      }).catch(() => {}),
    );
  }

  executionCtx.waitUntil(emitJobEvent(env, opts.artifactId, 'artifact.updated').catch(() => {}));

  // File usage graph (work/042 P4): record which Files this artifact references.
  executionCtx.waitUntil(scanFileUsage(env, opts.artifactId, opts.versionId).catch(() => {}));

  if (opts.workspaceId) {
    const wsId = opts.workspaceId;
    executionCtx.waitUntil(
      isKnowledgeEnabled(env, wsId)
        .then(on =>
          on
            ? enqueueIngest(
                env,
                wsId,
                opts.artifactId,
                'publish',
                opts.versionId ?? `${opts.artifactId}:${Date.now()}`,
              )
            : undefined,
        )
        .catch(() => {}),
    );
  }

  if (opts.artifactType === 'html' && env.BROWSER) {
    executionCtx.waitUntil(generateArtifactThumbnail(env, opts.artifactId).catch(() => false));
  }

  if (opts.artifactType === 'html') {
    executionCtx.waitUntil(generateArtifactSummary(env, opts.artifactId).catch(() => {}));
  }

  executionCtx.waitUntil(
    (opts.blocking
      ? runBlockGate(env, opts.artifactId, opts.workspaceId ?? '', opts.versionId, opts.routingSlug)
      : maybeRunMonitorTests(env, opts.artifactId, opts.workspaceId ?? '', opts.versionId)
    ).catch(() => {}),
  );
}
