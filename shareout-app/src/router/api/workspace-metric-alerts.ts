import type { Env, WorkspaceRole } from '../../types';
import type { AuthUser } from '../../api-auth';
import { getInternalWorkspaceRole } from '../../workspaces';
import { getRuleById, evaluateAndDeliver, fetchHistories } from '../../metric-alerts/rules';
import { jsonWithApiErrors } from '../../http/api-error';

function json(data: unknown, status = 200): Response {
  return jsonWithApiErrors(data, status);
}

const ROLE_RANK: Record<WorkspaceRole, number> = { owner: 3, admin: 2, member: 1 };

/** Workspace admins/owners only. Returns a 403 Response when denied, else null. */
async function requireAdmin(env: Env, workspaceId: string, userId: string): Promise<Response | null> {
  const role = await getInternalWorkspaceRole(env, workspaceId, userId);
  if (!role || ROLE_RANK[role] < ROLE_RANK.admin) {
    return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  }
  return null;
}

/** An alert rule whose artifact belongs to the workspace, else null. */
async function ruleInWorkspace(
  env: Env,
  workspaceId: string,
  ruleId: string
): Promise<{ id: string } | null> {
  return env.DB.prepare(
    `SELECT mar.id FROM metric_alert_rules mar
       JOIN artifacts a ON a.id = mar.artifact_id
      WHERE mar.id = ? AND a.workspace_id = ?`
  ).bind(ruleId, workspaceId).first<{ id: string }>();
}

export async function handleListWorkspaceAlerts(
  env: Env,
  user: AuthUser,
  workspaceId: string
): Promise<Response> {
  const forbidden = await requireAdmin(env, workspaceId, user.id);
  if (forbidden) return forbidden;

  const rows = await env.DB.prepare(
    `SELECT mar.id, mar.artifact_id, mar.owner_id, mar.metric_id, mar.name,
            mar.condition_json, mar.schedule, mar.destination_kind, mar.enabled,
            mar.next_run_at, mar.last_evaluated_at, mar.last_value,
            mar.last_triggered_at, mar.last_status, mar.last_error, mar.on_trigger_json, mar.created_at,
            a.name AS artifact_name, COALESCE(d.slug, a.slug) AS artifact_slug,
            u.email AS owner_email, u.name AS owner_name
       FROM metric_alert_rules mar
       JOIN artifacts a ON a.id = mar.artifact_id
       LEFT JOIN deployments d ON d.artifact_id = a.id AND d.channel = 'production'
       LEFT JOIN users u ON u.id = mar.owner_id
      WHERE a.workspace_id = ?
      ORDER BY mar.created_at DESC`
  ).bind(workspaceId).all();

  const histories = await fetchHistories(env, (rows.results || []).map((r) => r.id as string));
  const alerts = (rows.results || []).map((r) => ({
    ...r,
    condition: JSON.parse((r.condition_json as string) || '{}'),
    on_trigger: r.on_trigger_json ? JSON.parse(r.on_trigger_json as string) : null,
    enabled: Boolean(r.enabled as number),
    history: histories[r.id as string] || [],
  }));
  return json({ alerts });
}

export async function handleGetWorkspaceAlertEvents(
  env: Env,
  user: AuthUser,
  workspaceId: string,
  ruleId: string
): Promise<Response> {
  const forbidden = await requireAdmin(env, workspaceId, user.id);
  if (forbidden) return forbidden;

  if (!(await ruleInWorkspace(env, workspaceId, ruleId))) {
    return json({ error: 'Alert not found', code: 'NOT_FOUND' }, 404);
  }
  const result = await env.DB.prepare(
    `SELECT id, evaluated_at, value, matched, delivered, destination_kind, error, message
       FROM metric_alert_runs WHERE rule_id = ? ORDER BY evaluated_at DESC LIMIT 50`
  ).bind(ruleId).all();
  return json({ events: result.results || [] });
}

export async function handleRunWorkspaceAlert(
  env: Env,
  user: AuthUser,
  workspaceId: string,
  ruleId: string
): Promise<Response> {
  const forbidden = await requireAdmin(env, workspaceId, user.id);
  if (forbidden) return forbidden;

  if (!(await ruleInWorkspace(env, workspaceId, ruleId))) {
    return json({ error: 'Alert not found', code: 'NOT_FOUND' }, 404);
  }
  const rule = await getRuleById(env, ruleId);
  if (!rule) return json({ error: 'Alert not found', code: 'NOT_FOUND' }, 404);
  const outcome = await evaluateAndDeliver(env, rule, 'manual');
  return json({ outcome });
}

export async function handleToggleWorkspaceAlert(
  request: Request,
  env: Env,
  user: AuthUser,
  workspaceId: string,
  ruleId: string
): Promise<Response> {
  const forbidden = await requireAdmin(env, workspaceId, user.id);
  if (forbidden) return forbidden;

  if (!(await ruleInWorkspace(env, workspaceId, ruleId))) {
    return json({ error: 'Alert not found', code: 'NOT_FOUND' }, 404);
  }
  let body: { enabled?: boolean } = {};
  try {
    body = (await request.json()) as { enabled?: boolean };
  } catch {
    return json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400);
  }
  const enabled = body.enabled ? 1 : 0;
  await env.DB.prepare("UPDATE metric_alert_rules SET enabled = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
    .bind(enabled, ruleId).run();
  return json({ success: true, enabled: Boolean(enabled) });
}

export async function handleDeleteWorkspaceAlert(
  env: Env,
  user: AuthUser,
  workspaceId: string,
  ruleId: string
): Promise<Response> {
  const forbidden = await requireAdmin(env, workspaceId, user.id);
  if (forbidden) return forbidden;

  if (!(await ruleInWorkspace(env, workspaceId, ruleId))) {
    return json({ error: 'Alert not found', code: 'NOT_FOUND' }, 404);
  }
  await env.DB.prepare('DELETE FROM metric_alert_rules WHERE id = ?').bind(ruleId).run();
  return json({ success: true });
}
