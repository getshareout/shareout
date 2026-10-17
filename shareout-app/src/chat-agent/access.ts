import type { Env, CollaboratorRole } from '../types';
import { parseAccessPolicy, resolveViewerScope, type ViewerScope } from '../data/access-policy';
import { placeholders, type VisibilityScope } from '../account-links';
import { PERSONAL_SCOPE, type WorkspaceSelection } from '../chat-platforms/types';

export { PERSONAL_SCOPE, type WorkspaceSelection };

// THE authoritative access gate for the account-level bot agent. Every tool that
// touches an artifact resolves access through this so the agent can never see
// more than the linked user can. Mirrors the rules in data/middleware.ts
// (owner / collaborator / workspace-visible) and carries the row-level
// viewerScope that crew deliberately bypasses but this agent must honour.
export interface ArtifactAccess {
  artifactId: string;
  role: CollaboratorRole;
  workspaceId: string | null;
  /** Row-level filter for table reads. null = no filter (owner / no policy). */
  viewerScope: ViewerScope | null;
  isWorkspaceMember: boolean;
  /** Owner or workspace member — may run the artifact's live data connections. */
  canRunConnections: boolean;
}

interface ArtifactRow {
  owner_id: string;
  workspace_id: string | null;
  visibility: string;
  access_policy: string | null;
}

export interface BotWorkspace {
  id: string;
  name: string;
  slug: string;
  role: 'owner' | 'admin' | 'member';
  artifactCount: number;
}

/** @deprecated Use BotWorkspace */
export type TelegramWorkspace = BotWorkspace;

/** @deprecated Use PERSONAL_SCOPE */
export const TELEGRAM_PERSONAL_WORKSPACE = PERSONAL_SCOPE;

/** @deprecated Use WorkspaceSelection */
export type TelegramWorkspaceSelection = WorkspaceSelection;

function roleFromRank(rank: number | null | undefined): BotWorkspace['role'] {
  if (rank === 3) return 'owner';
  if (rank === 2) return 'admin';
  return 'member';
}

export async function getBotVisibilityScope(env: Env, userId: string): Promise<VisibilityScope> {
  // One round trip: the user's row plus every enabled row sharing its non-NULL identity_id.
  const rows = (await env.DB.prepare(
    'SELECT id, email FROM users WHERE id = ? OR (identity_id = (SELECT identity_id FROM users WHERE id = ?) AND COALESCE(disabled, 0) = 0)',
  ).bind(userId, userId).all<{ id: string; email: string | null }>()).results || [];
  const self = rows.find((r) => r.id === userId);
  const userIds = rows.map((r) => r.id);
  if (!userIds.includes(userId)) userIds.unshift(userId);
  const emails = rows.map((r) => r.email).filter((email): email is string => !!email);
  if (self?.email && !emails.includes(self.email)) emails.push(self.email);
  return { userIds, emails };
}

/** @deprecated Use getBotVisibilityScope */
export const getTelegramVisibilityScope = getBotVisibilityScope;

export async function resolveArtifactAccessForUser(
  env: Env,
  artifactId: string,
  userId: string
): Promise<ArtifactAccess | null> {
  const art = await env.DB.prepare(
    'SELECT owner_id, workspace_id, visibility, access_policy FROM artifacts WHERE id = ? AND deleted_at IS NULL'
  ).bind(artifactId).first<ArtifactRow>();
  if (!art) return null;

  const scope = await getBotVisibilityScope(env, userId);
  const idPh = placeholders(scope.userIds.length);
  const emailPh = placeholders(scope.emails.length);

  const isWorkspaceMember = art.workspace_id
    ? !!(await env.DB.prepare(
      `SELECT 1 FROM workspace_members WHERE workspace_id = ? AND member_class = 'internal' AND user_id IN (${idPh}) LIMIT 1`
    ).bind(art.workspace_id, ...scope.userIds).first())
    : false;

  // Owner across any linked account → full access, no row-level filtering.
  if (scope.userIds.includes(art.owner_id)) {
    return {
      artifactId,
      role: 'owner',
      workspaceId: art.workspace_id,
      viewerScope: null,
      isWorkspaceMember,
      canRunConnections: true,
    };
  }

  let role: CollaboratorRole | null = null;
  let policyEmail: string | null = scope.emails[0] ?? null;
  if (scope.emails.length) {
    const collab = await env.DB.prepare(
      `SELECT role, email FROM collaborators
       WHERE artifact_id = ? AND email IN (${emailPh})
       ORDER BY CASE role WHEN 'owner' THEN 3 WHEN 'editor' THEN 2 ELSE 1 END DESC
       LIMIT 1`
    ).bind(artifactId, ...scope.emails).first<{ role: CollaboratorRole; email: string }>();
    role = collab?.role ?? null;
    policyEmail = collab?.email ?? policyEmail;
  }

  // Workspace-visible artifacts grant viewer access to any workspace member.
  if (!role && art.visibility === 'workspace' && isWorkspaceMember) {
    role = 'viewer';
  }

  // Deny everything else (private without grant, public-by-link).
  if (!role) return null;

  const viewerScope = resolveViewerScope(parseAccessPolicy(art.access_policy), {
    email: policyEmail,
    isOwner: false,
  });

  return {
    artifactId,
    role,
    workspaceId: art.workspace_id,
    viewerScope,
    isWorkspaceMember,
    canRunConnections: isWorkspaceMember,
  };
}

// Internal memberships only: an external (sharee) edge never grants workspace
// visibility here; externals reach pages through explicit grants elsewhere.
export async function listWorkspacesForUser(env: Env, userId: string, scopeArg?: VisibilityScope): Promise<BotWorkspace[]> {
  const scope = scopeArg ?? await getBotVisibilityScope(env, userId);
  const idPh = placeholders(scope.userIds.length);
  const res = await env.DB.prepare(`
    SELECT w.id, w.name, w.slug,
           MAX(CASE wm.role WHEN 'owner' THEN 3 WHEN 'admin' THEN 2 ELSE 1 END) AS role_rank,
           (SELECT COUNT(*) FROM artifacts a WHERE a.workspace_id = w.id AND a.deleted_at IS NULL) AS artifact_count
      FROM workspaces w
      JOIN workspace_members wm ON wm.workspace_id = w.id
     WHERE wm.user_id IN (${idPh}) AND wm.member_class = 'internal'
     GROUP BY w.id
     ORDER BY lower(w.name) ASC
  `).bind(...scope.userIds).all<{
    id: string;
    name: string;
    slug: string;
    role_rank: number;
    artifact_count: number;
  }>();
  return res.results.map((w) => ({
    id: w.id,
    name: w.name,
    slug: w.slug,
    role: roleFromRank(w.role_rank),
    artifactCount: w.artifact_count,
  }));
}

// Workspace ids the linked-account set belongs to — used to union workspace-visible
// artifacts into list/search results and to gate the bot feature.
export async function getUserWorkspaceIds(env: Env, userId: string): Promise<string[]> {
  return (await listWorkspacesForUser(env, userId)).map((w) => w.id);
}
