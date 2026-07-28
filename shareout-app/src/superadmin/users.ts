import type { Env } from '../types';
import { purgeArtifact } from '../artifacts';
import { isSuperAdminEmail } from './auth';
import { invalidateUserDisabled } from '../auth/session';

export interface UserRow {
  id: string;
  email: string | null;
  name: string | null;
  picture: string | null;
  tier: string;
  inTeamWorkspace: number;
  disabled: number;
  createdAt: string;
  lastLoginAt: string | null;
  artifactCount: number;
  workspaceCount: number;
  tokenCount: number;
}

export interface UserDetail extends UserRow {
  artifacts: Array<{ name: string; slug: string; type: string; visibility: string; createdAt: string }>;
  workspaces: Array<{ name: string; slug: string }>;
  costUsd: number;
  totalTokens: number;
}

const VALID_TIERS = ['free', 'team'];

export async function listUsers(
  env: Env,
  search: string,
  limit = 50,
  offset = 0
): Promise<{ users: UserRow[]; total: number }> {
  const where = search ? 'WHERE u.email LIKE ?1 OR u.name LIKE ?1' : '';
  const like = `%${search}%`;

  const totalStmt = env.DB.prepare(
    `SELECT COUNT(*) AS n FROM users u ${where}`
  );
  const total = (await (search ? totalStmt.bind(like) : totalStmt).first<{ n: number }>())?.n ?? 0;

  const listStmt = env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.picture, u.tier, u.disabled,
            u.created_at AS createdAt, u.last_login_at AS lastLoginAt,
            EXISTS(
              SELECT 1 FROM workspace_members wm
              JOIN workspaces w ON w.id = wm.workspace_id
              JOIN users o ON o.id = w.owner_id
              WHERE wm.user_id = u.id AND o.tier IN ('team', 'enterprise')
            ) AS inTeamWorkspace,
            (SELECT COUNT(*) FROM artifacts a WHERE a.owner_id = u.id) AS artifactCount,
            (SELECT COUNT(*) FROM workspaces w WHERE w.owner_id = u.id) AS workspaceCount,
            (SELECT COUNT(*) FROM tokens t WHERE t.principal_type = 'user' AND t.principal_id = u.id) AS tokenCount
     FROM users u
     ${where}
     ORDER BY u.created_at DESC
     LIMIT ? OFFSET ?`
  );
  const bound = search ? listStmt.bind(like, limit, offset) : listStmt.bind(limit, offset);
  const rows = await bound.all<UserRow>();
  return { users: rows.results || [], total };
}

export async function getUserDetail(env: Env, userId: string): Promise<UserDetail | null> {
  const user = await env.DB.prepare(
    `SELECT id, email, name, picture, tier, disabled,
            created_at AS createdAt, last_login_at AS lastLoginAt,
            EXISTS(
              SELECT 1 FROM workspace_members wm
              JOIN workspaces w ON w.id = wm.workspace_id
              JOIN users o ON o.id = w.owner_id
              WHERE wm.user_id = users.id AND o.tier IN ('team', 'enterprise')
            ) AS inTeamWorkspace
     FROM users WHERE id = ?`
  ).bind(userId).first<Omit<UserRow, 'artifactCount' | 'workspaceCount' | 'tokenCount'>>();
  if (!user) return null;

  const [artifacts, workspaces, tokenCountRow, usage] = await Promise.all([
    env.DB.prepare(
      `SELECT name, slug, artifact_type AS type, visibility, created_at AS createdAt
       FROM artifacts WHERE owner_id = ? ORDER BY created_at DESC LIMIT 100`
    ).bind(userId).all<{ name: string; slug: string; type: string; visibility: string; createdAt: string }>(),
    env.DB.prepare(
      'SELECT name, slug FROM workspaces WHERE owner_id = ? ORDER BY created_at DESC'
    ).bind(userId).all<{ name: string; slug: string }>(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM tokens WHERE principal_type = 'user' AND principal_id = ?").bind(userId).first<{ n: number }>(),
    env.DB.prepare(
      `SELECT COALESCE(SUM(e.base_cost_micro_usd),0) AS cost,
              COALESCE(SUM(e.input_tokens + e.output_tokens),0) AS tokens
       FROM agent_usage_events e
       JOIN workspaces w ON w.id = e.workspace_id
       WHERE w.owner_id = ?`
    ).bind(userId).first<{ cost: number; tokens: number }>(),
  ]);

  return {
    ...user,
    artifactCount: (artifacts.results || []).length,
    workspaceCount: (workspaces.results || []).length,
    tokenCount: tokenCountRow?.n ?? 0,
    artifacts: artifacts.results || [],
    workspaces: workspaces.results || [],
    costUsd: (usage?.cost ?? 0) / 1_000_000,
    totalTokens: usage?.tokens ?? 0,
  };
}

export async function setUserTier(
  env: Env,
  userId: string,
  tier: string
): Promise<{ ok: boolean; error?: string }> {
  if (!VALID_TIERS.includes(tier)) {
    return { ok: false, error: `tier must be one of ${VALID_TIERS.join(', ')}` };
  }
  await env.DB.prepare('UPDATE users SET tier = ? WHERE id = ?').bind(tier, userId).run();
  return { ok: true };
}

// Lock an account out: revoke every API token and flip the disable flag so the
// browser session (a stateless JWT) is rejected by getSessionUser on next request.
export async function revokeUserAccess(
  env: Env,
  userId: string,
  disabled: boolean
): Promise<void> {
  if (disabled) {
    await env.DB.prepare("DELETE FROM tokens WHERE principal_type = 'user' AND principal_id = ?").bind(userId).run();
  }
  await env.DB.prepare('UPDATE users SET disabled = ? WHERE id = ?')
    .bind(disabled ? 1 : 0, userId)
    .run();
  // Drop the cached disable flag so getSessionUser sees the change next request.
  await invalidateUserDisabled(env, userId);
}

export async function deleteUser(
  env: Env,
  userId: string
): Promise<{ ok: boolean; error?: string }> {
  const user = await env.DB.prepare('SELECT id, email FROM users WHERE id = ?')
    .bind(userId)
    .first<{ id: string; email: string | null }>();
  if (!user) return { ok: false, error: 'User not found' };
  if (isSuperAdminEmail(user.email)) {
    return { ok: false, error: 'Cannot delete a platform owner account' };
  }

  // Owned artifacts (with R2 + dependent rows).
  const artifacts = await env.DB.prepare(
    'SELECT id, slug FROM artifacts WHERE owner_id = ?'
  ).bind(userId).all<{ id: string; slug: string }>();
  for (const a of artifacts.results || []) {
    await purgeArtifact(env, a.id, a.slug);
  }

  // Owned workspaces and their children. Detach any remaining artifacts (owned by
  // other users) so they survive rather than being silently orphaned to a dead id.
  const workspaces = await env.DB.prepare(
    'SELECT id FROM workspaces WHERE owner_id = ?'
  ).bind(userId).all<{ id: string }>();
  for (const w of workspaces.results || []) {
    await env.DB.batch([
      env.DB.prepare('UPDATE artifacts SET workspace_id = NULL WHERE workspace_id = ?').bind(w.id),
      env.DB.prepare('DELETE FROM workspace_members WHERE workspace_id = ?').bind(w.id),
      env.DB.prepare('DELETE FROM folders WHERE workspace_id = ?').bind(w.id),
      env.DB.prepare("DELETE FROM connections WHERE scope_type = 'workspace' AND scope_id = ?").bind(w.id),
      env.DB.prepare('DELETE FROM workspace_llm_config WHERE workspace_id = ?').bind(w.id),
      env.DB.prepare('DELETE FROM workspaces WHERE id = ?').bind(w.id),
    ]);
  }

  await env.DB.batch([
    env.DB.prepare('DELETE FROM scheduled_jobs WHERE owner_id = ?').bind(userId),
    env.DB.prepare("DELETE FROM tokens WHERE principal_type = 'user' AND principal_id = ?").bind(userId),
    env.DB.prepare('DELETE FROM admin_sessions WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM workspace_members WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM favorites WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId),
  ]);

  return { ok: true };
}
