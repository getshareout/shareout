import type { Env } from '../types';
import { getSessionUser, loginPage, accessDeniedPage, passwordLoginPage, credentialsLoginPage, verifyAccessToken } from '../auth';
import { getVisibilityScope, placeholders } from '../account-links';
import { getInternalWorkspaceRole } from '../workspaces';
import { canAccess } from '../access/can-access';
import { recordShareeView } from '../sharees/activity';
import { getPendingAccessRequest } from '../artifacts/access-requests';
import type { ArtifactInfo } from './types';

// The name to attribute a share to on the sign-in screen — the page owner, but only
// when the page is actually meant for others (has collaborators or workspace visibility).
// Returns undefined for a truly private, unshared page so we don't claim it was shared.
// Note: we never surface the artifact title/thumbnail/OG tags to unauthorized visitors;
// sharedBy is the only optional hint (owner first name), and only when deliberately shared.
async function resolveSharedBy(env: Env, artifact: ArtifactInfo): Promise<string | undefined> {
  if (!artifact.owner_id) return undefined;
  const isShared = artifact.visibility === 'workspace' || !!(await env.DB.prepare(
    'SELECT 1 FROM collaborators WHERE artifact_id = ? LIMIT 1'
  ).bind(artifact.artifact_id).first());
  if (!isShared) return undefined;
  const owner = await env.DB.prepare('SELECT name, email FROM users WHERE id = ?')
    .bind(artifact.owner_id).first<{ name: string | null; email: string | null }>();
  return owner?.name || (owner?.email ? owner.email.split('@')[0] : undefined);
}

/** Owner or named collaborator, resolved across the caller's linked accounts. */
async function ownerOrCollaborator(
  env: Env,
  artifact: ArtifactInfo,
  userIds: string[],
  emails: string[],
): Promise<boolean> {
  if (artifact.owner_id && userIds.includes(artifact.owner_id)) return true;
  if (!emails.length) return false;
  return !!(await env.DB.prepare(
    `SELECT 1 FROM collaborators WHERE artifact_id = ? AND email IN (${placeholders(emails.length)})`
  ).bind(artifact.artifact_id, ...emails).first());
}

export async function checkAccess(
  request: Request,
  env: Env,
  slug: string,
  artifact: ArtifactInfo
): Promise<Response | null> {
  // 'google' is the historical name for "any signed-in ShareOut session" — the sign-in
  // page falls back to email OTP when the instance has no Google credentials. It is not
  // a Google-only gate.
  const authMethod = artifact.auth_method || 'google';

  if (authMethod === 'password' || authMethod === 'credentials') {
    const hasAccess = await verifyAccessToken(request, env, artifact.artifact_id);
    if (hasAccess) {
      return null;
    }

    // A password is an alternative way in for people with no account, not a second
    // factor stacked on top of a share. Someone who has proved they are the owner or
    // a named collaborator goes through — otherwise adding a collaborator to a
    // password-gated page hands them a wall they were never given the key to.
    const sessionUser = await getSessionUser(request, env);
    if (sessionUser) {
      const scope = await getVisibilityScope(env, sessionUser);
      if (await ownerOrCollaborator(env, artifact, scope.userIds, scope.emails)) return null;
    }

    // No title / OG / thumbnail on the gate — password possession is the proof; the
    // page itself must not advertise what is behind it to crawlers or link scrapers.
    if (authMethod === 'password') {
      return passwordLoginPage(slug, undefined, undefined, undefined, artifact.artifact_id);
    }
    return credentialsLoginPage(slug, undefined, undefined, undefined, artifact.artifact_id);
  }

  const user = await getSessionUser(request, env);

  if (!user) {
    const sharedBy = await resolveSharedBy(env, artifact);
    return loginPage(
      slug,
      undefined,
      undefined,
      env.TURNSTILE_CLOUDFLARE_SITEKEY,
      sharedBy,
      Boolean(env.GOOGLE_CLIENT_ID?.trim() && env.GOOGLE_CLIENT_SECRET?.trim()),
    );
  }

  // Resolve the full identity group so a personal login also carries the access
  // of its linked workspace accounts (matches the editor/screenshot grants).
  const { userIds, emails } = await getVisibilityScope(env, user);

  if (await ownerOrCollaborator(env, artifact, userIds, emails)) {
    return null;
  }

  // Workspace-wide access is granted only for 'workspace' visibility. A 'private'
  // artifact stays owner + explicitly-shared even when it lives in a workspace.
  if (artifact.visibility === 'workspace') {
    // workspace_id rides on ArtifactInfo (and the deploy: cache record). Fall back
    // to a query only for records cached before this field was carried.
    const workspaceId = artifact.workspace_id !== undefined
      ? artifact.workspace_id
      : (await env.DB.prepare(
          'SELECT workspace_id FROM artifacts WHERE id = ?'
        ).bind(artifact.artifact_id).first<{ workspace_id: string | null }>())?.workspace_id ?? null;

    if (workspaceId) {
      for (const id of userIds) {
        // Internal-only: an external member's edge must NOT satisfy workspace
        // visibility — they reach this artifact via an explicit grant (canAccess below).
        if (await getInternalWorkspaceRole(env, workspaceId, id)) {
          return null;
        }
      }
    }
  }

  // External-sharing spine (work/030): an external user with a view/comment grant on
  // this artifact (directly or via an ancestor folder) sees it. Additive — runs only
  // after owner/collaborator/workspace checks have already failed.
  if (await canAccess(env, { userIds, emails }, 'artifact', artifact.artifact_id, 'view')) {
    // Phase 4: record the read receipt (deduped per hour, never throws). The workspace
    // is the artifact's owning workspace; skip if it has none.
    const wsId = artifact.workspace_id ?? null;
    if (wsId) {
      await recordShareeView(env, {
        workspaceId: wsId, userId: user.id,
        resourceType: 'artifact', resourceId: artifact.artifact_id,
      });
    }
    return null;
  }

  const pendingRequest = user
    ? await getPendingAccessRequest(env, artifact.artifact_id, user.id)
    : null;

  return accessDeniedPage({
    slug,
    userEmail: user?.email,
    requestPending: !!pendingRequest,
  });
}

/**
 * Whether the request may view a closed (private/workspace) artifact — same
 * allow-path as checkAccess, but boolean (for secondary surfaces like thumbnails
 * that must 404 instead of returning an HTML login page).
 */
export async function canViewClosedArtifact(
  request: Request,
  env: Env,
  artifact: ArtifactInfo,
): Promise<boolean> {
  const denied = await checkAccess(request, env, artifact.artifact_id, artifact);
  return denied === null;
}