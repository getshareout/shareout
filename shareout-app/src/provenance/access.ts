/**
 * Who is asking for a page's sources. Anyone who can view the page may read the summary
 * (the same allow-path the viewer uses: public link, session, password, space guest,
 * grant, personal API token). Editors and managers get the full details. A viewer whose
 * rows are filtered by the artifact's access policy is "scoped".
 */
import type { Env } from '../types';
import type { AuthUser } from '../api-auth';
import type { FetchContext } from '../router/context';
import type { ArtifactInfo } from '../serve/types';
import { getTokenOrSessionUser } from '../router/helpers/auth-guard';
import { resolveArtifactEditorAccess } from '../router/helpers/editor-access';
import { canViewClosedArtifact } from '../serve/access';
import { getVisibilityScope, placeholders } from '../account-links';
import { getInternalWorkspaceRole } from '../workspaces/roles';
import { canAccess } from '../access/can-access';
import { normalizeVisibility } from '../visibility-config';
import { parseAccessPolicy } from '../data/access-policy';
import { spaceGuestFor } from '../sharees/space-guest';

export interface ProvenanceArtifact {
  id: string;
  owner_id: string | null;
  workspace_id: string | null;
  visibility: string;
  auth_method: string | null;
  access_policy: string | null;
  paused: number;
  moderation_status: string;
}

export interface SourcesCaller {
  /** Editor/manager: queries, connection identifiers, credential hints. */
  full: boolean;
  /** Rows filtered by the artifact's access policy. */
  scoped: boolean;
  /** May see who refreshes the data (job / crew names): editors, and people tied to the
   *  page or its workspace (collaborators, members, grant holders, space guests). An
   *  anonymous public-link or password viewer sees "updated automatically" instead. */
  named: boolean;
}

/** The cache partition a caller's response belongs to; never shared across classes. */
export function callerClass(c: SourcesCaller): 'full' | 'named' | 'scoped' | 'public' {
  return c.full ? 'full' : c.scoped ? 'scoped' : c.named ? 'named' : 'public';
}

export async function loadProvenanceArtifact(env: Env, artifactId: string): Promise<ProvenanceArtifact | null> {
  return env.DB.prepare(
    `SELECT a.id, a.owner_id, a.workspace_id, a.visibility, a.auth_method, a.access_policy, a.paused,
            COALESCE(m.status, 'approved') AS moderation_status
       FROM artifacts a LEFT JOIN artifact_moderation m ON m.artifact_id = a.id
      WHERE a.id = ? AND a.deleted_at IS NULL`,
  ).bind(artifactId).first<ProvenanceArtifact>();
}

/** The signed-in caller (session or personal API token), or null. Agent tokens don't count. */
export function sourcesUser(ctx: FetchContext): Promise<AuthUser | null> {
  return getTokenOrSessionUser(ctx);
}

/** The caller's view of this page's sources, or null when they may not see the page. */
export async function resolveSourcesCaller(ctx: FetchContext, art: ProvenanceArtifact, user: AuthUser | null): Promise<SourcesCaller | null> {
  const editor = user ? (await resolveArtifactEditorAccess(ctx.env, art.id, user)).ok : false;
  if (editor) return { full: true, scoped: false, named: true };
  if (art.paused === 1 || art.moderation_status === 'blocked') return null;
  if (!(await canView(ctx, art, user))) return null;
  const scoped = parseAccessPolicy(art.access_policy) !== null;
  return { full: false, scoped, named: !scoped && (await isRelated(ctx, art, user)) };
}

/**
 * Tied to the page or its workspace by identity: owner, collaborator, internal member of
 * its workspace, a view grant, or a space-guest session that reaches it. Password
 * possession and a public link are not an identity.
 */
async function isRelated(ctx: FetchContext, art: ProvenanceArtifact, user: AuthUser | null): Promise<boolean> {
  if (user) {
    const { userIds, emails } = await getVisibilityScope(ctx.env, user);
    if (art.owner_id && userIds.includes(art.owner_id)) return true;
    if (emails.length) {
      const collab = await ctx.env.DB.prepare(
        `SELECT 1 FROM collaborators WHERE artifact_id = ? AND email IN (${placeholders(emails.length)})`,
      ).bind(art.id, ...emails).first();
      if (collab) return true;
    }
    if (art.workspace_id) {
      for (const id of userIds) if (await getInternalWorkspaceRole(ctx.env, art.workspace_id, id)) return true;
    }
    if (await canAccess(ctx.env, { userIds, emails }, 'artifact', art.id, 'view')) return true;
  }
  return !!(await spaceGuestFor(ctx.request, ctx.env, 'artifact', art.id, 'view'));
}

async function canView(ctx: FetchContext, art: ProvenanceArtifact, user: AuthUser | null): Promise<boolean> {
  if ((normalizeVisibility(art.visibility) || 'public') === 'public') return true;
  const info = {
    artifact_id: art.id,
    owner_id: art.owner_id,
    workspace_id: art.workspace_id,
    visibility: art.visibility,
    auth_method: art.auth_method,
  } as ArtifactInfo;
  // Session cookie, password grant, space-guest session: the page's own gate.
  if (await canViewClosedArtifact(ctx.request, ctx.env, info)) return true;
  // A personal API token carries no cookie; apply the same read rule to its user.
  return user ? tokenUserCanView(ctx.env, art, user) : false;
}

async function tokenUserCanView(env: Env, art: ProvenanceArtifact, user: AuthUser): Promise<boolean> {
  const { userIds, emails } = await getVisibilityScope(env, user);
  if (art.owner_id && userIds.includes(art.owner_id)) return true;
  if (emails.length) {
    const collab = await env.DB.prepare(
      `SELECT 1 FROM collaborators WHERE artifact_id = ? AND email IN (${placeholders(emails.length)})`,
    ).bind(art.id, ...emails).first();
    if (collab) return true;
  }
  if (art.workspace_id && art.visibility === 'workspace') {
    for (const id of userIds) if (await getInternalWorkspaceRole(env, art.workspace_id, id)) return true;
  }
  return canAccess(env, { userIds, emails }, 'artifact', art.id, 'view');
}
