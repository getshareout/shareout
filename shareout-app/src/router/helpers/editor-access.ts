import type { AuthUser } from '../../api-auth';
import type { Env, ArtifactType } from '../../types';
import type { EditorContext } from '../../editor/index';
import { jsonError } from './json-response';
import { getVisibilityScope } from '../../account-links';
import { getInternalWorkspaceRole } from '../../workspaces/roles';
import { canAccess } from '../../access/can-access';
import { isSuperAdminEmail } from '../../superadmin/auth';

export type ArtifactRole = 'owner' | 'editor' | 'viewer';

interface ArtifactRow {
  id: string;
  owner_id: string;
  workspace_id: string | null;
  name: string;
  slug: string;
}

export async function resolveArtifactEditorAccess(
  env: Env,
  artifactId: string,
  user: AuthUser,
): Promise<
  | { ok: true; artifact: ArtifactRow; role: ArtifactRole; editorContext: EditorContext }
  | { ok: false; response: Response }
> {
  const artifact = await env.DB.prepare(
    'SELECT id, owner_id, workspace_id, name, slug FROM artifacts WHERE id = ?'
  ).bind(artifactId).first<ArtifactRow>();

  if (!artifact) {
    return { ok: false, response: jsonError('Artifact not found', 'NOT_FOUND', 404) };
  }

  // Edit rights = artifact owner (incl. linked accounts), an editor/owner collaborator,
  // OR an owner/admin of the artifact's workspace.
  let role: ArtifactRole = 'viewer';
  if (artifact.owner_id === user.id) {
    role = 'owner';
  } else {
    const vis = await getVisibilityScope(env, user);
    if (artifact.owner_id && vis.userIds.includes(artifact.owner_id)) {
      role = 'owner';
    } else if (vis.emails.length) {
      const collab = await env.DB.prepare(
        `SELECT role FROM collaborators WHERE artifact_id = ? AND email IN (${vis.emails.map(() => '?').join(',')})`
      ).bind(artifactId, ...vis.emails).first<{ role: string }>();
      if (collab?.role === 'owner' || collab?.role === 'editor') {
        role = collab.role as 'owner' | 'editor';
      }
    }
    if (role === 'viewer' && artifact.workspace_id) {
      const wsRole = await getInternalWorkspaceRole(env, artifact.workspace_id, user.id);
      if (wsRole === 'owner' || wsRole === 'admin') role = 'editor';
    }
    // Platform super-admins can edit any artifact (parity with the visual-editor gate).
    if (role === 'viewer' && isSuperAdminEmail(user.email)) role = 'editor';
    // External-sharing spine (work/030): an external user with an 'edit' grant is
    // promoted to editor. Wired now; no edit grants are mintable until Phase 2.
    if (role === 'viewer' &&
        await canAccess(env, { userIds: vis.userIds, emails: vis.emails }, 'artifact', artifact.id, 'edit')) {
      role = 'editor';
    }
  }

  if (role === 'viewer') {
    return { ok: false, response: jsonError('Editor access denied', 'FORBIDDEN', 403) };
  }

  const userProfile = await env.DB.prepare(
    'SELECT name, picture FROM users WHERE id = ?'
  ).bind(user.id).first<{ name: string | null; picture: string | null }>();

  const editorContext: EditorContext = {
    artifactId,
    userId: user.id,
    userName: userProfile?.name || user.username || (user.email ? user.email.split('@')[0] : 'User'),
    userAvatar: userProfile?.picture || undefined,
    role,
    env,
  };

  return { ok: true, artifact, role, editorContext };
}

export async function resolveSlugEditorAccess(
  env: Env,
  slug: string,
  user: AuthUser
): Promise<
  | {
      ok: true;
      artifact: {
        id: string;
        slug: string;
        owner_id: string;
        workspace_id: string | null;
        visibility: string;
        name: string | null;
        description: string | null;
        artifact_type: ArtifactType;
      };
      role: ArtifactRole;
      editorUser: { userId: string; userName: string; userAvatar?: string };
    }
  | { ok: false; response: Response }
> {
  const artifact = await env.DB.prepare(`
    SELECT a.id, a.slug, a.owner_id, a.workspace_id, a.visibility, a.name, a.description, a.artifact_type
    FROM artifacts a
    JOIN deployments d ON d.artifact_id = a.id AND d.channel = 'production'
    WHERE d.slug = ?
  `).bind(slug).first<{
    id: string;
    slug: string;
    owner_id: string;
    workspace_id: string | null;
    visibility: string;
    name: string | null;
    description: string | null;
    artifact_type: ArtifactType;
  }>();

  if (!artifact) {
    return { ok: false, response: new Response('Artifact not found', { status: 404 }) };
  }

  let role: ArtifactRole = 'viewer';
  if (artifact.owner_id === user.id) {
    role = 'owner';
  } else {
    const vis = await getVisibilityScope(env, user);
    if (artifact.owner_id && vis.userIds.includes(artifact.owner_id)) {
      role = 'owner';
    } else if (vis.emails.length) {
      const collab = await env.DB.prepare(
        `SELECT role FROM collaborators WHERE artifact_id = ? AND email IN (${vis.emails.map(() => '?').join(',')})`
      ).bind(artifact.id, ...vis.emails).first<{ role: string }>();
      if (collab?.role === 'editor') role = 'editor';
      else if (collab?.role === 'owner') role = 'owner';
    }
    if (role === 'viewer' && artifact.workspace_id) {
      const wsRole = await getInternalWorkspaceRole(env, artifact.workspace_id, user.id);
      if (wsRole === 'owner' || wsRole === 'admin') role = 'editor';
    }
    if (role === 'viewer' && isSuperAdminEmail(user.email)) role = 'editor';
    // External-sharing spine (work/030): 'edit' grant promotes to editor (Phase 2+).
    if (role === 'viewer' &&
        await canAccess(env, { userIds: vis.userIds, emails: vis.emails }, 'artifact', artifact.id, 'edit')) {
      role = 'editor';
    }
  }

  if (role === 'viewer') {
    return { ok: false, response: new Response('Forbidden: Editor access required', { status: 403 }) };
  }

  const userProfile = await env.DB.prepare(`
    SELECT name, picture FROM users WHERE id = ?
  `).bind(user.id).first<{ name: string | null; picture: string | null }>();

  return {
    ok: true,
    artifact,
    role,
    editorUser: {
      userId: user.id,
      userName: userProfile?.name || user.email || 'Anonymous',
      userAvatar: userProfile?.picture || undefined,
    },
  };
}
