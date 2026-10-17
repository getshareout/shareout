import { TELEGRAM_PERSONAL_WORKSPACE } from '../chat-agent/access';
import type { WorkspaceSelection } from '../chat-platforms/types';

/**
 * Visibility as SQL subqueries, so a search query carries its own access check and every
 * query of a search runs in one D1 wave. Without this, search first loaded the user's
 * linked accounts, then their workspaces, then the candidates: three sequential round
 * trips. The rules are the ones getBotVisibilityScope + listWorkspacesForUser apply.
 */

export interface SqlPart { sql: string; binds: unknown[] }

/** The user plus every enabled account sharing its non-NULL identity_id. Binds: userId twice. */
const LINKED_IDS = `(SELECT ? UNION SELECT id FROM users WHERE identity_id IS NOT NULL AND identity_id = (SELECT identity_id FROM users WHERE id = ?) AND COALESCE(disabled, 0) = 0)`;

export function linkedIds(userId: string): SqlPart {
  return { sql: LINKED_IDS, binds: [userId, userId] };
}

function linkedEmails(userId: string): SqlPart {
  const ids = linkedIds(userId);
  return { sql: `(SELECT email FROM users WHERE email IS NOT NULL AND id IN ${ids.sql})`, binds: ids.binds };
}

/** EXISTS: one of the user's accounts is an internal member of `workspaceId`. */
export function isMemberSql(userId: string, workspaceId: string): SqlPart {
  const ids = linkedIds(userId);
  return {
    sql: `EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = ? AND wm.member_class = 'internal' AND wm.user_id IN ${ids.sql})`,
    binds: [workspaceId, ...ids.binds],
  };
}

/** Workspace ids the user is an internal member of. */
export function memberWorkspacesSql(userId: string): SqlPart {
  const ids = linkedIds(userId);
  return {
    sql: `(SELECT wm.workspace_id FROM workspace_members wm WHERE wm.member_class = 'internal' AND wm.user_id IN ${ids.sql})`,
    binds: ids.binds,
  };
}

/**
 * WHERE fragment over `artifacts a`: the artifacts this user may find in search for a
 * workspace selection (a workspace id, the personal scope, or everything when unset).
 */
export function artifactScopeSql(userId: string, sel: WorkspaceSelection | undefined): SqlPart {
  const ids = linkedIds(userId);
  const emails = linkedEmails(userId);
  const mine = {
    sql: `(a.owner_id IN ${ids.sql} OR EXISTS (SELECT 1 FROM collaborators c WHERE c.artifact_id = a.id AND c.email IN ${emails.sql}))`,
    binds: [...ids.binds, ...emails.binds],
  };
  if (sel === TELEGRAM_PERSONAL_WORKSPACE) {
    return { sql: `a.workspace_id IS NULL AND ${mine.sql}`, binds: mine.binds };
  }
  if (typeof sel === 'string' && sel) {
    const member = isMemberSql(userId, sel);
    return {
      sql: `a.workspace_id = ? AND ${member.sql} AND (a.visibility != 'private' OR ${mine.sql})`,
      binds: [sel, ...member.binds, ...mine.binds],
    };
  }
  const wsIds = memberWorkspacesSql(userId);
  return {
    sql: `(${mine.sql} OR (a.visibility = 'workspace' AND a.workspace_id IN ${wsIds.sql}))`,
    binds: [...mine.binds, ...wsIds.binds],
  };
}

/** A concrete workspace id from a selection, or null for personal / everything. */
export function concreteWorkspace(sel: WorkspaceSelection | undefined): string | null {
  return typeof sel === 'string' && sel && sel !== TELEGRAM_PERSONAL_WORKSPACE ? sel : null;
}
