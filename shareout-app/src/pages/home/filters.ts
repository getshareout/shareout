/**
 * URL filter parsing and SQL scope builders for the home artifact grid.
 */
import type { Env } from '../../types';
import { placeholders, type VisibilityScope } from '../../account-links';
import type { HomeFilters } from './types';
import { TYPE_GROUPS } from './constants';

export function artifactTypeGroup(artifactType: string): string {
  for (const [group, types] of Object.entries(TYPE_GROUPS)) {
    if (types.includes(artifactType)) return group;
  }
  return 'other';
}

export function parseHomeFilters(url: URL): HomeFilters {
  const dir = url.searchParams.get('dir');
  return {
    page: Math.max(1, parseInt(url.searchParams.get('page') || '1', 10)),
    search: url.searchParams.get('q')?.trim() || '',
    sort: url.searchParams.get('sort') || 'recent',
    dir: dir === 'asc' || dir === 'desc' ? dir : undefined,
    type: url.searchParams.get('type') || '',
    scope: url.searchParams.get('scope') || 'all',
    workspace: url.searchParams.get('workspace')?.trim() || '',
    folder: url.searchParams.get('folder')?.trim() || '',
    filesScope: url.searchParams.get('files') === 'personal' ? 'personal' : 'team',
    folderKind: url.searchParams.get('folderKind') === 'personal' ? 'personal'
      : url.searchParams.get('folderKind') === 'team' ? 'team' : '',
    level: url.searchParams.get('level') === '1',
    favFirst: url.searchParams.get('favfirst') === '1',
  };
}

/**
 * Base FROM/WHERE for the home grid, expanded across all linked accounts.
 * - No workspace ("Personal"): only artifacts with no workspace that the person owns or collaborates on (any linked id/email).
 * - Workspace selected (and a member): workspace-visible artifacts (any owner) plus the viewer's own private ones — other members' private artifacts stay hidden.
 * The collaborators LEFT JOIN stays for the role badge; GROUP BY a.id dedupes rows
 * that match more than one linked email.
 */
export function homeScopeSql(scope: VisibilityScope, workspaceId: string | null): {
  join: string;
  joinParams: unknown[];
  where: string;
  whereParams: unknown[];
} {
  const emailPh = placeholders(scope.emails.length);
  const idPh = placeholders(scope.userIds.length);
  const join = `LEFT JOIN collaborators c ON c.artifact_id = a.id AND c.email IN (${emailPh})`;
  const joinParams = [...scope.emails];
  // The hidden asset-library bucket is an artifact, never a page — keep it out of
  // every home listing.
  const notBucket = 'a.id NOT IN (SELECT artifact_id FROM asset_buckets)';
  if (workspaceId) {
    return {
      join,
      joinParams,
      where: `a.deleted_at IS NULL AND ${notBucket} AND a.workspace_id = ? AND (a.visibility != 'private' OR a.owner_id IN (${idPh}) OR c.email IN (${emailPh}))`,
      whereParams: [workspaceId, ...scope.userIds, ...scope.emails],
    };
  }
  return {
    join,
    joinParams,
    where: `a.deleted_at IS NULL AND ${notBucket} AND a.workspace_id IS NULL AND (a.owner_id IN (${idPh}) OR c.email IN (${emailPh}))`,
    whereParams: [...scope.userIds, ...scope.emails],
  };
}

/** Membership rows for one of the caller's linked accounts. Binds: workspaceId, then userIds. */
function linkedMemberRows(scope: VisibilityScope): string {
  return `SELECT 1 FROM workspace_members WHERE workspace_id = ? AND member_class = 'internal' AND user_id IN (${placeholders(scope.userIds.length)})`;
}

/** True when one of the caller's linked accounts is an internal member of the workspace. */
export async function isLinkedWorkspaceMember(env: Env, scope: VisibilityScope, workspaceId: string): Promise<boolean> {
  const row = await env.DB.prepare(`${linkedMemberRows(scope)} LIMIT 1`).bind(workspaceId, ...scope.userIds).first();
  return !!row;
}

/** isLinkedWorkspaceMember as a WHERE condition, so a query carries its own membership
 *  check instead of waiting on a separate round trip. */
export function linkedWorkspaceMemberSql(scope: VisibilityScope, workspaceId: string): { sql: string; binds: unknown[] } {
  return { sql: `EXISTS (${linkedMemberRows(scope)})`, binds: [workspaceId, ...scope.userIds] };
}
