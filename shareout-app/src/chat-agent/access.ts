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
  const user = await env.DB.prepare('SELECT email, identity_id FROM users WHERE id = ?')
    .bind(userId)
    .first<{ email: string | null; identity_id: string | null }>();
  if (!user?.identity_id) {
    return { userIds: [userId], emails: user?.email ? [user.email] : [] };
  }

  const rows = await env.DB.prepare('SELECT id, email FROM users WHERE identity_id = ?')
    .bind(user.identity_id)
    .all<{ id: string; email: string | null }>();
  const userIds = rows.results.map((r) => r.id);
  if (!userIds.includes(userId)) userIds.unshift(userId);
  const emails = rows.results.map((r) => r.email).filter((email): email is string => !!email);
  if (user.email && !emails.includes(user.email)) emails.push(user.email);
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
    'SELECT owner_id, workspace_id, visibility, access_policy FROM artifacts WHERE id = ?'
  ).bind(artifactId).first<ArtifactRow>();
  if (!art) return null;

  const scope = await getBotVisibilityScope(env, userId);
  const idPh = placeholders(scope.userIds.length);
  const emailPh = placeholders(scope.emails.length);

  const isWorkspaceMember = art.workspace_id
    ? !!(await env.DB.prepare(
      `SELECT 1 FROM workspace_members WHERE workspace_id = ? AND user_id IN (${idPh}) LIMIT 1`
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

export async function listWorkspacesForUser(env: Env, userId: string): Promise<BotWorkspace[]> {
  const scope = await getBotVisibilityScope(env, userId);
  const idPh = placeholders(scope.userIds.length);
  const res = await env.DB.prepare(`
    SELECT w.id, w.name, w.slug,
           MAX(CASE wm.role WHEN 'owner' THEN 3 WHEN 'admin' THEN 2 ELSE 1 END) AS role_rank,
           (SELECT COUNT(*) FROM artifacts a WHERE a.workspace_id = w.id) AS artifact_count
      FROM workspaces w
      JOIN workspace_members wm ON wm.workspace_id = w.id
     WHERE wm.user_id IN (${idPh})
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
