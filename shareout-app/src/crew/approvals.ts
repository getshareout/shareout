import type { Env } from '../types';
import { generateId } from '../crypto-utils';
import { dispatchLifecycleEmail } from '../email/gateway';
import { CREW_TOOLS } from './tool-registry';
import { getCrewById } from './store';
import { buildOwnerDataContextForCrew } from './principal';
import type { CrewApprovalRow } from './types';

/** Best-effort owner email: "N actions awaiting approval — review in ShareOut." */
export async function notifyOwnerPendingApprovals(env: Env, artifactId: string, count: number): Promise<void> {
  try {
    const owner = await env.DB.prepare(
      'SELECT u.id AS id, u.email AS email FROM artifacts a LEFT JOIN users u ON u.id = a.owner_id WHERE a.id = ?'
    )
      .bind(artifactId)
      .first<{ id: string | null; email: string | null }>();
    if (!owner?.email) return;
    await dispatchLifecycleEmail(env, {
      type: 'crew_approval',
      toUserId: owner.id ?? undefined,
      toEmail: owner.email,
      data: { count },
    });
  } catch {
    // Notification is best-effort; never break the run.
  }
}

export async function createApproval(
  env: Env,
  params: { crewId: string; runId: string; artifactId: string; toolName: string; input: unknown }
): Promise<CrewApprovalRow> {
  const id = generateId('appr');
  await env.DB.prepare(
    `INSERT INTO crew_action_approvals (id, crew_id, run_id, artifact_id, tool_name, input_json, status)
     VALUES (?, ?, ?, ?, ?, ?, 'pending')`
  )
    .bind(id, params.crewId, params.runId, params.artifactId, params.toolName, JSON.stringify(params.input ?? {}))
    .run();
  const row = await env.DB.prepare('SELECT * FROM crew_action_approvals WHERE id = ?').bind(id).first<CrewApprovalRow>();
  if (!row) throw new Error('failed to load approval after create');
  return row;
}

// Pending approvals the owner never acts on would otherwise sit forever (and a
// stale one could be approved months later against drifted data). Expire them so
// approveAndExecute's status='pending' guard can no longer replay them.
const STALE_APPROVAL_DAYS = 7;

/** Expire pending approvals older than the staleness window. Returns rows expired. */
export async function reapStaleApprovals(env: Env): Promise<number> {
  const r = await env.DB.prepare(
    `UPDATE crew_action_approvals SET status = 'expired'
       WHERE status = 'pending' AND created_at < strftime('%Y-%m-%dT%H:%M:%fZ','now', '-' || ? || ' days')`
  )
    .bind(STALE_APPROVAL_DAYS)
    .run();
  return r.meta.changes || 0;
}

export async function listApprovals(
  env: Env,
  artifactId: string,
  status?: string
): Promise<CrewApprovalRow[]> {
  const sql = status
    ? 'SELECT * FROM crew_action_approvals WHERE artifact_id = ? AND status = ? ORDER BY created_at DESC LIMIT 100'
    : 'SELECT * FROM crew_action_approvals WHERE artifact_id = ? ORDER BY created_at DESC LIMIT 100';
  const stmt = status
    ? env.DB.prepare(sql).bind(artifactId, status)
    : env.DB.prepare(sql).bind(artifactId);
  const r = await stmt.all<CrewApprovalRow>();
  return r.results;
}

export async function getApproval(env: Env, id: string): Promise<CrewApprovalRow | null> {
  return env.DB.prepare('SELECT * FROM crew_action_approvals WHERE id = ?').bind(id).first<CrewApprovalRow>();
}

export async function rejectApproval(env: Env, id: string, decidedBy: string | null): Promise<boolean> {
  const r = await env.DB.prepare(
    `UPDATE crew_action_approvals SET status='rejected', decided_by=?, decided_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id=? AND status='pending' RETURNING id`
  )
    .bind(decidedBy, id)
    .first();
  return !!r;
}

export interface ApproveResult {
  status: 'executed' | 'failed' | 'noop';
  result?: unknown;
  error?: string;
}

/**
 * Claim a pending approval (idempotent via the status guard) and execute the
 * captured action through the same tool executor, at owner scope. Replaying the
 * stored input — no model, no transcript.
 */
export async function approveAndExecute(env: Env, id: string, decidedBy: string | null): Promise<ApproveResult> {
  // Claim: only one approve can win the pending→approved transition.
  const claimed = await env.DB.prepare(
    `UPDATE crew_action_approvals SET status='approved', decided_by=?, decided_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
     WHERE id=? AND status='pending' RETURNING *`
  )
    .bind(decidedBy, id)
    .first<CrewApprovalRow>();
  if (!claimed) return { status: 'noop', error: 'Approval is not pending' };

  const crew = await getCrewById(env, claimed.crew_id);
  const tool = CREW_TOOLS[claimed.tool_name];
  if (!crew || !tool) {
    await markDone(env, id, 'failed', { error: 'crew or tool no longer available' });
    return { status: 'failed', error: 'crew or tool no longer available' };
  }

  let input: Record<string, unknown> = {};
  try {
    input = JSON.parse(claimed.input_json) as Record<string, unknown>;
  } catch {
    /* keep empty */
  }

  const ownerCtx = await buildOwnerDataContextForCrew(env, crew);
  const principal = {
    crewId: crew.id,
    runId: claimed.run_id,
    ownerId: crew.owner_id,
    artifactId: crew.artifact_id,
    workspaceId: crew.workspace_id ?? '',
  };

  try {
    const result = await tool.execute({ data: ownerCtx, principal, limits: {} }, input);
    const isError = result && typeof result === 'object' && 'error' in (result as Record<string, unknown>);
    await markDone(env, id, isError ? 'failed' : 'executed', result);
    return { status: isError ? 'failed' : 'executed', result };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'execution failed';
    await markDone(env, id, 'failed', { error });
    return { status: 'failed', error };
  }
}

async function markDone(env: Env, id: string, status: 'executed' | 'failed', result: unknown): Promise<void> {
  await env.DB.prepare('UPDATE crew_action_approvals SET status=?, result_json=? WHERE id=?')
    .bind(status, JSON.stringify(result ?? null), id)
    .run();
}
