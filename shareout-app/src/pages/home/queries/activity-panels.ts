/**
 * Lazy-loaded activity panel queries (views + cross-artifact comments).
 */
import type { Env } from '../../../types';
import type { RecentActivityRow, RecentCommentRow } from '../types';

/** Recent view events across the user's (and linked-account collaborator) artifacts.
 *  Lazy-loaded by the Activity panel, off the home first-paint path. */
export async function queryRecentActivity(
  env: Env,
  user: { id: string; email: string | null },
  workspaceId?: string | null,
): Promise<RecentActivityRow[]> {
  const wsFilter = workspaceId ? ' AND a.workspace_id = ?' : '';
  const binds: unknown[] = [user.email, user.id, user.email];
  if (workspaceId) binds.push(workspaceId);
  const rows = await env.DB.prepare(`
    SELECT a.name as artifact_name, a.slug, ae.event_type, ae.timestamp, ae.country
    FROM analytics_events ae
    JOIN artifacts a ON a.id = ae.artifact_id
    LEFT JOIN collaborators c ON c.artifact_id = a.id AND c.email = ?
    WHERE a.deleted_at IS NULL AND (a.owner_id = ? OR c.email = ?) AND ae.event_type = 'view'${wsFilter}
    ORDER BY ae.timestamp DESC
    LIMIT 6
  `).bind(...binds).all<RecentActivityRow>();
  return rows.results || [];
}

/** Recent comments across the user's (and collaborator) artifacts — the cross-artifact
 *  "what's happening" feed. Lazy-loaded by the Conversations panel. */
export async function queryRecentComments(
  env: Env,
  user: { id: string; email: string | null },
  workspaceId?: string | null,
): Promise<RecentCommentRow[]> {
  const wsFilter = workspaceId ? ' AND a.workspace_id = ?' : '';
  const binds: unknown[] = [user.email, user.id, user.email];
  if (workspaceId) binds.push(workspaceId);
  const rows = await env.DB.prepare(`
    SELECT a.name as artifact_name, a.slug,
           ac.author_name, ac.content, ac.created_at, ac.resolved
    FROM artifact_comments ac
    JOIN artifacts a ON a.id = ac.artifact_id
    LEFT JOIN collaborators c ON c.artifact_id = a.id AND c.email = ?
    WHERE a.deleted_at IS NULL AND (a.owner_id = ? OR c.email = ?)${wsFilter}
    ORDER BY ac.created_at DESC
    LIMIT 8
  `).bind(...binds).all<RecentCommentRow>();
  return rows.results || [];
}
