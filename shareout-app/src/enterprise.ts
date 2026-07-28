import type { Env, WorkspaceRole } from './types';
import type { AuthUser } from './api-auth';
import { getInternalWorkspaceRole } from './workspaces';
import { logAudit } from './audit';
import { getPlatformHostname } from './config/origins';
import { jsonWithApiErrors } from './http/api-error';

const ROLE_HIERARCHY: Record<WorkspaceRole, number> = { owner: 3, admin: 2, member: 1 };

function json(data: unknown, status = 200): Response {
  return jsonWithApiErrors(data, status);
}

export async function handleGetSubdomain(
  env: Env,
  user: AuthUser,
  workspaceId: string
): Promise<Response> {
  const role = await getInternalWorkspaceRole(env, workspaceId, user.id);
  if (!role) {
    return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  }

  const workspace = await env.DB.prepare(
    `SELECT slug, subdomain_enabled FROM workspaces WHERE id = ?`
  ).bind(workspaceId).first<{ slug: string; subdomain_enabled: number }>();

  if (!workspace) {
    return json({ error: 'Workspace not found', code: 'NOT_FOUND' }, 404);
  }

  // `eligible` stays in the response for API compatibility. It used to follow the
  // workspace owner's paid tier, which on a self-hosted instance — where every
  // account reads as free — made custom subdomains permanently unreachable.
  const eligible = true;
  const canManage = ROLE_HIERARCHY[role] >= ROLE_HIERARCHY['admin'];

  return json({
    enabled: workspace.subdomain_enabled === 1,
    subdomain: workspace.subdomain_enabled ? `${workspace.slug}.${getPlatformHostname(env)}` : null,
    workspace_slug: workspace.slug,
    eligible,
    can_manage: canManage,
  });
}

export async function handleEnableSubdomain(
  request: Request,
  env: Env,
  user: AuthUser,
  workspaceId: string
): Promise<Response> {
  const role = await getInternalWorkspaceRole(env, workspaceId, user.id);
  if (!role || ROLE_HIERARCHY[role] < ROLE_HIERARCHY['admin']) {
    return json({ error: 'Admin role required', code: 'ROLE_REQUIRED', required_role: 'admin' }, 403);
  }

  const workspace = await env.DB.prepare(
    `SELECT slug FROM workspaces WHERE id = ?`
  ).bind(workspaceId).first<{ slug: string }>();

  if (!workspace) {
    return json({ error: 'Workspace not found', code: 'NOT_FOUND' }, 404);
  }

  let body: { enabled: boolean };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400);
  }

  const reserved = ['www', 'api', 'app', 'admin', 'cdn', 'static', 'mail', 'assets', 'support', 'help', 'status'];
  if (body.enabled && reserved.includes(workspace.slug)) {
    return json({
      error: 'Subdomain is reserved',
      code: 'SUBDOMAIN_RESERVED',
      reserved,
    }, 409);
  }

  await env.DB.prepare(
    'UPDATE workspaces SET subdomain_enabled = ? WHERE id = ?'
  ).bind(body.enabled ? 1 : 0, workspaceId).run();

  await logAudit(env, {
    workspaceId, actorId: user.id, actorEmail: user.email,
    action: body.enabled ? 'subdomain.enable' : 'subdomain.disable',
    targetType: 'workspace', targetId: workspaceId,
    detail: { subdomain: `${workspace.slug}.${getPlatformHostname(env)}` },
  });

  return json({
    success: true,
    subdomain: body.enabled ? `${workspace.slug}.${getPlatformHostname(env)}` : null,
    workspace_slug: workspace.slug,
    enabled: body.enabled,
  });
}

export async function handleDisableSubdomain(
  env: Env,
  user: AuthUser,
  workspaceId: string
): Promise<Response> {
  const role = await getInternalWorkspaceRole(env, workspaceId, user.id);
  if (!role || ROLE_HIERARCHY[role] < ROLE_HIERARCHY['admin']) {
    return json({ error: 'Admin role required', code: 'ROLE_REQUIRED', required_role: 'admin' }, 403);
  }

  await env.DB.prepare(
    'UPDATE workspaces SET subdomain_enabled = 0 WHERE id = ?'
  ).bind(workspaceId).run();

  await logAudit(env, {
    workspaceId, actorId: user.id, actorEmail: user.email,
    action: 'subdomain.disable', targetType: 'workspace', targetId: workspaceId,
  });

  return json({
    success: true,
    subdomain: null,
    enabled: false,
  });
}
