import type { Env } from './types';
import type { AuthUser } from './api-auth';
import { generateToken, hashToken } from './api-auth';
import { generateId } from './crypto-utils';
import { getInternalWorkspaceRole } from './workspaces';
import { jsonWithApiErrors } from './http/api-error';

function json(data: unknown, status = 200): Response {
  return jsonWithApiErrors(data, status);
}

// Admin must be owner|admin of the workspace, and target must be a member of it
// (prevents minting/revoking tokens for arbitrary platform users).
async function guard(env: Env, workspaceId: string, actorId: string, targetUserId: string): Promise<Response | null> {
  const role = await getInternalWorkspaceRole(env, workspaceId, actorId);
  if (role !== 'owner' && role !== 'admin') {
    return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  }
  const targetRole = await getInternalWorkspaceRole(env, workspaceId, targetUserId);
  if (!targetRole) {
    return json({ error: 'User is not a member of this workspace', code: 'NOT_A_MEMBER' }, 404);
  }
  return null;
}

export async function handleRevokeMemberTokens(
  request: Request,
  env: Env,
  user: AuthUser,
  workspaceId: string,
  targetUserId: string
): Promise<Response> {
  const forbidden = await guard(env, workspaceId, user.id, targetUserId);
  if (forbidden) return forbidden;

  const result = await env.DB.prepare("DELETE FROM tokens WHERE principal_type = 'user' AND principal_id = ?").bind(targetUserId).run();
  return json({ success: true, revoked: result.meta?.changes ?? 0 });
}

export async function handleCreateMemberToken(
  request: Request,
  env: Env,
  user: AuthUser,
  workspaceId: string,
  targetUserId: string
): Promise<Response> {
  const forbidden = await guard(env, workspaceId, user.id, targetUserId);
  if (forbidden) return forbidden;

  const token = generateToken();
  const tokenHash = await hashToken(token);
  await env.DB.prepare("INSERT INTO tokens (id, principal_type, principal_id, user_id, token_hash, name) VALUES (?, 'user', ?, ?, ?, ?)")
    .bind(generateId('tok'), targetUserId, targetUserId, tokenHash, 'admin-issued').run();

  // Plaintext is returned exactly once and never stored.
  return json({ token, user_id: targetUserId, shown_once: true });
}
