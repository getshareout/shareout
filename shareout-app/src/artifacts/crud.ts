/**
 * Core artifact CRUD: list, read, update, delete, and hard purge.
 */
import type { Env, Visibility, AuthMethod, ArtifactType } from '../types';
import type { AuthUser } from '../api-auth';
import { generateId } from '../crypto-utils';
import { emitJobEvent } from '../scheduling/events';
import { purgeInbox } from '../email/inbox-store';
import { validateAccessPolicy } from '../data/access-policy';
import { coerceVisibility, normalizeVisibility } from '../visibility-config';
import { resolveAllowOpen, OPEN_VISIBILITY_PAYWALL_MESSAGE } from '../access/allow-open';
import { classifyAndPersist, clearModerationHold, findBlockedCdnHosts } from '../moderation/check';
import { MODERATION_PENDING_MESSAGE, MODERATION_BLOCKED_MESSAGE } from '../publish/deployment';
import { canAddPublicArtifact } from '../quota';
import { buildSubdomainUrl } from '../subdomain';
import { getWorkspacePublishPolicy, hasApprovedPublish, getArtifactContentHash } from '../publish-approval';
import { getInternalWorkspaceRole } from '../workspaces/roles';
import { invalidateDeploymentCache } from '../serve/deployment-cache';
import { removeArtifactVector } from '../search/semantic';
import { getUserRole, requireRole } from './roles';
import { json } from './json-response';
import type { ArtifactDetail, ArtifactSummary } from './types';
import { setPresentation, type PresentationFields } from './satellites';

// Soft-deleted artifacts are recoverable for this many days, then a daily cron
// sweep (purgeSoftDeleted) runs the real hard purge.
export const RETENTION_DAYS = 30;

export async function handleListArtifacts(
  request: Request,
  env: Env,
  user: AuthUser
): Promise<Response> {
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);
  const offset = parseInt(url.searchParams.get('offset') || '0');
  const favoritesOnly = url.searchParams.get('favorites') === 'true';
  const workspaceId = url.searchParams.get('workspace_id')?.trim() || null;
  const wantCount = url.searchParams.get('count') === 'true';

  // Email is already resolved on the auth principal (token + session paths both
  // SELECT it from users), so reuse it instead of a separate round-trip.
  const email = user.email || '';
  const favoriteFilter = favoritesOnly ? ' AND f.artifact_id IS NOT NULL' : '';

  // Scope selection. Default (no workspace_id) lists everything the caller owns or
  // collaborates on, across workspaces. With workspace_id it lists that workspace's
  // artifacts — gated on membership: admins/owners see all (including workspace-owned
  // artifacts with no owner_id, which the personal scope never matched); plain members
  // see non-private artifacts plus their own.
  let scopeWhere: string;
  let scopeParams: unknown[];
  if (workspaceId) {
    const wsRole = await getInternalWorkspaceRole(env, workspaceId, user.id);
    if (!wsRole) {
      return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
    }
    if (wsRole === 'owner' || wsRole === 'admin') {
      scopeWhere = 'a.workspace_id = ?';
      scopeParams = [workspaceId];
    } else {
      scopeWhere = "a.workspace_id = ? AND (a.visibility != 'private' OR a.owner_id = ? OR c.email = ?)";
      scopeParams = [workspaceId, user.id, email];
    }
  } else {
    scopeWhere = '(a.owner_id = ? OR c.email = ?)';
    scopeParams = [user.id, email];
  }

  const results = await env.DB.prepare(`
    SELECT DISTINCT
      a.id, a.name, a.slug, a.visibility, a.paused, a.created_at, a.artifact_type,
      d.updated_at,
      (SELECT MAX(version_no) FROM versions WHERE artifact_id = a.id) as current_version,
      CASE WHEN a.owner_id = ? THEN 'owner' ELSE c.role END as user_role,
      CASE WHEN f.artifact_id IS NOT NULL THEN 1 ELSE 0 END as is_favorite
    FROM artifacts a
    LEFT JOIN deployments d ON d.artifact_id = a.id AND d.channel = 'production'
    LEFT JOIN collaborators c ON c.artifact_id = a.id AND c.email = ?
    LEFT JOIN favorites f ON f.artifact_id = a.id AND f.user_id = ?
    WHERE a.deleted_at IS NULL AND (${scopeWhere})${favoriteFilter}
    ORDER BY COALESCE(d.updated_at, a.created_at) DESC
    LIMIT ? OFFSET ?
  `).bind(user.id, email, user.id, ...scopeParams, limit + 1, offset).all<{
    id: string;
    name: string;
    slug: string;
    visibility: string;
    paused: number;
    created_at: string;
    updated_at: string | null;
    current_version: number;
    user_role: string;
    artifact_type: string;
    is_favorite: number;
  }>();

  // has_more from a LIMIT+1 probe — avoids an unbounded COUNT(DISTINCT) scan over
  // the caller's full library on every page load. Exact total is opt-in (?count=true).
  const rows = results.results || [];
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;

  let total: number | undefined;
  if (wantCount) {
    const countResult = await env.DB.prepare(`
      SELECT COUNT(DISTINCT a.id) as total
      FROM artifacts a
      LEFT JOIN collaborators c ON c.artifact_id = a.id AND c.email = ?
      LEFT JOIN favorites f ON f.artifact_id = a.id AND f.user_id = ?
      WHERE a.deleted_at IS NULL AND (${scopeWhere})${favoriteFilter}
    `).bind(email, user.id, ...scopeParams).first<{ total: number }>();
    total = countResult?.total || 0;
  }

  const artifacts: ArtifactSummary[] = pageRows.map(r => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    visibility: r.visibility as Visibility,
    paused: r.paused === 1,
    created_at: r.created_at,
    updated_at: r.updated_at,
    current_version: r.current_version || 1,
    user_role: r.user_role as ArtifactSummary['user_role'],
    artifact_type: (r.artifact_type || 'html') as ArtifactType,
    is_favorite: r.is_favorite === 1,
  }));

  return json({
    artifacts,
    has_more: hasMore,
    ...(total !== undefined ? { total } : {}),
    limit,
    offset,
  });
}

export async function handleGetArtifact(
  request: Request,
  env: Env,
  user: AuthUser,
  artifactId: string
): Promise<Response> {
  const artifact = await env.DB.prepare(`
    SELECT
      a.id, a.name, a.slug, a.visibility, a.paused, a.created_at, a.artifact_type,
      a.description, pres_a.social_title, pres_a.social_description, pres_a.social_image_url,
      pres_a.thumbnail_ext,
      a.auth_method, a.owner_id, a.workspace_id, a.folder_id, a.display_slug,
      COALESCE(pres_a.embed_allowed, 1) AS embed_allowed, pres_a.embed_origins,
      COALESCE(mod_a.status, 'approved') AS moderation_status,
      mod_a.reason AS moderation_reason, mod_a.checked_at AS moderation_checked_at,
      d.updated_at, d.slug as deploy_slug,
      w.slug as workspace_slug,
      (SELECT MAX(version_no) FROM versions WHERE artifact_id = a.id) as current_version,
      (SELECT COUNT(*) FROM favorites WHERE artifact_id = a.id AND user_id = ?) as is_favorite
    FROM artifacts a
    LEFT JOIN deployments d ON d.artifact_id = a.id AND d.channel = 'production'
    LEFT JOIN workspaces w ON w.id = a.workspace_id
    LEFT JOIN artifact_presentation pres_a ON pres_a.artifact_id = a.id
    LEFT JOIN artifact_moderation mod_a ON mod_a.artifact_id = a.id
    WHERE a.id = ? AND a.deleted_at IS NULL
  `).bind(user.id, artifactId).first<{
    id: string;
    name: string;
    slug: string;
    visibility: string;
    paused: number;
    created_at: string;
    description: string | null;
    social_title: string | null;
    social_description: string | null;
    social_image_url: string | null;
    thumbnail_ext: string | null;
    auth_method: string;
    owner_id: string | null;
    workspace_id: string | null;
    folder_id: string | null;
    display_slug: string | null;
    updated_at: string | null;
    deploy_slug: string | null;
    workspace_slug: string | null;
    artifact_type: string;
    current_version: number;
    embed_allowed: number;
    embed_origins: string | null;
    is_favorite: number;
    moderation_status: string | null;
    moderation_reason: string | null;
    moderation_checked_at: string | null;
  }>();

  if (!artifact) {
    return json({ error: 'Artifact not found', code: 'NOT_FOUND' }, 404);
  }

  const forbidden = await requireRole(env, artifactId, user.id, 'viewer');
  if (forbidden) return forbidden;

  const collaborators = await env.DB.prepare(
    'SELECT email, role FROM collaborators WHERE artifact_id = ?'
  ).bind(artifactId).all<{ email: string; role: string }>();

  const viewers = (collaborators.results || [])
    .filter(c => c.role === 'viewer')
    .map(c => c.email);

  const baseUrl = env.SHAREOUT_BASE_URL.replace(/\/$/, '');

  let embedOrigins: string[] | null = null;
  if (artifact.embed_origins) {
    try {
      embedOrigins = JSON.parse(artifact.embed_origins);
    } catch {
      embedOrigins = null;
    }
  }

  const thumbnailUrl = artifact.thumbnail_ext
    ? `${baseUrl}/t/${artifact.id}.${artifact.thumbnail_ext}`
    : null;

  const detail: ArtifactDetail = {
    id: artifact.id,
    name: artifact.name,
    slug: artifact.slug,
    visibility: artifact.visibility as Visibility,
    workspace_id: artifact.workspace_id,
    paused: artifact.paused === 1,
    created_at: artifact.created_at,
    updated_at: artifact.updated_at,
    current_version: artifact.current_version || 1,
    description: artifact.description,
    social_title: artifact.social_title,
    social_description: artifact.social_description,
    social_image_url: artifact.social_image_url,
    thumbnail_url: thumbnailUrl,
    auth_method: artifact.auth_method as AuthMethod,
    viewers,
    // Prefer the workspace-subdomain share URL (acme.shareout.site/<display_slug>/)
    // when the artifact lives in a workspace with a subdomain; fall back to /a/ on apex.
    url: artifact.workspace_slug && artifact.display_slug
      ? buildSubdomainUrl(baseUrl, artifact.workspace_slug, artifact.display_slug)
      : (artifact.deploy_slug ? `${baseUrl}/a/${artifact.deploy_slug}/` : ''),
    embed_url: artifact.deploy_slug ? `${baseUrl}/embed/${artifact.deploy_slug}/` : '',
    embed_allowed: artifact.embed_allowed === 1,
    embed_origins: embedOrigins,
    artifact_type: (artifact.artifact_type || 'html') as ArtifactType,
    is_favorite: artifact.is_favorite === 1,
  };

  const tagRows = await env.DB.prepare(
    'SELECT label FROM artifact_tags WHERE artifact_id = ? ORDER BY label COLLATE NOCASE'
  ).bind(artifactId).all<{ label: string }>();
  const tags = (tagRows.results || []).map(t => t.label);

  // Surface a held-artifact moderation object — but only to the owner/workspace-admin,
  // never to a plain viewer/collaborator, and never on an approved artifact.
  let moderation: ArtifactDetail['moderation'];
  if (artifact.moderation_status && artifact.moderation_status !== 'approved') {
    const denied = await requireOwnerOrWorkspaceAdmin(env, user, artifactId, artifact.workspace_id);
    if (!denied) {
      moderation = {
        status: artifact.moderation_status as 'pending' | 'blocked',
        reason: artifact.moderation_reason,
        checked_at: artifact.moderation_checked_at,
        message: artifact.moderation_status === 'pending' ? MODERATION_PENDING_MESSAGE : MODERATION_BLOCKED_MESSAGE,
      };
    }
  }

  return json({ ...detail, folder_id: artifact.folder_id, tags, ...(moderation ? { moderation } : {}) });
}

export async function handleUpdateArtifact(
  request: Request,
  env: Env,
  user: AuthUser,
  artifactId: string
): Promise<Response> {
  const artifact = await env.DB.prepare(
    'SELECT id, workspace_id, owner_id FROM artifacts WHERE id = ?'
  ).bind(artifactId).first<{ id: string; workspace_id: string | null; owner_id: string | null }>();

  if (!artifact) {
    return json({ error: 'Artifact not found', code: 'NOT_FOUND' }, 404);
  }

  const forbidden = await requireRole(env, artifactId, user.id, 'editor');
  if (forbidden) return forbidden;

  let body: {
    name?: string;
    description?: string;
    social_title?: string | null;
    social_description?: string | null;
    social_image_url?: string | null;
    visibility?: Visibility;
    paused?: boolean;
    embed_allowed?: boolean;
    embed_origins?: string[] | null;
    access_policy?: unknown;
    // Read-only-default opt-ins for public artifacts (Workstream A, migration 0080).
    allow_anon_write?: boolean;
    allow_anon_email?: boolean;
    allow_anon_agent?: boolean;
    allow_anon_collab?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400);
  }

  const updates: string[] = [];
  const values: (string | number | null)[] = [];

  if (body.name !== undefined) {
    updates.push('name = ?');
    values.push(body.name);
  }

  if (body.description !== undefined) {
    updates.push('description = ?');
    values.push(body.description || null);
  }

  // Presentation columns live in their own table; collect them separately and write
  // them alongside the spine update below.
  const presentation: PresentationFields = {};
  if (body.social_title !== undefined) presentation.social_title = body.social_title || null;
  if (body.social_description !== undefined) presentation.social_description = body.social_description || null;
  if (body.social_image_url !== undefined) presentation.social_image_url = body.social_image_url || null;

  let heldByModeration = false;
  let moderationReason: string | null = null;
  let visibilityHeldMessage: string | null = null;
  let approvalRequired: number | null = null;
  if (body.visibility !== undefined) {
    // Accept legacy 'unlisted' input and fold it into 'public' (retired 2026-07).
    const requested = normalizeVisibility(body.visibility) as Visibility;
    if (!['public', 'workspace', 'private'].includes(requested)) {
      return json({ error: 'Invalid visibility', code: 'INVALID_VISIBILITY' }, 400);
    }
    if (requested !== 'public') {
      // Explicit non-public choice over a held-from-public row: drop the hold so a
      // later re-classify can't restore it to public against the owner's choice.
      await clearModerationHold(env, artifactId);
    }
    const allowOpen = await resolveAllowOpen(env, user.id, artifact.workspace_id);
    let coerced = coerceVisibility(env, requested, allowOpen);
    if (requested === 'public' && coerced !== requested) {
      visibilityHeldMessage = OPEN_VISIBILITY_PAYWALL_MESSAGE;
    }
    if (coerced === 'public') {
      const ownerId = artifact.owner_id ?? user.id;
      // Anti-Sybil (F2): require a verified email to go public.
      if (!user.email) {
        coerced = 'private';
        visibilityHeldMessage = 'Link a verified email to publish publicly.';
      } else {
        // Per-account public-artifact cap (F3).
        const cap = await canAddPublicArtifact(env, ownerId);
        if (!cap.allowed) {
          coerced = 'private';
          visibilityHeldMessage = `Public artifact limit reached (${cap.max}).`;
        } else {
          // Workspace publish governance (Phase 1): prohibit, or require approval.
          const pol = await getWorkspacePublishPolicy(env, artifact.workspace_id);
          if (pol.policy === 'prohibit') {
            coerced = 'workspace';
            visibilityHeldMessage = "Your workspace doesn't allow public publishing — kept visible to your workspace.";
          } else if (pol.policy === 'require_approval'
            && !(await hasApprovedPublish(env, artifactId, await getArtifactContentHash(env, artifactId)))) {
            coerced = 'workspace';
            visibilityHeldMessage = `Your workspace requires approval to publish publicly. Request approval from ${pol.approvalsRequired} teammate(s).`;
            approvalRequired = pol.approvalsRequired;
          } else {
            // Blocked-CDN gate: an open page can only load scripts from the safety
            // allowlist, so refuse the transition (with a clear message) rather than
            // publish a page whose non-allowlisted CDN <script> would be CSP-blocked
            // and render broken. Private/workspace pages have no such limit.
            const blockedHosts = await findBlockedCdnHosts(env, artifactId);
            if (blockedHosts.length) {
              coerced = 'private';
              const shown = blockedHosts.slice(0, 3).join(', ');
              const more = blockedHosts.length > 3 ? ` and ${blockedHosts.length - 3} more` : '';
              visibilityHeldMessage = `Can't make this public — it loads scripts or styles from ${shown}${more}, which aren't allowed on public pages. Keep it private and add collaborators individually, or swap the external resource for one of the allowed CDNs.`;
            } else {
              // Publish-time safety check (B): non-approved holds it private.
              const status = await classifyAndPersist(env, artifactId);
              if (status !== 'approved') {
                coerced = 'private';
                heldByModeration = true;
                moderationReason = (await env.DB.prepare(
                  'SELECT reason FROM artifact_moderation WHERE artifact_id = ?'
                ).bind(artifactId).first<{ reason: string | null }>())?.reason ?? null;
              }
            }
          }
        }
      }
    }
    updates.push('visibility = ?');
    values.push(coerced);
  }

  if (body.paused !== undefined) {
    updates.push('paused = ?');
    values.push(body.paused ? 1 : 0);
  }

  if (body.embed_allowed !== undefined) presentation.embed_allowed = body.embed_allowed ? 1 : 0;
  if (body.embed_origins !== undefined) {
    presentation.embed_origins = body.embed_origins ? JSON.stringify(body.embed_origins) : null;
  }

  for (const flag of ['allow_anon_write', 'allow_anon_email', 'allow_anon_agent', 'allow_anon_collab'] as const) {
    if (body[flag] !== undefined) {
      updates.push(`${flag} = ?`);
      values.push(body[flag] ? 1 : 0);
    }
  }

  if (body.access_policy !== undefined) {
    if (body.access_policy !== null) {
      const policyError = validateAccessPolicy(body.access_policy);
      if (policyError) {
        return json({ error: policyError, code: 'INVALID_ACCESS_POLICY' }, 400);
      }
    }
    updates.push('access_policy = ?');
    values.push(body.access_policy === null ? null : JSON.stringify(body.access_policy));
  }

  const hasPresentation = Object.keys(presentation).length > 0;
  if (updates.length === 0 && !hasPresentation) {
    return json({ error: 'No fields to update', code: 'NO_UPDATES' }, 400);
  }

  if (updates.length > 0) {
    values.push(artifactId);
    await env.DB.prepare(
      `UPDATE artifacts SET ${updates.join(', ')} WHERE id = ?`
    ).bind(...values).run();
  }
  if (hasPresentation) await setPresentation(env, artifactId, presentation);

  if (env.SLUGS) {
    const deployment = await env.DB.prepare(
      'SELECT slug FROM deployments WHERE artifact_id = ? AND channel = ?'
    ).bind(artifactId, 'production').first<{ slug: string }>();
    if (deployment) {
      await env.SLUGS.delete(`deploy:${deployment.slug}`).catch(() => {});
      await env.SLUGS.delete(`art:${deployment.slug}`).catch(() => {});
      // dataMiddleware caches under artv2: (migration 0080 shape). Bust it too so
      // anon-access flag changes take effect immediately, not after the 5m TTL.
      await env.SLUGS.delete(`artv2:${deployment.slug}`).catch(() => {});
    }
    await env.SLUGS.delete(`art:${artifactId}`).catch(() => {});
    await env.SLUGS.delete(`artv2:${artifactId}`).catch(() => {});
  }

  emitJobEvent(env, artifactId, 'artifact.updated').catch(() => {});

  if (heldByModeration) {
    return json({
      moderation_status: 'pending',
      ...(moderationReason ? { reason: moderationReason } : {}),
      message: MODERATION_PENDING_MESSAGE,
      code: 'MODERATION_HELD',
    }, 202);
  }

  if (visibilityHeldMessage) {
    return json({
      visibility: approvalRequired ? 'workspace' : 'private',
      message: visibilityHeldMessage,
      code: 'VISIBILITY_HELD',
      ...(approvalRequired
        ? { approval_required: { required: approvalRequired, artifact_id: artifactId, visibility: 'public', workspace_id: artifact.workspace_id } }
        : {}),
    }, 202);
  }

  return handleGetArtifact(request, env, user, artifactId);
}

/**
 * Owner/workspace-admin permission gate shared by delete + restore. Returns null
 * when allowed, otherwise a Forbidden response.
 */
async function requireOwnerOrWorkspaceAdmin(
  env: Env,
  user: AuthUser,
  artifactId: string,
  workspaceId: string | null
): Promise<Response | null> {
  // The artifact owner may act on it. Workspace-owned artifacts often have no
  // owner_id, so also let an owner/admin of the artifact's workspace act —
  // otherwise nobody can manage them through the API.
  const role = await getUserRole(env, artifactId, user.id);
  let allowed = role === 'owner';
  if (!allowed && workspaceId) {
    const wsRole = await getInternalWorkspaceRole(env, workspaceId, user.id);
    allowed = wsRole === 'owner' || wsRole === 'admin';
  }
  return allowed ? null : json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
}

export async function handleDeleteArtifact(
  request: Request,
  env: Env,
  user: AuthUser,
  artifactId: string
): Promise<Response> {
  const artifact = await env.DB.prepare(
    'SELECT id, slug, workspace_id, deleted_at FROM artifacts WHERE id = ?'
  ).bind(artifactId).first<{ id: string; slug: string; workspace_id: string | null; deleted_at: string | null }>();

  if (!artifact || artifact.deleted_at) {
    return json({ error: 'Artifact not found', code: 'NOT_FOUND' }, 404);
  }

  const forbidden = await requireOwnerOrWorkspaceAdmin(env, user, artifactId, artifact.workspace_id);
  if (forbidden) return forbidden;

  const deletedAt = await softDeleteArtifact(env, artifactId, artifact.slug);

  // Recoverable for RETENTION_DAYS, then a daily cron sweep hard-purges it.
  const purgeAt = new Date(Date.parse(deletedAt) + RETENTION_DAYS * 86_400_000).toISOString();
  const baseUrl = env.SHAREOUT_BASE_URL.replace(/\/$/, '');

  return json({
    success: true,
    deleted: artifactId,
    deleted_at: deletedAt,
    recoverable_until: purgeAt,
    retention_days: RETENTION_DAYS,
    restore_url: `${baseUrl}/v1/artifacts/${artifactId}/restore`,
    message: `Artifact moved to trash. Recoverable for ${RETENTION_DAYS} days, then permanently deleted.`,
  });
}

/**
 * Soft-delete: stamp deleted_at, tombstone the globally-unique routing slug, drop
 * the production deployment (frees the slug for re-publish + makes serve paths 404
 * via their deployments join), and clear slug caches. R2 objects, versions, assets,
 * and the per-artifact MiniDB are left intact so the artifact is fully restorable
 * until the retention sweep purges it. Returns the deleted_at timestamp.
 */
export async function softDeleteArtifact(
  env: Env,
  artifactId: string,
  slug: string
): Promise<string> {
  const deletedAt = new Date().toISOString();
  // Tombstone the routing slug so it frees up immediately for a same-slug re-publish
  // (artifacts.slug carries a global UNIQUE, so it can't simply be left in place).
  await env.DB.prepare(
    "UPDATE artifacts SET deleted_at = ?, slug = '__deleted__' || id WHERE id = ?"
  ).bind(deletedAt, artifactId).run();
  await env.DB.prepare(
    "DELETE FROM deployments WHERE artifact_id = ? AND channel = 'production'"
  ).bind(artifactId).run();
  await invalidateDeploymentCache(env, slug, artifactId);
  await removeArtifactVector(env, artifactId).catch(() => {});
  return deletedAt;
}

export async function handleListDeletedArtifacts(
  request: Request,
  env: Env,
  user: AuthUser
): Promise<Response> {
  const rows = await env.DB.prepare(`
    SELECT a.id, a.name, a.display_slug, a.artifact_type, a.created_at, a.deleted_at, a.workspace_id
    FROM artifacts a
    WHERE a.deleted_at IS NOT NULL
      AND (a.owner_id = ? OR (a.workspace_id IS NOT NULL AND a.workspace_id IN (
        SELECT workspace_id FROM workspace_members WHERE user_id = ? AND role IN ('owner', 'admin')
      )))
    ORDER BY a.deleted_at DESC
    LIMIT 200
  `).bind(user.id, user.id).all<{
    id: string;
    name: string;
    display_slug: string | null;
    artifact_type: string;
    created_at: string;
    deleted_at: string;
    workspace_id: string | null;
  }>();

  const artifacts = (rows.results || []).map(r => ({
    id: r.id,
    name: r.name,
    display_slug: r.display_slug,
    artifact_type: (r.artifact_type || 'html') as ArtifactType,
    created_at: r.created_at,
    deleted_at: r.deleted_at,
    recoverable_until: new Date(Date.parse(r.deleted_at) + RETENTION_DAYS * 86_400_000).toISOString(),
    workspace_id: r.workspace_id,
  }));

  return json({ artifacts, retention_days: RETENTION_DAYS });
}

export async function handleRestoreArtifact(
  request: Request,
  env: Env,
  user: AuthUser,
  artifactId: string
): Promise<Response> {
  const artifact = await env.DB.prepare(
    'SELECT id, name, display_slug, workspace_id, owner_id, deleted_at FROM artifacts WHERE id = ?'
  ).bind(artifactId).first<{
    id: string;
    name: string;
    display_slug: string | null;
    workspace_id: string | null;
    owner_id: string | null;
    deleted_at: string | null;
  }>();

  if (!artifact) {
    return json({ error: 'Artifact not found', code: 'NOT_FOUND' }, 404);
  }
  if (!artifact.deleted_at) {
    return json({ error: 'Artifact is not deleted', code: 'NOT_DELETED' }, 400);
  }

  const forbidden = await requireOwnerOrWorkspaceAdmin(env, user, artifactId, artifact.workspace_id);
  if (forbidden) return forbidden;

  // Latest version still exists (soft-delete keeps versions/assets). Restore needs a
  // production deployment to be servable again.
  const latest = await env.DB.prepare(
    'SELECT id FROM versions WHERE artifact_id = ? ORDER BY version_no DESC LIMIT 1'
  ).bind(artifactId).first<{ id: string }>();
  if (!latest) {
    return json({ error: 'Artifact has no version to restore', code: 'NO_VERSION' }, 409);
  }

  // The original routing slug was tombstoned on delete; allocate a fresh one from the
  // human slug (suffixed if taken in the meantime — free-slug-on-delete means another
  // artifact may have claimed the bare slug). display_slug was kept intact, but a
  // re-publish may have reclaimed it in this scope, so re-derive a free one too —
  // otherwise clearing deleted_at would collide with the per-scope unique index.
  const baseSlug = artifact.display_slug || 'artifact';
  const routingSlug = await allocateFreeRoutingSlug(env, baseSlug);
  const displaySlug = await allocateFreeDisplaySlug(env, baseSlug, artifact.owner_id, artifact.workspace_id);

  await env.DB.prepare(
    'UPDATE artifacts SET deleted_at = NULL, slug = ?, display_slug = ? WHERE id = ?'
  ).bind(routingSlug, displaySlug, artifactId).run();

  await env.DB.prepare(`
    INSERT INTO deployments (id, artifact_id, version_id, channel, slug, updated_at)
    VALUES (?, ?, ?, 'production', ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ON CONFLICT(artifact_id, channel) DO UPDATE SET
      version_id = excluded.version_id,
      slug = excluded.slug,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  `).bind(generateId('dep'), artifactId, latest.id, routingSlug).run();

  await invalidateDeploymentCache(env, routingSlug, artifactId);

  return handleGetArtifact(request, env, user, artifactId);
}

// handleRestoreArtifact costs ~6-10 subrequests each (slug allocation probes +
// deployment upsert); 50 keeps a single "restore all" well under the 1,000-subrequest
// Worker cap. A follow-up click drains the next batch.
const RESTORE_ALL_CAP = 50;

/**
 * Bulk "restore all" for the trash modal. Scopes rows exactly like
 * handleListDeletedArtifacts (your own artifacts, or a workspace's trash if you're
 * owner/admin there), then restores each one via handleRestoreArtifact — same guards,
 * same logic, no second restore path to keep in sync.
 */
export async function handleRestoreAllDeleted(
  request: Request,
  env: Env,
  user: AuthUser
): Promise<Response> {
  const rows = await env.DB.prepare(`
    SELECT a.id
    FROM artifacts a
    WHERE a.deleted_at IS NOT NULL
      AND (a.owner_id = ? OR (a.workspace_id IS NOT NULL AND a.workspace_id IN (
        SELECT workspace_id FROM workspace_members WHERE user_id = ? AND role IN ('owner', 'admin')
      )))
    ORDER BY a.deleted_at DESC
    LIMIT ?
  `).bind(user.id, user.id, RESTORE_ALL_CAP + 1).all<{ id: string }>();

  const all = rows.results || [];
  const ids = all.slice(0, RESTORE_ALL_CAP);
  const mayHaveMore = all.length > RESTORE_ALL_CAP;

  let restored = 0;
  for (const { id } of ids) {
    try {
      const res = await handleRestoreArtifact(request, env, user, id);
      if (res.ok) restored++;
    } catch {
      // one artifact's failure must not block the rest
    }
  }
  return json({ restored, may_have_more: mayHaveMore });
}

/**
 * Allocate a globally-unique routing slug for a restored artifact. Mirrors
 * publish.ts allocateRoutingSlug; kept local to avoid a publish→artifacts import
 * cycle. Soft-deleted rows hold tombstoned slugs, so they never collide here.
 */
async function allocateFreeRoutingSlug(env: Env, baseSlug: string): Promise<string> {
  const isTaken = async (candidate: string): Promise<boolean> =>
    !!(await env.DB.prepare('SELECT 1 FROM artifacts WHERE slug = ? LIMIT 1').bind(candidate).first());
  if (!(await isTaken(baseSlug))) return baseSlug;
  for (let n = 2; ; n++) {
    const candidate = `${baseSlug}-${n}`;
    if (!(await isTaken(candidate))) return candidate;
  }
}

/**
 * Allocate a free display_slug within the artifact's scope (per-workspace, or
 * per-owner for personal). Only live rows count — the partial unique indexes
 * (migration 0077) exclude soft-deleted rows.
 */
async function allocateFreeDisplaySlug(
  env: Env,
  baseSlug: string,
  ownerId: string | null,
  workspaceId: string | null
): Promise<string> {
  const sql = workspaceId
    ? 'SELECT 1 FROM artifacts WHERE display_slug = ? AND workspace_id = ? AND deleted_at IS NULL LIMIT 1'
    : 'SELECT 1 FROM artifacts WHERE display_slug = ? AND workspace_id IS NULL AND owner_id = ? AND deleted_at IS NULL LIMIT 1';
  const scopeParam = workspaceId ?? ownerId;
  const isTaken = async (candidate: string): Promise<boolean> =>
    !!(await env.DB.prepare(sql).bind(candidate, scopeParam).first());
  if (!(await isTaken(baseSlug))) return baseSlug;
  for (let n = 2; ; n++) {
    const candidate = `${baseSlug}-${n}`;
    if (!(await isTaken(candidate))) return candidate;
  }
}

/**
 * Retention sweep: hard-purge artifacts soft-deleted more than RETENTION_DAYS ago.
 * Bounded per run to stay under the Worker subrequest cap. Returns count purged.
 */
export async function purgeSoftDeleted(env: Env, limit = 50): Promise<number> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString();
  const due = await env.DB.prepare(
    'SELECT id, slug FROM artifacts WHERE deleted_at IS NOT NULL AND deleted_at < ? LIMIT ?'
  ).bind(cutoff, limit).all<{ id: string; slug: string }>();

  let purged = 0;
  for (const row of due.results || []) {
    await purgeArtifact(env, row.id, row.slug).catch(() => {});
    purged++;
  }
  return purged;
}

/**
 * Hard-delete an artifact and dependent rows (versions, deployments, assets,
 * collaborators, credentials) plus R2 objects and cached slugs. Used by owner
 * delete and super-admin user-deletion cascades.
 */
export async function purgeArtifact(
  env: Env,
  artifactId: string,
  slug: string
): Promise<void> {
  const versions = await env.DB.prepare(
    'SELECT id FROM versions WHERE artifact_id = ?'
  ).bind(artifactId).all<{ id: string }>();

  for (const version of versions.results || []) {
    const assets = await env.DB.prepare(
      'SELECT r2_key FROM assets WHERE version_id = ?'
    ).bind(version.id).all<{ r2_key: string }>();

    for (const asset of assets.results || []) {
      await env.ARTIFACTS.delete(asset.r2_key).catch(() => {});
    }
  }

  await env.DB.prepare('DELETE FROM collaborators WHERE artifact_id = ?').bind(artifactId).run();
  await env.DB.prepare('DELETE FROM artifact_tags WHERE artifact_id = ?').bind(artifactId).run();
  await env.DB.prepare('DELETE FROM artifact_passwords WHERE artifact_id = ?').bind(artifactId).run();
  await env.DB.prepare('DELETE FROM assets WHERE version_id IN (SELECT id FROM versions WHERE artifact_id = ?)').bind(artifactId).run();
  await env.DB.prepare('DELETE FROM deployments WHERE artifact_id = ?').bind(artifactId).run();
  await env.DB.prepare('DELETE FROM versions WHERE artifact_id = ?').bind(artifactId).run();

  // Skill Marketplace rows have ON DELETE CASCADE on artifacts(id), but D1 may run
  // with FK enforcement off, so delete them explicitly (matching the pattern above).
  // artifact_skills references the artifact as both the target and the skill.
  await env.DB.prepare('DELETE FROM skill_marketplace WHERE artifact_id = ?').bind(artifactId).run();
  await env.DB.prepare('DELETE FROM skill_votes WHERE artifact_id = ?').bind(artifactId).run();
  await env.DB.prepare('DELETE FROM skill_installs WHERE artifact_id = ?').bind(artifactId).run();
  await env.DB.prepare('DELETE FROM skill_uses WHERE skill_artifact_id = ?').bind(artifactId).run();
  await env.DB.prepare('DELETE FROM artifact_skills WHERE artifact_id = ? OR skill_artifact_id = ?').bind(artifactId, artifactId).run();

  // Inbox messages + their R2 attachments live in the per-artifact MiniDB, which has
  // no FK cascade to artifacts — purge them explicitly. The artifact_emails row
  // itself cascades via its FK on DELETE FROM artifacts below.
  const wsRow = await env.DB.prepare('SELECT workspace_id FROM artifacts WHERE id = ?')
    .bind(artifactId).first<{ workspace_id: string | null }>();
  await purgeInbox(env, artifactId, wsRow?.workspace_id ?? '').catch(() => {});

  await env.DB.prepare('DELETE FROM artifacts WHERE id = ?').bind(artifactId).run();

  for (const ext of ['webp', 'png', 'jpg']) {
    await env.ARTIFACTS.delete(`thumbnails/${artifactId}.${ext}`).catch(() => {});
    await env.ARTIFACTS.delete(`thumbnails/${artifactId}_card.${ext}`).catch(() => {});
  }

  if (env.SLUGS) {
    await env.SLUGS.delete(`deploy:${slug}`).catch(() => {});
  }
}
