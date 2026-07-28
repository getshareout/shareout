// Workspace publish governance (Phase 1). A workspace can require approval before a
// member takes an artifact to an open visibility (public). The requester
// nominates N workspace members; all must approve; then the artifact flips to the
// requested visibility and the platform safety review (moderation) still runs on top.
// Approval is tied to the page's content hash, so it's per-artifact until the page changes.

import type { Env } from './types';
import type { AuthUser } from './api-auth';
import { generateId } from './crypto-utils';
import { contentHash, classifyAndPersist } from './moderation/check';
import { getInternalWorkspaceRole } from './workspaces';
import { invalidateDeploymentCacheById } from './serve/deployment-cache';
import { dispatchLifecycleEmail } from './email/gateway';
import { normalizeVisibility } from './visibility-config';
import { jsonWithApiErrors } from './http/api-error';

function json(data: unknown, status = 200): Response {
  return jsonWithApiErrors(data, status);
}

const VALID_POLICIES: PublishPolicy[] = ['allow', 'prohibit', 'require_approval'];

export type PublishPolicy = 'allow' | 'prohibit' | 'require_approval';

export interface WorkspacePublishPolicy {
  policy: PublishPolicy;
  approvalsRequired: number;
}

export async function getWorkspacePublishPolicy(env: Env, workspaceId: string | null): Promise<WorkspacePublishPolicy> {
  if (!workspaceId) return { policy: 'allow', approvalsRequired: 1 };
  const row = await env.DB.prepare(
    'SELECT public_publish_policy AS policy, public_publish_approvals_required AS n FROM workspaces WHERE id = ?'
  ).bind(workspaceId).first<{ policy: string; n: number }>();
  const policy = (row?.policy as PublishPolicy) || 'allow';
  return { policy, approvalsRequired: Math.max(1, row?.n ?? 1) };
}

export async function setWorkspacePublishPolicy(
  env: Env,
  workspaceId: string,
  policy: PublishPolicy,
  approvalsRequired: number
): Promise<void> {
  await env.DB.prepare(
    'UPDATE workspaces SET public_publish_policy = ?, public_publish_approvals_required = ? WHERE id = ?'
  ).bind(policy, Math.max(1, approvalsRequired || 1), workspaceId).run();
}

/** Hash of the artifact's current production entrypoint HTML (null if none/non-HTML). */
export async function getArtifactContentHash(env: Env, artifactId: string): Promise<string | null> {
  const row = await env.DB.prepare(`
    SELECT ast.r2_key, ast.mime FROM deployments d
    JOIN versions v ON v.id = d.version_id
    JOIN assets ast ON ast.version_id = v.id AND ast.path = v.entrypoint
    WHERE d.artifact_id = ? AND d.channel = 'production' LIMIT 1
  `).bind(artifactId).first<{ r2_key: string; mime: string }>();
  if (!row?.r2_key || row.mime !== 'text/html') return null;
  const obj = await env.ARTIFACTS.get(row.r2_key);
  if (!obj) return null;
  return contentHash(await obj.text());
}

/** True when an APPROVED request exists for this artifact at the given content hash. */
export async function hasApprovedPublish(env: Env, artifactId: string, hash: string | null): Promise<boolean> {
  if (!hash) return false;
  const row = await env.DB.prepare(
    `SELECT 1 FROM artifact_publish_approvals
      WHERE artifact_id = ? AND content_hash = ? AND status = 'approved' LIMIT 1`
  ).bind(artifactId, hash).first();
  return !!row;
}

export interface CreateApprovalInput {
  artifactId: string;
  workspaceId: string;
  requesterId: string;
  visibility: 'public';
  approverIds: string[];
}

export async function createPublishApproval(env: Env, input: CreateApprovalInput): Promise<{ ok: boolean; error?: string; id?: string }> {
  const { policy, approvalsRequired } = await getWorkspacePublishPolicy(env, input.workspaceId);
  if (policy !== 'require_approval') return { ok: false, error: 'Workspace does not require publish approval' };

  // Dedupe + validate the nominated approvers: distinct, not the requester, all
  // members of the workspace, and exactly the required count.
  const approverIds = [...new Set(input.approverIds)].filter((id) => id && id !== input.requesterId);
  if (approverIds.length !== approvalsRequired) {
    return { ok: false, error: `Select exactly ${approvalsRequired} approver(s)` };
  }
  for (const id of approverIds) {
    if ((await getInternalWorkspaceRole(env, input.workspaceId, id)) === null) {
      return { ok: false, error: 'All approvers must be members of the workspace' };
    }
  }

  const hash = await getArtifactContentHash(env, input.artifactId);
  if (!hash) return { ok: false, error: 'Artifact has no publishable content' };

  // Supersede any prior pending request for this artifact (re-request flow).
  await env.DB.prepare(
    `UPDATE artifact_publish_approvals SET status='rejected', decided_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE artifact_id = ? AND status='pending'`
  ).bind(input.artifactId).run();

  const id = generateId('pappr');
  await env.DB.prepare(
    `INSERT INTO artifact_publish_approvals
       (id, artifact_id, workspace_id, requester_id, requested_visibility, content_hash, approvals_required, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`
  ).bind(id, input.artifactId, input.workspaceId, input.requesterId, input.visibility, hash, approvalsRequired).run();

  for (const approverId of approverIds) {
    await env.DB.prepare(
      'INSERT INTO artifact_publish_approval_voters (id, approval_id, approver_id) VALUES (?, ?, ?)'
    ).bind(generateId('pvote'), id, approverId).run();
  }

  await notifyApprovers(env, input.artifactId, approverIds).catch(() => {});
  return { ok: true, id };
}

export interface DecisionResult {
  ok: boolean;
  error?: string;
  status?: 'pending' | 'approved' | 'rejected';
}

export async function decidePublishApproval(
  env: Env,
  approvalId: string,
  approverId: string,
  decision: 'approve' | 'reject'
): Promise<DecisionResult> {
  const appr = await env.DB.prepare(
    `SELECT * FROM artifact_publish_approvals WHERE id = ?`
  ).bind(approvalId).first<{ id: string; artifact_id: string; requested_visibility: string; content_hash: string; status: string; requester_id: string }>();
  if (!appr) return { ok: false, error: 'Request not found' };
  if (appr.status !== 'pending') return { ok: false, error: `Request already ${appr.status}`, status: appr.status as DecisionResult['status'] };

  // Record this approver's vote (must be a nominated voter).
  const claimed = await env.DB.prepare(
    `UPDATE artifact_publish_approval_voters SET status=?, decided_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE approval_id=? AND approver_id=? AND status='pending' RETURNING id`
  ).bind(decision === 'approve' ? 'approved' : 'rejected', approvalId, approverId).first();
  if (!claimed) return { ok: false, error: 'You are not a pending approver on this request' };

  if (decision === 'reject') {
    await env.DB.prepare(
      `UPDATE artifact_publish_approvals SET status='rejected', decided_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='pending'`
    ).bind(approvalId).run();
    await notifyRequester(env, appr.artifact_id, appr.requester_id, 'rejected').catch(() => {});
    return { ok: true, status: 'rejected' };
  }

  // Approve: finalize once every nominated voter has approved.
  const pending = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM artifact_publish_approval_voters WHERE approval_id=? AND status<>'approved'`
  ).bind(approvalId).first<{ n: number }>();
  if ((pending?.n ?? 1) > 0) return { ok: true, status: 'pending' };

  // All approved → claim the request, flip visibility, run platform safety review.
  const won = await env.DB.prepare(
    `UPDATE artifact_publish_approvals SET status='approved', decided_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='pending' RETURNING id`
  ).bind(approvalId).first();
  if (!won) return { ok: true, status: 'approved' }; // someone else finalized

  await env.DB.prepare('UPDATE artifacts SET visibility=? WHERE id=?')
    .bind(appr.requested_visibility, appr.artifact_id).run();
  // Platform safety review still applies; may hold it private if flagged.
  await classifyAndPersist(env, appr.artifact_id).catch(() => {});
  await invalidateDeploymentCacheById(env, appr.artifact_id).catch(() => {});
  await notifyRequester(env, appr.artifact_id, appr.requester_id, 'approved').catch(() => {});
  return { ok: true, status: 'approved' };
}

export async function listWorkspacePublishApprovals(env: Env, workspaceId: string, status = 'pending', viewerId = '') {
  const r = await env.DB.prepare(`
    SELECT a.id, a.artifact_id, a.requester_id, a.requested_visibility, a.status, a.created_at,
           a.approvals_required,
           COALESCE(art.name,'(deleted)') AS artifact_name,
           art.slug AS artifact_slug,
           COALESCE(u.email,u.name,'unknown') AS requester,
           (SELECT COUNT(*) FROM artifact_publish_approval_voters v
              WHERE v.approval_id = a.id AND v.status = 'approved') AS approved_count,
           (SELECT COUNT(*) FROM artifact_publish_approval_voters v
              WHERE v.approval_id = a.id AND v.approver_id = ? AND v.status = 'pending') AS viewer_can_decide
    FROM artifact_publish_approvals a
    LEFT JOIN artifacts art ON art.id = a.artifact_id
    LEFT JOIN users u ON u.id = a.requester_id
    WHERE a.workspace_id = ? AND a.status = ?
    ORDER BY a.created_at DESC LIMIT 100
  `).bind(viewerId, workspaceId, status).all();
  return r.results || [];
}

async function emailOf(env: Env, userId: string): Promise<string | null> {
  const u = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(userId).first<{ email: string | null }>();
  return u?.email ?? null;
}

async function notifyApprovers(env: Env, artifactId: string, approverIds: string[]): Promise<void> {
  for (const id of approverIds) {
    const email = await emailOf(env, id);
    if (!email) continue;
    await dispatchLifecycleEmail(env, {
      type: 'publish_approval',
      toUserId: id,
      toEmail: email,
      data: { kind: 'request' },
    }).catch(() => {});
  }
}

async function notifyRequester(env: Env, artifactId: string, requesterId: string, outcome: 'approved' | 'rejected'): Promise<void> {
  const email = await emailOf(env, requesterId);
  if (!email) return;
  await dispatchLifecycleEmail(env, {
    type: 'publish_approval',
    toUserId: requesterId,
    toEmail: email,
    data: { kind: outcome === 'approved' ? 'approved' : 'declined' },
  }).catch(() => {});
}

// ── HTTP handlers ─────────────────────────────────────────────────────────────

async function artifactWorkspace(env: Env, artifactId: string): Promise<string | null> {
  const a = await env.DB.prepare('SELECT workspace_id FROM artifacts WHERE id = ?')
    .bind(artifactId).first<{ workspace_id: string | null }>();
  return a?.workspace_id ?? null;
}

/** GET workspace publish policy (any member). */
export async function handleGetPublishPolicy(env: Env, user: AuthUser, workspaceId: string): Promise<Response> {
  if ((await getInternalWorkspaceRole(env, workspaceId, user.id)) === null) return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  return json(await getWorkspacePublishPolicy(env, workspaceId));
}

/** PATCH workspace publish policy (owner/admin only). */
export async function handleSetPublishPolicy(request: Request, env: Env, user: AuthUser, workspaceId: string): Promise<Response> {
  const role = await getInternalWorkspaceRole(env, workspaceId, user.id);
  if (role !== 'owner' && role !== 'admin') return json({ error: 'Admins only', code: 'FORBIDDEN' }, 403);
  let body: { policy?: string; approvals_required?: number };
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400); }
  if (!VALID_POLICIES.includes(body.policy as PublishPolicy)) {
    return json({ error: `policy must be one of ${VALID_POLICIES.join(', ')}`, code: 'INVALID_POLICY' }, 400);
  }
  const n = Math.max(1, Math.min(10, body.approvals_required ?? 1));
  await setWorkspacePublishPolicy(env, workspaceId, body.policy as PublishPolicy, n);
  return json({ ok: true, policy: body.policy, approvals_required: n });
}

/** GET pending publish-approval queue for a workspace (any member). */
export async function handleListPublishApprovals(request: Request, env: Env, user: AuthUser, workspaceId: string): Promise<Response> {
  if ((await getInternalWorkspaceRole(env, workspaceId, user.id)) === null) return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  const status = new URL(request.url).searchParams.get('status') || 'pending';
  return json({ approvals: await listWorkspacePublishApprovals(env, workspaceId, status, user.id) });
}

/** POST a publish-approval request for an artifact (requester nominates approvers). */
export async function handleCreatePublishApproval(request: Request, env: Env, user: AuthUser, artifactId: string): Promise<Response> {
  const workspaceId = await artifactWorkspace(env, artifactId);
  if (!workspaceId) return json({ error: 'Artifact is not in a workspace', code: 'NO_WORKSPACE' }, 400);
  if ((await getInternalWorkspaceRole(env, workspaceId, user.id)) === null) return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  let body: { visibility?: string; approver_ids?: string[] };
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400); }
  // Legacy 'unlisted' folds into 'public' (retired 2026-07).
  if (normalizeVisibility(body.visibility) !== 'public') {
    return json({ error: 'visibility must be public', code: 'INVALID_VISIBILITY' }, 400);
  }
  const res = await createPublishApproval(env, {
    artifactId,
    workspaceId,
    requesterId: user.id,
    visibility: 'public',
    approverIds: Array.isArray(body.approver_ids) ? body.approver_ids : [],
  });
  return json(res, res.ok ? 201 : 400);
}

/** POST a decision on a publish-approval request (a nominated approver). */
export async function handleDecidePublishApproval(request: Request, env: Env, user: AuthUser, approvalId: string): Promise<Response> {
  let body: { decision?: string };
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400); }
  if (body.decision !== 'approve' && body.decision !== 'reject') {
    return json({ error: 'decision must be approve or reject', code: 'INVALID_DECISION' }, 400);
  }
  const res = await decidePublishApproval(env, approvalId, user.id, body.decision);
  return json(res, res.ok ? 200 : 400);
}
