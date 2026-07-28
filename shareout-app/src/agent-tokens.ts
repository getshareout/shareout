import type { Env } from './types';
import type { AuthUser, ServiceScope } from './api-auth';
import { generateServiceToken, hashToken, SERVICE_SCOPES } from './api-auth';
import { generateId } from './crypto-utils';
import { getInternalWorkspaceRole, invalidateWorkspaceRole } from './workspaces';
import { logAudit } from './audit';
import { jsonWithApiErrors } from './http/api-error';

function json(data: unknown, status = 200): Response {
  return jsonWithApiErrors(data, status);
}

// Mint/list/revoke require owner|admin of the workspace.
async function requireAdmin(env: Env, workspaceId: string, actorId: string): Promise<Response | null> {
  const role = await getInternalWorkspaceRole(env, workspaceId, actorId);
  if (role !== 'owner' && role !== 'admin') {
    return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  }
  return null;
}

function parseScopes(input: unknown): ServiceScope[] | null {
  if (!Array.isArray(input) || input.length === 0) return null;
  const out: ServiceScope[] = [];
  for (const raw of input) {
    const s = String(raw).trim();
    if (!(SERVICE_SCOPES as string[]).includes(s)) return null;
    if (!out.includes(s as ServiceScope)) out.push(s as ServiceScope);
  }
  return out;
}

// Lists the workspace's Agent identities and their tokens (metadata only — plaintext
// is never recoverable). Grouped is overkill for v1; flat token list with principal.
export async function handleListAgentTokens(
  request: Request,
  env: Env,
  user: AuthUser,
  workspaceId: string
): Promise<Response> {
  const forbidden = await requireAdmin(env, workspaceId, user.id);
  if (forbidden) return forbidden;

  const { results } = await env.DB.prepare(`
    SELECT t.id, t.name, t.scopes, t.user_id AS principal_user_id, t.created_at, t.last_used_at,
           t.expires_at, t.revoked_at
    FROM tokens t
    WHERE t.principal_type = 'workspace' AND t.principal_id = ?
    ORDER BY t.created_at DESC
  `).bind(workspaceId).all();

  const tokens = (results || []).map((r) => ({
    ...r,
    scopes: String(r.scopes || '').split(',').filter(Boolean),
    revoked: r.revoked_at != null,
  }));
  return json({ ok: true, count: tokens.length, tokens });
}

// Mints an Agent token. Creates a fresh service principal (a headless is_service=1
// user) and adds it as a workspace member, so it owns its artifacts and shows up
// in the members/activity surfaces. Plaintext token returned exactly once.
export async function handleCreateAgentToken(
  request: Request,
  env: Env,
  user: AuthUser,
  workspaceId: string
): Promise<Response> {
  const forbidden = await requireAdmin(env, workspaceId, user.id);
  if (forbidden) return forbidden;

  let body: { name?: string; scopes?: unknown; expires_at?: string | null };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400);
  }

  const name = (body.name || '').trim();
  if (!name) return json({ error: 'name is required', code: 'VALIDATION_ERROR' }, 400);

  const scopes = parseScopes(body.scopes);
  if (!scopes) {
    return json({
      error: `scopes must be a non-empty subset of: ${SERVICE_SCOPES.join(', ')}`,
      code: 'INVALID_SCOPES',
    }, 400);
  }

  const expiresAt = typeof body.expires_at === 'string' && body.expires_at ? body.expires_at : null;

  // Create the service principal + its workspace membership.
  const principalId = generateId('usr');
  await env.DB.prepare(
    "INSERT INTO users (id, email, name, is_service) VALUES (?, NULL, ?, 1)"
  ).bind(principalId, name).run();
  await env.DB.prepare(
    'INSERT INTO workspace_members (id, workspace_id, user_id, role, invited_by) VALUES (?, ?, ?, ?, ?)'
  ).bind(generateId('wsm'), workspaceId, principalId, 'member', user.id).run();
  await invalidateWorkspaceRole(env, workspaceId, principalId);

  const token = generateServiceToken();
  const tokenHash = await hashToken(token);
  const tokenId = generateId('sot');
  await env.DB.prepare(`
    INSERT INTO tokens (id, principal_type, principal_id, user_id, token_hash, name, scopes, created_by, expires_at)
    VALUES (?, 'workspace', ?, ?, ?, ?, ?, ?, ?)
  `).bind(tokenId, workspaceId, principalId, tokenHash, name, scopes.join(','), user.id, expiresAt).run();

  await logAudit(env, {
    workspaceId, actorId: user.id, actorEmail: user.email,
    action: 'agent_token.create', targetType: 'user', targetId: principalId,
    detail: { name, scopes, token_id: tokenId },
  });

  return json({
    ok: true,
    token,
    shown_once: true,
    token_id: tokenId,
    principal_user_id: principalId,
    scopes,
  }, 201);
}

// Revokes a single token (soft — sets revoked_at). The Agent principal stays a member
// so its existing artifacts keep their owner; mint a new token to re-enable it.
export async function handleRevokeAgentToken(
  request: Request,
  env: Env,
  user: AuthUser,
  workspaceId: string,
  tokenId: string
): Promise<Response> {
  const forbidden = await requireAdmin(env, workspaceId, user.id);
  if (forbidden) return forbidden;

  const result = await env.DB.prepare(
    "UPDATE tokens SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND principal_type = 'workspace' AND principal_id = ? AND revoked_at IS NULL"
  ).bind(tokenId, workspaceId).run();

  const revoked = result.meta?.changes ?? 0;
  if (!revoked) return json({ error: 'Token not found', code: 'NOT_FOUND' }, 404);

  await logAudit(env, {
    workspaceId, actorId: user.id, actorEmail: user.email,
    action: 'agent_token.revoke', targetType: 'token', targetId: tokenId,
  });

  return json({ ok: true, revoked });
}
