// External-sharing spine (work/030) — Phase 3. Scoped external API tokens.
// An admin mints an `sot_` token bound to a Sharee member. The token authenticates AS
// that external user; resolveServiceToken stamps service.externalUserId so every data
// read/write resolves through `grants` (not workspace role). Action scopes are limited
// to read/data — externals never get artifacts:publish (they author via the Phase 2
// session fence, not a blanket token).
import type { Env } from '../types';
import type { AuthUser, ServiceScope } from '../api-auth';
import { generateServiceToken, hashToken } from '../api-auth';
import { json } from '../workspaces/json-response';
import { generateId } from '../crypto-utils';
import { logAudit } from '../audit';
import { requireExternalSharing } from './guard';

const EXTERNAL_SCOPES: ServiceScope[] = ['artifacts:read', 'data:read', 'data:write'];

// The target must be an active/invited member of THIS sharee (so an admin can't mint a
// token for an arbitrary platform user). Returns the user_id, or null.
async function shareeMemberUserId(
  env: Env, workspaceId: string, shareeId: string, memberUserId: string,
): Promise<string | null> {
  const row = await env.DB.prepare(`
    SELECT sm.user_id AS uid
      FROM sharee_members sm
      JOIN sharees s ON s.id = sm.sharee_id
     WHERE s.workspace_id = ? AND sm.sharee_id = ? AND sm.user_id = ? AND sm.status != 'removed'
  `).bind(workspaceId, shareeId, memberUserId).first<{ uid: string }>();
  return row?.uid ?? null;
}

function parseScopes(input: unknown): ServiceScope[] {
  if (!Array.isArray(input)) return ['data:read'];
  const set = input.filter((s): s is ServiceScope => EXTERNAL_SCOPES.includes(s as ServiceScope));
  return set.length ? set : ['data:read'];
}

export async function handleListExternalTokens(
  request: Request, env: Env, user: AuthUser,
  workspaceId: string, shareeId: string, memberUserId: string,
): Promise<Response> {
  const forbidden = await requireExternalSharing(env, workspaceId, user.id);
  if (forbidden) return forbidden;
  if (!(await shareeMemberUserId(env, workspaceId, shareeId, memberUserId)))
    return json({ error: 'Not a member of this sharee', code: 'NOT_FOUND' }, 404);

  const { results } = await env.DB.prepare(`
    SELECT id, name, scopes, created_at, last_used_at, expires_at, revoked_at
      FROM tokens
     WHERE principal_type = 'workspace' AND principal_id = ? AND subject_external_user_id = ?
     ORDER BY created_at DESC
  `).bind(workspaceId, memberUserId).all();
  return json({ tokens: results || [] });
}

export async function handleCreateExternalToken(
  request: Request, env: Env, user: AuthUser,
  workspaceId: string, shareeId: string, memberUserId: string,
): Promise<Response> {
  const forbidden = await requireExternalSharing(env, workspaceId, user.id);
  if (forbidden) return forbidden;
  if (!(await shareeMemberUserId(env, workspaceId, shareeId, memberUserId)))
    return json({ error: 'Not a member of this sharee', code: 'NOT_FOUND' }, 404);

  let body: { name?: string; scopes?: unknown; expires_at?: string | null };
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400); }

  const token = generateServiceToken();
  const tokenHash = await hashToken(token);
  const id = generateId('sot');
  await env.DB.prepare(`
    INSERT INTO tokens
      (id, principal_type, principal_id, user_id, token_hash, name, scopes, created_by, expires_at, subject_external_user_id)
    VALUES (?, 'workspace', ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, workspaceId, memberUserId, tokenHash,
    (body.name || 'external-access').trim(),
    parseScopes(body.scopes).join(','), user.id,
    body.expires_at ?? null, memberUserId,
  ).run();

  await logAudit(env, {
    workspaceId, actorId: user.id, action: 'sharee.token.create',
    targetType: 'sharee', targetId: shareeId,
  }).catch(() => {});

  // Plaintext shown exactly once, never stored.
  return json({ token, id, shown_once: true }, 201);
}

export async function handleRevokeExternalToken(
  request: Request, env: Env, user: AuthUser,
  workspaceId: string, shareeId: string, memberUserId: string, tokenId: string,
): Promise<Response> {
  const forbidden = await requireExternalSharing(env, workspaceId, user.id);
  if (forbidden) return forbidden;

  // Scope the revoke to a token that actually belongs to this external member.
  const result = await env.DB.prepare(`
    UPDATE tokens SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id = ? AND principal_type = 'workspace' AND principal_id = ? AND subject_external_user_id = ? AND revoked_at IS NULL
  `).bind(tokenId, workspaceId, memberUserId).run();
  if (!result.meta?.changes) return json({ error: 'Not found', code: 'NOT_FOUND' }, 404);

  await logAudit(env, {
    workspaceId, actorId: user.id, action: 'sharee.token.revoke',
    targetType: 'sharee', targetId: shareeId,
  }).catch(() => {});
  return json({ success: true });
}
