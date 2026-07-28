import type { Env, WorkspaceRole } from '../../types';
import type { AuthUser } from '../../api-auth';
import { getInternalWorkspaceRole } from '../../workspaces';
import { executeJobNow, parseCronSchedule, getNextRunTime } from '../../scheduling/jobs';
import type { ScheduledJob } from '../../scheduling/jobs';
import { getCrewById, listRuns } from '../../crew/store';
import { dispatchCrewRun } from '../../crew/triggers';
import { getRunDetail, listWorkspaceRuns, type RunSurface } from '../../runs/inspector';
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

/** A scheduled job whose artifact belongs to the workspace, else null. */
async function jobInWorkspace(env: Env, workspaceId: string, jobId: string): Promise<ScheduledJob | null> {
  return env.DB.prepare(
    `SELECT sj.* FROM scheduled_jobs sj
       JOIN artifacts a ON a.id = sj.artifact_id
      WHERE sj.id = ? AND a.workspace_id = ?`
  ).bind(jobId, workspaceId).first<ScheduledJob>();
}

/** A crew trigger whose artifact belongs to the workspace, else null. */
async function triggerInWorkspace(
  env: Env,
  workspaceId: string,
  triggerId: string
): Promise<{ id: string; crew_id: string; artifact_id: string; enabled: number } | null> {
  return env.DB.prepare(
    `SELECT ct.id, ct.crew_id, ct.artifact_id, ct.enabled FROM crew_triggers ct
       JOIN artifacts a ON a.id = ct.artifact_id
      WHERE ct.id = ? AND a.workspace_id = ?`
  ).bind(triggerId, workspaceId).first<{ id: string; crew_id: string; artifact_id: string; enabled: number }>();
}

// ── Schedules (scheduled_jobs) ──────────────────────────────────────────────

export async function handleListWorkspaceSchedules(
  env: Env,
  user: AuthUser,
  workspaceId: string
): Promise<Response> {
  const forbidden = await requireAdmin(env, workspaceId, user.id);
  if (forbidden) return forbidden;

  const rows = await env.DB.prepare(
    `SELECT sj.id, sj.artifact_id, sj.owner_id, sj.title, sj.description, sj.action, sj.schedule,
            sj.config, sj.trigger_type, sj.event_type, sj.enabled,
            sj.next_run_at, sj.last_run_at, sj.last_status, sj.last_error, sj.created_at,
            a.name AS artifact_name, COALESCE(d.slug, a.slug) AS artifact_slug,
            u.email AS owner_email, u.name AS owner_name
       FROM scheduled_jobs sj
       JOIN artifacts a ON a.id = sj.artifact_id
       LEFT JOIN deployments d ON d.artifact_id = a.id AND d.channel = 'production'
       LEFT JOIN users u ON u.id = sj.owner_id
      WHERE a.workspace_id = ?
      ORDER BY sj.created_at DESC`
  ).bind(workspaceId).all();

  const schedules = (rows.results || []).map((r) => {
    let config: unknown = {};
    try { config = r.config ? JSON.parse(r.config as string) : {}; } catch { config = {}; }
    return { ...r, config, enabled: Boolean(r.enabled as number) };
  });
  return json({ schedules });
}

export async function handleGetWorkspaceScheduleLogs(
  env: Env,
  user: AuthUser,
  workspaceId: string,
  jobId: string
): Promise<Response> {
  const forbidden = await requireAdmin(env, workspaceId, user.id);
  if (forbidden) return forbidden;

  const job = await jobInWorkspace(env, workspaceId, jobId);
  if (!job) return json({ error: 'Schedule not found', code: 'NOT_FOUND' }, 404);

  const result = await env.DB.prepare(
    `SELECT id, created_at, status, duration_ms, error FROM job_runs
      WHERE job_id = ? ORDER BY created_at DESC LIMIT 50`
  ).bind(jobId).all();
  return json({ logs: result.results || [] });
}

export async function handleRunWorkspaceSchedule(
  env: Env,
  user: AuthUser,
  workspaceId: string,
  jobId: string
): Promise<Response> {
  const forbidden = await requireAdmin(env, workspaceId, user.id);
  if (forbidden) return forbidden;

  const job = await jobInWorkspace(env, workspaceId, jobId);
  if (!job) return json({ error: 'Schedule not found', code: 'NOT_FOUND' }, 404);

  const result = await executeJobNow(env, job);
  return json({ result });
}

export async function handleToggleWorkspaceSchedule(
  request: Request,
  env: Env,
  user: AuthUser,
  workspaceId: string,
  jobId: string
): Promise<Response> {
  const forbidden = await requireAdmin(env, workspaceId, user.id);
  if (forbidden) return forbidden;

  const job = await jobInWorkspace(env, workspaceId, jobId);
  if (!job) return json({ error: 'Schedule not found', code: 'NOT_FOUND' }, 404);

  let body: { enabled?: boolean; schedule?: string; title?: string | null; description?: string | null } = {};
  try {
    body = (await request.json()) as { enabled?: boolean; schedule?: string; title?: string | null; description?: string | null };
  } catch {
    return json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400);
  }
  // Cadence edit: validate the cron and recompute the next run (same rules as
  // /v1/jobs updateJob), authorized here by workspace admin instead of ownership.
  if (typeof body.schedule === 'string') {
    const cron = body.schedule.trim();
    const parsed = parseCronSchedule(cron);
    if (!parsed.valid) {
      return json({ error: parsed.error || 'Invalid cron schedule', code: 'INVALID_CRON' }, 400);
    }
    await env.DB.prepare('UPDATE scheduled_jobs SET schedule = ?, next_run_at = ? WHERE id = ?')
      .bind(cron, getNextRunTime(cron), jobId).run();
  }
  if (body.title !== undefined) {
    await env.DB.prepare('UPDATE scheduled_jobs SET title = ? WHERE id = ?')
      .bind(body.title === null ? null : String(body.title).slice(0, 200), jobId).run();
  }
  if (body.description !== undefined) {
    await env.DB.prepare('UPDATE scheduled_jobs SET description = ? WHERE id = ?')
      .bind(body.description === null ? null : String(body.description).slice(0, 1000), jobId).run();
  }
  if (typeof body.enabled === 'boolean') {
    await env.DB.prepare('UPDATE scheduled_jobs SET enabled = ? WHERE id = ?').bind(body.enabled ? 1 : 0, jobId).run();
    return json({ success: true, enabled: body.enabled });
  }
  return json({ success: true });
}

export async function handleDeleteWorkspaceSchedule(
  env: Env,
  user: AuthUser,
  workspaceId: string,
  jobId: string
): Promise<Response> {
  const forbidden = await requireAdmin(env, workspaceId, user.id);
  if (forbidden) return forbidden;

  const job = await jobInWorkspace(env, workspaceId, jobId);
  if (!job) return json({ error: 'Schedule not found', code: 'NOT_FOUND' }, 404);

  await env.DB.prepare('DELETE FROM scheduled_jobs WHERE id = ?').bind(jobId).run();
  return json({ success: true });
}

// ── Automations (crew_triggers) ─────────────────────────────────────────────

export async function handleListWorkspaceAutomations(
  env: Env,
  user: AuthUser,
  workspaceId: string
): Promise<Response> {
  const forbidden = await requireAdmin(env, workspaceId, user.id);
  if (forbidden) return forbidden;

  const rows = await env.DB.prepare(
    `SELECT ct.id, ct.crew_id, ct.artifact_id, ct.kind, ct.cron, ct.event_type,
            ct.enabled, ct.next_run_at, ct.last_run_at, ct.created_at,
            c.name AS crew_name, c.status AS crew_status, c.model AS crew_model,
            c.instructions AS crew_instructions, c.owner_id,
            a.name AS artifact_name, COALESCE(d.slug, a.slug) AS artifact_slug,
            u.email AS owner_email, u.name AS owner_name
       FROM crew_triggers ct
       JOIN crews c ON c.id = ct.crew_id
       JOIN artifacts a ON a.id = ct.artifact_id
       LEFT JOIN deployments d ON d.artifact_id = a.id AND d.channel = 'production'
       LEFT JOIN users u ON u.id = c.owner_id
      WHERE a.workspace_id = ?
      ORDER BY ct.created_at DESC`
  ).bind(workspaceId).all();

  const automations = (rows.results || []).map((r) => ({
    ...r,
    enabled: Boolean(r.enabled as number),
  }));
  return json({ automations });
}

export async function handleGetWorkspaceAutomationRuns(
  env: Env,
  user: AuthUser,
  workspaceId: string,
  triggerId: string
): Promise<Response> {
  const forbidden = await requireAdmin(env, workspaceId, user.id);
  if (forbidden) return forbidden;

  const trigger = await triggerInWorkspace(env, workspaceId, triggerId);
  if (!trigger) return json({ error: 'Automation not found', code: 'NOT_FOUND' }, 404);

  const runs = await listRuns(env, trigger.crew_id);
  return json({ runs });
}

export async function handleRunWorkspaceAutomation(
  env: Env,
  user: AuthUser,
  workspaceId: string,
  triggerId: string
): Promise<Response> {
  const forbidden = await requireAdmin(env, workspaceId, user.id);
  if (forbidden) return forbidden;

  const trigger = await triggerInWorkspace(env, workspaceId, triggerId);
  if (!trigger) return json({ error: 'Automation not found', code: 'NOT_FOUND' }, 404);

  const crew = await getCrewById(env, trigger.crew_id);
  if (!crew) return json({ error: 'Crew not found', code: 'NOT_FOUND' }, 404);

  const dispatched = await dispatchCrewRun(env, crew, 'cron', trigger.id);
  if (!dispatched) {
    return json({ error: 'Could not start run (crew inactive or at concurrency limit)', code: 'NOT_DISPATCHED' }, 409);
  }
  return json({ success: true });
}

export async function handleToggleWorkspaceAutomation(
  request: Request,
  env: Env,
  user: AuthUser,
  workspaceId: string,
  triggerId: string
): Promise<Response> {
  const forbidden = await requireAdmin(env, workspaceId, user.id);
  if (forbidden) return forbidden;

  const trigger = await triggerInWorkspace(env, workspaceId, triggerId);
  if (!trigger) return json({ error: 'Automation not found', code: 'NOT_FOUND' }, 404);

  let body: { enabled?: boolean } = {};
  try {
    body = (await request.json()) as { enabled?: boolean };
  } catch {
    return json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400);
  }
  const enabled = body.enabled ? 1 : 0;
  await env.DB.prepare("UPDATE crew_triggers SET enabled = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
    .bind(enabled, triggerId).run();
  return json({ success: true, enabled: Boolean(enabled) });
}

export async function handleDeleteWorkspaceAutomation(
  env: Env,
  user: AuthUser,
  workspaceId: string,
  triggerId: string
): Promise<Response> {
  const forbidden = await requireAdmin(env, workspaceId, user.id);
  if (forbidden) return forbidden;

  const trigger = await triggerInWorkspace(env, workspaceId, triggerId);
  if (!trigger) return json({ error: 'Automation not found', code: 'NOT_FOUND' }, 404);

  await env.DB.prepare('DELETE FROM crew_triggers WHERE id = ?').bind(triggerId).run();
  return json({ success: true });
}

// ── Run Inspector (unified across crew / job / alert) ────────────────────────

const RUN_SURFACES = new Set(['crew', 'job', 'alert']);

export async function handleListWorkspaceRuns(
  env: Env,
  user: AuthUser,
  workspaceId: string,
  query: URLSearchParams
): Promise<Response> {
  const forbidden = await requireAdmin(env, workspaceId, user.id);
  if (forbidden) return forbidden;

  const surfaceParam = query.get('surface') || undefined;
  if (surfaceParam && !RUN_SURFACES.has(surfaceParam)) {
    return json({ error: 'Invalid surface', code: 'INVALID_SURFACE' }, 400);
  }
  const statusParam = query.get('status');
  const status = statusParam === 'success' || statusParam === 'failed' ? statusParam : undefined;
  const limit = Number(query.get('limit')) || undefined;

  const runs = await listWorkspaceRuns(env, workspaceId, {
    surface: surfaceParam as RunSurface | undefined,
    status,
    limit,
  });
  return json({ runs });
}

export async function handleGetWorkspaceRun(
  env: Env,
  user: AuthUser,
  workspaceId: string,
  surface: string,
  runId: string
): Promise<Response> {
  const forbidden = await requireAdmin(env, workspaceId, user.id);
  if (forbidden) return forbidden;

  if (!RUN_SURFACES.has(surface)) {
    return json({ error: 'Invalid surface', code: 'INVALID_SURFACE' }, 400);
  }
  const run = await getRunDetail(env, workspaceId, surface as RunSurface, runId);
  if (!run) return json({ error: 'Run not found', code: 'NOT_FOUND' }, 404);
  return json({ run });
}
