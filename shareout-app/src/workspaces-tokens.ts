import type { Env } from './types';
import type { AuthUser } from './api-auth';
import { generateToken, hashToken } from './api-auth';
import { generateId } from './crypto-utils';
import { getInternalWorkspaceRole } from './workspaces/roles';
import { jsonWithApiErrors } from './http/api-error';
import { evictReturnedTokens } from './auth/token-cache';

function json(data: unknown, status = 200): Response {
  return jsonWithApiErrors(data, status);
}

const RANK: Record<string, number> = { owner: 3, admin: 2, member: 1 };

// Admin must be owner|admin of the workspace, and target must be a member of it
// (prevents minting/revoking tokens for arbitrary platform users). Returns the
// target's role on success.
async function guard(env: Env, workspaceId: string, actorId: string, targetUserId: string): Promise<{ error: Response } | { actorRole: string; targetRole: string }> {
  const role = await getInternalWorkspaceRole(env, workspaceId, actorId);
  if (role !== 'owner' && role !== 'admin') {
    return { error: json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403) };
  }
  const targetRole = await getInternalWorkspaceRole(env, workspaceId, targetUserId);
  if (!targetRole) {
    return { error: json({ error: 'User is not a member of this workspace', code: 'NOT_A_MEMBER' }, 404) };
  }
  return { actorRole: role, targetRole };
}

export async function handleRevokeMemberTokens(
  request: Request,
  env: Env,
  user: AuthUser,
  workspaceId: string,
  targetUserId: string
): Promise<Response> {
  const checked = await guard(env, workspaceId, user.id, targetUserId);
  if ('error' in checked) return checked.error;
  // Personal tokens are account-wide, so an admin may only revoke them for members who
  // do not outrank them, and never for the workspace owner.
  if (targetUserId !== user.id && (checked.targetRole === 'owner' || RANK[checked.targetRole] > RANK[checked.actorRole])) {
    return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  }

  const [, result] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE oauth_grants SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), access_token_id = NULL
        WHERE user_id = ? AND revoked_at IS NULL`,
    ).bind(targetUserId),
    env.DB.prepare("DELETE FROM tokens WHERE principal_type = 'user' AND principal_id = ? RETURNING token_hash").bind(targetUserId),
  ]);
  await evictReturnedTokens(env, result);
  return json({ success: true, revoked: result.meta?.changes ?? 0 });
}

export async function handleCreateMemberToken(
  request: Request,
  env: Env,
  user: AuthUser,
  workspaceId: string,
  targetUserId: string
): Promise<Response> {
  const checked = await guard(env, workspaceId, user.id, targetUserId);
  if ('error' in checked) return checked.error;
  // A personal token acts as its owner everywhere, so admins may only mint one for a
  // service account, never for a person.
  const target = await env.DB.prepare('SELECT is_service FROM users WHERE id = ?')
    .bind(targetUserId).first<{ is_service: number }>();
  if (!target?.is_service) {
    return json({
      error: 'Tokens for people are created by the person themselves',
      code: 'FORBIDDEN',
      hint: 'Ask the member to create their own token, or mint a workspace Agent token (POST /v1/workspaces/{id}/agent-tokens).',
    }, 403);
  }

  const token = generateToken();
  const tokenHash = await hashToken(token);
  await env.DB.prepare("INSERT INTO tokens (id, principal_type, principal_id, user_id, token_hash, name) VALUES (?, 'user', ?, ?, ?, ?)")
    .bind(generateId('tok'), targetUserId, targetUserId, tokenHash, 'admin-issued').run();

  // Plaintext is returned exactly once and never stored.
  return json({ token, user_id: targetUserId, shown_once: true });
}
