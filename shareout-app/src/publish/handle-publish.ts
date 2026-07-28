/**
 * Token-authenticated POST /v1/publish handler.
 *
 * Validates auth, rate limits, workspace/skill/library gates, quotas, then
 * delegates to {@link publishArtifact}.
 */
import type { Env, PublishRequest } from '../types';
import { validatePublishRequest, generateSlug, detectArtifactType } from '../validation';
import { validateToken, checkRateLimit, incrementRateLimit, hasScope } from '../api-auth';
import { getInternalWorkspaceRole } from '../workspaces';
import { canAccess } from '../access/can-access';
import { withIdempotency } from '../idempotency';
import { pingIndexNow } from '../pages/seo';
import { createLogger, logError } from '../logging';
import { validateAccessPolicy } from '../data/access-policy';
import { resolveAllowOpen, OPEN_VISIBILITY_PAYWALL_MESSAGE } from '../access/allow-open';
import { checkStorageQuota, canAddPublicArtifact } from '../quota';
import { libraryVersionExists } from '../workspace-library';
import { json } from './http';
import { resolveAuthMethod, resolveVisibility } from './request-auth';
import { publishArtifact } from './publish-artifact';

export async function handlePublish(
  request: Request,
  env: Env,
  executionCtx?: ExecutionContext,
): Promise<Response> {
  return withIdempotency(request, env, async () => {
    const user = await validateToken(request, env);
    if (!user) {
      return json({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401);
    }

    if (!hasScope(user, 'artifacts:publish')) {
      return json({ error: 'Token missing artifacts:publish scope', code: 'INSUFFICIENT_SCOPE' }, 403);
    }

    const rateLimit = await checkRateLimit(env, user.id, 'publish', user.email);
    if (!rateLimit.allowed) {
      const retryAfter = Math.max(1, rateLimit.reset - Math.floor(Date.now() / 1000));
      const mins = Math.max(1, Math.ceil(retryAfter / 60));
      return new Response(JSON.stringify({
        error: `Publish rate limit reached. Try again in about ${mins} minute${mins === 1 ? '' : 's'}.`,
        code: 'RATE_LIMIT_EXCEEDED',
        remaining: 0,
        reset: rateLimit.reset,
        retryAfter,
      }), {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(rateLimit.reset),
          'Retry-After': String(retryAfter),
        },
      });
    }

    let body: PublishRequest;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400);
    }

    const validationError = validatePublishRequest(body);
    if (validationError) {
      return json(validationError, 400);
    }

    const slug = body.slug || generateSlug(body.name);
    const entrypoint = body.entrypoint || 'index.html';

    let workspaceId: string | null = body.workspace_id ?? null;
    // External-sharing spine (work/030) Phase 2: an external author (no internal role)
    // may create FENCED inside a folder where they hold a `create` grant. The artifact
    // is forced private and pinned to that folder — they can't publish workspace-wide,
    // can't target the root, and can't mint skills/libraries.
    let externalAuthor = false;
    if (workspaceId) {
      const workspaceRole = await getInternalWorkspaceRole(env, workspaceId, user.id);
      if (!workspaceRole) {
        const folderId = body.folder_id;
        const identity = { userIds: [user.id], emails: user.email ? [user.email] : [] };
        const folderWs = folderId
          ? (await env.DB.prepare('SELECT workspace_id FROM folders WHERE id = ?')
              .bind(folderId).first<{ workspace_id: string | null }>())?.workspace_id ?? null
          : null;
        const canAuthor = !!folderId && folderWs === workspaceId &&
          !body.artifact_type /* standard artifacts only */ &&
          await canAccess(env, identity, 'folder', folderId, 'create');
        if (!canAuthor) {
          return json({ error: 'Workspace not found or access denied', code: 'FORBIDDEN' }, 403);
        }
        externalAuthor = true;
      }
    } else {
      const prior = await env.DB.prepare(
        'SELECT workspace_id FROM artifacts WHERE display_slug = ? AND owner_id = ? AND workspace_id IS NOT NULL AND deleted_at IS NULL LIMIT 1'
      ).bind(slug, user.id).first<{ workspace_id: string }>();
      workspaceId = prior?.workspace_id ?? null;
    }

    const wantSkill = body.artifact_type === 'skill';
    if (wantSkill) {
      if (!workspaceId) {
        return json({ error: 'Skills must be published to a workspace', code: 'SKILL_REQUIRES_WORKSPACE' }, 400);
      }
      body.visibility = 'workspace';
    }

    const wantLibrary = body.artifact_type === 'library';
    if (wantLibrary) {
      const lib = body.library;
      if (!lib?.version) {
        return json({ error: 'library.version is required', code: 'LIBRARY_FIELDS_REQUIRED' }, 400);
      }
      if (workspaceId) body.visibility = 'workspace';
      const prior = workspaceId
        ? await env.DB.prepare('SELECT id FROM artifacts WHERE display_slug = ? AND workspace_id = ? AND deleted_at IS NULL').bind(slug, workspaceId).first<{ id: string }>()
        : await env.DB.prepare('SELECT id FROM artifacts WHERE display_slug = ? AND workspace_id IS NULL AND owner_id = ? AND deleted_at IS NULL').bind(slug, user.id).first<{ id: string }>();
      if (prior && await libraryVersionExists(env, prior.id, lib.version)) {
        return json({ error: `Library version ${lib.version} already published`, code: 'LIBRARY_VERSION_EXISTS' }, 409);
      }
    }

    // Legacy 'unlisted' input folds into 'public' (retired 2026-07).
    if ((body.visibility as string) === 'unlisted') body.visibility = 'public';

    let allowOpen = await resolveAllowOpen(env, user.id, workspaceId);
    const wantedOpen = body.visibility === 'public' || !body.visibility;
    let publishNotice: string | undefined;

    // Explicit public request the launch gate will downgrade to private — tell the
    // user, whatever the reason it's closed (global kill OR this user not yet in the
    // public rollout). A bare request (no visibility) defaults to public and is fine
    // to publish privately without a notice.
    if (!allowOpen && body.visibility === 'public') {
      publishNotice = OPEN_VISIBILITY_PAYWALL_MESSAGE;
    }

    if (wantedOpen && allowOpen && !user.email) {
      allowOpen = false;
      publishNotice = 'Link a verified email to publish publicly. Published privately for now.';
    }
    if (wantedOpen && allowOpen) {
      const cap = await canAddPublicArtifact(env, user.id);
      if (!cap.allowed) {
        allowOpen = false;
        publishNotice = `Public artifact limit reached (${cap.max}). Published privately. Upgrade or remove a public artifact.`;
      }
    }

    // External authors are fenced to private — they never publish workspace/public.
    const visibility = externalAuthor ? 'private' : resolveVisibility(body, env, allowOpen);
    if (externalAuthor && !publishNotice && body.visibility && body.visibility !== 'private') {
      publishNotice = 'As an external collaborator, your artifact is published privately to this folder.';
    }
    const authMethod = resolveAuthMethod(body);
    const shareWith = body.share_with || [];

    if (body.folder_id) {
      const folder = await env.DB.prepare(
        'SELECT id FROM folders WHERE id = ? AND workspace_id = ?'
      ).bind(body.folder_id, workspaceId).first();
      if (!folder) {
        return json({ error: 'Folder not found in workspace', code: 'FOLDER_NOT_FOUND' }, 404);
      }
    }

    const quota = await checkStorageQuota(env, user.id, body.files);
    if (!quota.allowed) {
      return json({
        error: `Storage limit reached (${Math.round(quota.max / 1_000_000)} MB). Delete artifacts or upgrade.`,
        code: 'STORAGE_LIMIT_EXCEEDED',
        used: quota.used,
        max: quota.max,
      }, 413);
    }

    const artifactType = detectArtifactType(body.files, entrypoint, body.artifact_type);

    if (body.access_policy !== undefined && body.access_policy !== null) {
      const policyError = validateAccessPolicy(body.access_policy);
      if (policyError) {
        return json({ error: policyError, code: 'INVALID_ACCESS_POLICY' }, 400);
      }
    }

    try {
      const result = await publishArtifact(env, user, {
        name: body.name,
        slug,
        entrypoint,
        files: body.files,
        visibility,
        authMethod,
        shareWith,
        password: body.password,
        credentials: body.credentials || [],
        workspaceId,
        allowOpen,
        folderId: body.folder_id || null,
        mobileHtml: body.mobile_html,
        mobileEntrypoint: body.mobile_entrypoint || 'mobile.html',
        pwa: body.pwa,
        accessPolicy: body.access_policy,
        agent: body.agent,
        artifactType,
        attachedSkillIds: body.attached_skill_ids,
        library: body.library,
      }, executionCtx);

      await incrementRateLimit(env, user.id, 'publish', user.email);

      if (visibility === 'public' && !result.moderation && !result.notice && !result.approval_required && executionCtx && typeof result?.deployment?.url === 'string') {
        executionCtx.waitUntil(pingIndexNow([result.deployment.url], env));
      }

      if (publishNotice) result.notice = publishNotice;

      // Machine-readable downgrade signal: when the caller asked for open visibility
      // but got something more private, say so at top level so an agent doesn't have
      // to parse `notice` prose (and doesn't announce a private link as public).
      // A moderation hold flips the row private *inside* publishArtifact after
      // `visibility` was resolved, so report the EFFECTIVE visibility, not the request.
      const effectiveVisibility = result.moderation ? 'private' : visibility;
      result.visibility = effectiveVisibility;
      if (body.visibility === 'public' && effectiveVisibility !== body.visibility) {
        result.visibility_downgraded = true;
        result.requested_visibility = body.visibility;
        // The moderation object already carries the richer "under review" story —
        // don't also stamp a generic downgrade notice over it.
        if (!result.notice && !result.moderation) result.notice = `Published as ${effectiveVisibility} instead of ${body.visibility}.`;
      }

      const response = json(result, 201);
      response.headers.set('X-RateLimit-Remaining', String(rateLimit.remaining - 1));
      response.headers.set('X-RateLimit-Reset', String(rateLimit.reset));
      return response;
    } catch (err) {
      if (err instanceof Error && err.message === 'FORBIDDEN') {
        return json({ error: 'You do not own this artifact', code: 'FORBIDDEN' }, 403);
      }
      logError(createLogger(env, { scope: 'publish', event: 'publish.failed' }), 'publish failed', err);
      return json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, 500);
    }
  });
}
