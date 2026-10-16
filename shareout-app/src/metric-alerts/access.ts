import type { Env } from '../types';
import { getUserRole } from '../artifacts/roles';
import { getInternalWorkspaceRole } from '../workspaces/roles';

export interface ArtifactRef {
  id: string;
  workspace_id: string | null;
}

/** A user who can manage every team alert on an artifact, or only self-subscribe. */
export type AlertRole = 'manager' | 'viewer';

/**
 * Resolve a user's alert authority on an artifact (workspace-aware). Managers are
 * the artifact owner/editor OR a workspace owner/admin of the artifact's workspace.
 * Viewers are viewer-collaborators or plain workspace members — they may only
 * self-subscribe. Workspace roles do not extend to a member's private artifact,
 * which only its owner and collaborators reach. Returns null when the user has no
 * access at all.
 */
export async function resolveAlertRole(
  env: Env,
  artifact: ArtifactRef,
  userId: string
): Promise<AlertRole | null> {
  const role = await getUserRole(env, artifact.id, userId);
  if (role === 'owner' || role === 'editor') return 'manager';

  if (artifact.workspace_id && !(await isPrivateArtifact(env, artifact.id))) {
    const wsRole = await getInternalWorkspaceRole(env, artifact.workspace_id, userId);
    if (wsRole === 'owner' || wsRole === 'admin') return 'manager';
    if (wsRole === 'member') return 'viewer';
  }

  if (role === 'viewer') return 'viewer';
  return null;
}

async function isPrivateArtifact(env: Env, artifactId: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT visibility FROM artifacts WHERE id = ?')
    .bind(artifactId).first<{ visibility: string | null }>();
  return row?.visibility === 'private';
}

export async function getArtifactRef(env: Env, artifactId: string): Promise<ArtifactRef | null> {
  return env.DB.prepare('SELECT id, workspace_id FROM artifacts WHERE id = ?')
    .bind(artifactId)
    .first<ArtifactRef>();
}
