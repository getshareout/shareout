/**
 * Artifact collaborator role checks.
 *
 * Roles are resolved from artifact ownership or the collaborators table.
 * `requireRole` is the guard used by handlers before mutating or reading data.
 */
import type { Env, CollaboratorRole } from '../types';
import { getInternalWorkspaceRole } from '../workspaces/roles';
import { json } from './json-response';

const ROLE_HIERARCHY: Record<CollaboratorRole, number> = { owner: 3, editor: 2, viewer: 1 };

/** Resolve the caller's role on an artifact, or null when they have no access. */
export async function getUserRole(
  env: Env,
  artifactId: string,
  userId: string
): Promise<CollaboratorRole | null> {
  const artifact = await env.DB.prepare(
    'SELECT owner_id FROM artifacts WHERE id = ?'
  ).bind(artifactId).first<{ owner_id: string }>();

  if (artifact?.owner_id === userId) return 'owner';

  const user = await env.DB.prepare(
    'SELECT email FROM users WHERE id = ?'
  ).bind(userId).first<{ email: string }>();
  if (!user?.email) return null;

  const collab = await env.DB.prepare(
    'SELECT role FROM collaborators WHERE artifact_id = ? AND email = ?'
  ).bind(artifactId, user.email).first<{ role: CollaboratorRole }>();

  return collab?.role || null;
}

/**
 * True when `userId` is an owner/admin of the workspace that owns this artifact.
 *
 * This is the SHARING-MANAGEMENT seam only. It deliberately does NOT widen
 * getUserRole: a workspace admin still gets no content read on a member's private
 * artifact (same rule canAccess encodes by keeping 'artifact' out of its
 * membership resources). It exists because the same admin can already pause an
 * artifact, change its visibility and transfer it via /v1/workspaces/{id}/admin/
 * artifacts — authority that stopped dead at the collaborator list and the access
 * queue, so an artifact whose owner had left the company could not be reshared by
 * anyone.
 */
export async function isArtifactSharingAdmin(
  env: Env,
  artifactId: string,
  userId: string
): Promise<boolean> {
  const row = await env.DB.prepare('SELECT workspace_id FROM artifacts WHERE id = ?')
    .bind(artifactId).first<{ workspace_id: string | null }>();
  if (!row?.workspace_id) return false;
  const role = await getInternalWorkspaceRole(env, row.workspace_id, userId);
  return role === 'owner' || role === 'admin';
}

/**
 * Enforce a minimum role. Returns a 403 Response when access is denied,
 * or null when the caller may proceed.
 */
export async function requireRole(
  env: Env,
  artifactId: string,
  userId: string,
  minRole: CollaboratorRole
): Promise<Response | null> {
  const role = await getUserRole(env, artifactId, userId);
  if (!role) return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  if (ROLE_HIERARCHY[role] < ROLE_HIERARCHY[minRole]) {
    return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  }
  return null;
}

/**
 * requireRole for the sharing surface: the artifact's own roles, OR the workspace
 * owner/admin who governs it. Use this on who-can-see-this operations (collaborators,
 * ownership, access requests) — never on content reads or writes.
 */
export async function requireSharingRole(
  env: Env,
  artifactId: string,
  userId: string,
  minRole: CollaboratorRole
): Promise<Response | null> {
  const forbidden = await requireRole(env, artifactId, userId, minRole);
  if (!forbidden) return null;
  return (await isArtifactSharingAdmin(env, artifactId, userId)) ? null : forbidden;
}
