import type { Env } from '../../types';
import type { AuthUser } from '../../api-auth';
import { requireWorkspaceRole } from '../../workspaces';
import { logAudit } from '../../audit';
import { jsonWithApiErrors } from '../../http/api-error';

// Per-workspace session lifetime. NULL session_max_days = inherit the 30-day
// platform default. The effective lifetime at login is the strictest policy
// across a user's workspaces (see resolveSessionMaxAge in auth.ts).
//
// Workspace admins manage this. It used to be gated on the workspace owner's paid
// tier, which on a self-hosted instance — where every account reads as free — made
// a documented security control unreachable. `eligible` stays in the response for
// API compatibility and is always true.
const PLATFORM_DEFAULT_DAYS = 30;
const MAX_DAYS = 30; // can only tighten below the platform default, never extend
const MIN_DAYS = 1;

function json(data: unknown, status = 200): Response {
  return jsonWithApiErrors(data, status);
}

export async function handleGetWorkspaceSessionPolicy(
  env: Env,
  user: AuthUser,
  workspaceId: string
): Promise<Response> {
  const forbidden = await requireWorkspaceRole(env, workspaceId, user.id, 'member');
  if (forbidden) return forbidden;

  const row = await env.DB.prepare(
    `SELECT session_max_days FROM workspaces WHERE id = ?`
  ).bind(workspaceId).first<{ session_max_days: number | null }>();
  if (!row) return json({ error: 'Workspace not found', code: 'NOT_FOUND' }, 404);

  return json({
    session_max_days: row.session_max_days,
    platform_default_days: PLATFORM_DEFAULT_DAYS,
    eligible: true,
  });
}

export async function handleSetWorkspaceSessionPolicy(
  request: Request,
  env: Env,
  user: AuthUser,
  workspaceId: string
): Promise<Response> {
  const forbidden = await requireWorkspaceRole(env, workspaceId, user.id, 'admin');
  if (forbidden) return forbidden;

  const ws = await env.DB.prepare(
    `SELECT id FROM workspaces WHERE id = ?`
  ).bind(workspaceId).first<{ id: string }>();
  if (!ws) return json({ error: 'Workspace not found', code: 'NOT_FOUND' }, 404);

  let body: { session_max_days?: number | null };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400);
  }

  let value: number | null;
  if (body.session_max_days === null || body.session_max_days === undefined) {
    value = null; // clear → inherit platform default
  } else if (
    typeof body.session_max_days !== 'number' ||
    !Number.isInteger(body.session_max_days) ||
    body.session_max_days < MIN_DAYS ||
    body.session_max_days > MAX_DAYS
  ) {
    return json(
      { error: `session_max_days must be an integer ${MIN_DAYS}-${MAX_DAYS}, or null to inherit`, code: 'VALIDATION_ERROR' },
      400
    );
  } else {
    value = body.session_max_days;
  }

  await env.DB.prepare(
    "UPDATE workspaces SET session_max_days = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?"
  ).bind(value, workspaceId).run();

  await logAudit(env, {
    workspaceId, actorId: user.id, actorEmail: user.email,
    action: 'session_policy.update', targetType: 'workspace', targetId: workspaceId,
    detail: { session_max_days: value },
  });

  return json({ session_max_days: value, platform_default_days: PLATFORM_DEFAULT_DAYS });
}
