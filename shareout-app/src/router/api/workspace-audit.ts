import type { Env } from '../../types';
import type { AuthUser } from '../../api-auth';
import { requireWorkspaceRole } from '../../workspaces';
import { listWorkspaceAuditLog } from '../../audit';
import { jsonWithApiErrors } from '../../http/api-error';

function json(data: unknown, status = 200): Response {
  return jsonWithApiErrors(data, status);
}

// GET /v1/workspaces/{id}/audit — admin-only governance trail for the workspace.
export async function handleGetWorkspaceAudit(
  request: Request,
  env: Env,
  user: AuthUser,
  workspaceId: string
): Promise<Response> {
  const forbidden = await requireWorkspaceRole(env, workspaceId, user.id, 'admin');
  if (forbidden) return forbidden;

  const url = new URL(request.url);
  const limit = parseInt(url.searchParams.get('limit') || '100', 10) || 100;
  const rows = await listWorkspaceAuditLog(env, workspaceId, limit);

  const entries = rows.map((r) => ({
    id: r.id,
    ts: r.created_at,
    actor_id: r.actor_id,
    actor_email: r.actor_email,
    action: r.action,
    target_type: r.target_type,
    target_id: r.target_id,
    detail: r.detail ? safeParse(r.detail) : null,
  }));

  return json({ entries });
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
