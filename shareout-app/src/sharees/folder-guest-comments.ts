// Guest comments for a whole folder: every artifact inside it (and its subfolders) that
// has no setting of its own lets people with no account comment after an email code —
// still only where they can already view the page. Reading the setting needs an internal
// member; changing it needs the folder's manager (the same gate as sharing it).
import type { Env } from '../types';
import type { AuthUser } from '../api-auth';
import { json } from '../workspaces/json-response';
import { getInternalWorkspaceRole } from '../workspaces/roles';
import { requireFolderManager } from '../folders';
import { logAudit } from '../audit';

async function readEnabled(env: Env, workspaceId: string, folderId: string): Promise<boolean | null> {
  const row = await env.DB.prepare('SELECT guest_comments_enabled AS g FROM folders WHERE id = ? AND workspace_id = ?')
    .bind(folderId, workspaceId).first<{ g: number }>();
  return row ? row.g === 1 : null;
}

/** Set the folder's guest-comments switch. Domain function shared by REST and MCP. */
export async function setFolderGuestComments(
  env: Env, user: AuthUser, workspaceId: string, folderId: string, enabled: boolean,
): Promise<Response> {
  const forbidden = await requireFolderManager(env, user, workspaceId, folderId);
  if (forbidden) return forbidden;
  await env.DB.prepare('UPDATE folders SET guest_comments_enabled = ?, updated_at = ? WHERE id = ? AND workspace_id = ?')
    .bind(enabled ? 1 : 0, new Date().toISOString(), folderId, workspaceId).run();
  await logAudit(env, {
    workspaceId, actorId: user.id, action: enabled ? 'folder.guest_comments.on' : 'folder.guest_comments.off',
    targetType: 'folder', targetId: folderId,
  }).catch(() => {});
  return json({ folder_id: folderId, guest_comments: enabled });
}

/** GET|PUT /v1/workspaces/{ws}/folders/{folder}/guest-comments — `{ enabled: boolean }`. */
export async function handleFolderGuestComments(
  request: Request, env: Env, user: AuthUser, workspaceId: string, folderId: string,
): Promise<Response> {
  if (request.method === 'GET') {
    if (!(await getInternalWorkspaceRole(env, workspaceId, user.id))) return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
    const enabled = await readEnabled(env, workspaceId, folderId);
    if (enabled === null) return json({ error: 'Folder not found', code: 'NOT_FOUND' }, 404);
    return json({ folder_id: folderId, guest_comments: enabled });
  }
  if (request.method !== 'PUT') return json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' }, 405);
  const body = await request.json().catch(() => null) as { enabled?: unknown } | null;
  if (!body || typeof body.enabled !== 'boolean') {
    return json({ error: 'enabled (boolean) is required', code: 'VALIDATION_ERROR', param: 'enabled' }, 400);
  }
  return setFolderGuestComments(env, user, workspaceId, folderId, body.enabled);
}
