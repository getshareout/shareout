import type { Env } from './types';

// Append-only audit trail for workspace governance actions. logAudit() is
// best-effort and never throws: an audit write must not break the action it
// records. Reads are admin-gated by the callers.

export interface AuditEntry {
  workspaceId?: string | null;
  actorId?: string | null;
  actorEmail?: string | null;
  action: string; // e.g. 'member.remove', 'subdomain.enable'
  targetType?: string | null; // e.g. 'user', 'connection', 'workspace'
  targetId?: string | null;
  detail?: Record<string, unknown> | null;
}

export interface AuditRow {
  id: string;
  workspace_id: string | null;
  actor_id: string | null;
  actor_email: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  detail: string | null;
  created_at: string;
}

export async function logAudit(env: Env, entry: AuditEntry): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO audit_log
         (id, workspace_id, actor_id, actor_email, action, target_type, target_id, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        crypto.randomUUID(),
        entry.workspaceId ?? null,
        entry.actorId ?? null,
        entry.actorEmail ?? null,
        entry.action,
        entry.targetType ?? null,
        entry.targetId ?? null,
        entry.detail ? JSON.stringify(entry.detail) : null
      )
      .run();
  } catch {
    /* best-effort: never let auditing break the audited action */
  }
}

export async function listWorkspaceAuditLog(
  env: Env,
  workspaceId: string,
  limit = 100
): Promise<AuditRow[]> {
  const res = await env.DB.prepare(
    `SELECT id, workspace_id, actor_id, actor_email, action, target_type, target_id, detail, created_at
       FROM audit_log WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?`
  )
    .bind(workspaceId, Math.min(Math.max(limit, 1), 500))
    .all<AuditRow>();
  return res.results ?? [];
}

export interface AdminAuditRow extends AuditRow {
  workspace_name: string | null;
  workspace_slug: string | null;
}

// Platform-wide recent audit entries for the super-admin view.
export async function recentAuditLog(env: Env, limit = 200): Promise<AdminAuditRow[]> {
  const res = await env.DB.prepare(
    `SELECT a.id, a.workspace_id, a.actor_id, a.actor_email, a.action,
            a.target_type, a.target_id, a.detail, a.created_at,
            w.name AS workspace_name, w.slug AS workspace_slug
       FROM audit_log a LEFT JOIN workspaces w ON w.id = a.workspace_id
      ORDER BY a.created_at DESC LIMIT ?`
  )
    .bind(Math.min(Math.max(limit, 1), 500))
    .all<AdminAuditRow>();
  return res.results ?? [];
}

// Trim retained audit entries. Enterprise expectation is a long trail; keep one
// year. Called from the scheduled cleanup alongside observability trimming.
export async function cleanupAuditLog(env: Env): Promise<{ rows: number }> {
  const cutoff = new Date(Date.now() - 365 * 86_400_000).toISOString();
  const r = await env.DB.prepare('DELETE FROM audit_log WHERE created_at < ?').bind(cutoff).run();
  return { rows: r.meta?.changes ?? 0 };
}
