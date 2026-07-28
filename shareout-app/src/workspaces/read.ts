import type { Env, WorkspaceRole } from '../types';
import type { AuthUser } from '../api-auth';
import { json } from './json-response';

interface WorkspaceReadRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  owner_id: string;
  created_at: string;
  updated_at: string | null;
  role: WorkspaceRole;
  artifact_count: number;
  folder_count: number;
  member_count: number;
}

interface Seats {
  used: number;
  limit: number | null; // null = unlimited
  remaining: number | null;
}

// This build has no plans, and nothing ever enforced a seat limit on invite — it was
// only reported. Reporting one told self-hosters they were capped at three members
// on their own instance, so the count is now unlimited and honest.
function seatsFor(row: WorkspaceReadRow): Seats {
  return { used: row.member_count, limit: null, remaining: null };
}

const READ_SELECT = `
    SELECT w.*, wm.role,
      (SELECT COUNT(*) FROM artifacts WHERE workspace_id = w.id) as artifact_count,
      (SELECT COUNT(*) FROM folders WHERE workspace_id = w.id) as folder_count,
      (SELECT COUNT(*) FROM workspace_members WHERE workspace_id = w.id) as member_count
    FROM workspaces w
    JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.user_id = ?`;

export async function handleGetWorkspace(
  request: Request,
  env: Env,
  user: AuthUser,
  workspaceId: string
): Promise<Response> {
  const workspace = await env.DB.prepare(`${READ_SELECT} WHERE w.id = ?`)
    .bind(user.id, workspaceId).first<WorkspaceReadRow>();

  if (!workspace) {
    return json({ error: 'Workspace not found', code: 'NOT_FOUND' }, 404);
  }

  return json({ ...workspace, seats: seatsFor(workspace) });
}

export async function handleGetWorkspaceBySlug(
  request: Request,
  env: Env,
  user: AuthUser,
  slug: string
): Promise<Response> {
  const workspace = await env.DB.prepare(`${READ_SELECT} WHERE w.slug = ?`)
    .bind(user.id, slug).first<WorkspaceReadRow>();

  if (!workspace) {
    return json({ error: 'Workspace not found', code: 'NOT_FOUND' }, 404);
  }

  return json({ ...workspace, seats: seatsFor(workspace) });
}
