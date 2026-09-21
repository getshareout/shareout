/**
 * Proposed changes to a skill — the middle ground between "only the author may
 * touch this" and "anyone may overwrite the team's playbook".
 *
 * A member writes a new body and opens a request; an approver (the skill's owner or
 * a workspace admin) merges it, which republishes the skill as an ordinary new
 * version, or rejects it with a note. Nothing is applied until a merge, so an open
 * request never changes what an agent loads.
 */
import type { Env } from '../types';
import type { AuthUser } from '../api-auth';
import { generateId } from '../crypto-utils';
import { json } from '../artifacts/json-response';
import { getInternalWorkspaceRole } from '../workspaces/roles';
import { readSkillMarkdown } from '../skill-marketplace';
import { canReviewSkillChanges, loadSkillGovernance, type SkillGovernance } from './policy';
import { republishSkillMarkdown } from './republish';

/** Skill bodies are budgeted at 60k chars for the agent loader; refuse more here too. */
const MAX_MARKDOWN = 60_000;
const MAX_OPEN_PER_USER = 5;

type ChangeStatus = 'open' | 'merged' | 'rejected' | 'withdrawn';

interface ChangeRow {
  id: string;
  skill_artifact_id: string;
  workspace_id: string;
  proposed_by: string | null;
  reviewed_by: string | null;
  base_version_no: number;
  title: string | null;
  note: string | null;
  status: string;
  review_note: string | null;
  merged_version_no: number | null;
  created_at: string;
  updated_at: string;
  proposer_email?: string | null;
  reviewer_email?: string | null;
}

function formatChange(row: ChangeRow, markdown?: string): Record<string, unknown> {
  return {
    id: row.id,
    skill_artifact_id: row.skill_artifact_id,
    status: row.status,
    title: row.title,
    note: row.note,
    base_version_no: row.base_version_no,
    merged_version_no: row.merged_version_no,
    review_note: row.review_note,
    proposed_by: row.proposer_email ?? row.proposed_by,
    reviewed_by: row.reviewer_email ?? row.reviewed_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...(markdown != null ? { markdown } : {}),
  };
}

/** Resolve the skill and require the caller be able to see it at all. */
async function requireVisibleSkill(
  env: Env,
  user: AuthUser,
  skillId: string,
): Promise<Response | SkillGovernance> {
  const skill = await loadSkillGovernance(env, skillId);
  if (!skill || skill.blocked) return json({ error: 'Skill not found', code: 'NOT_FOUND' }, 404);
  if (skill.official) {
    return json({ error: 'Official skills are read-only', code: 'SKILL_OFFICIAL_READONLY' }, 400);
  }
  if (!(await getInternalWorkspaceRole(env, skill.workspaceId, user.id))) {
    return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  }
  return skill;
}

// GET /v1/skills/:id/changes — the review queue for one skill.
export async function handleListSkillChanges(
  request: Request,
  env: Env,
  user: AuthUser,
  skillId: string,
): Promise<Response> {
  const skill = await requireVisibleSkill(env, user, skillId);
  if (skill instanceof Response) return skill;

  const status = new URL(request.url).searchParams.get('status');
  const filters = ['c.skill_artifact_id = ?'];
  const binds: unknown[] = [skillId];
  if (status && ['open', 'merged', 'rejected', 'withdrawn'].includes(status)) {
    filters.push('c.status = ?');
    binds.push(status);
  }

  const rows = await env.DB.prepare(
    `SELECT c.*, p.email AS proposer_email, r.email AS reviewer_email
       FROM skill_change_requests c
       LEFT JOIN users p ON p.id = c.proposed_by
       LEFT JOIN users r ON r.id = c.reviewed_by
      WHERE ${filters.join(' AND ')}
      ORDER BY CASE c.status WHEN 'open' THEN 0 ELSE 1 END, c.created_at DESC
      LIMIT 50`
  ).bind(...binds).all<ChangeRow>();

  return json({
    changes: (rows.results ?? []).map(r => formatChange(r)),
    can_review: await canReviewSkillChanges(env, user.id, skill),
  });
}

// GET /v1/skills/:id/changes/:changeId — one request, with the proposed body.
export async function handleGetSkillChange(
  env: Env,
  user: AuthUser,
  skillId: string,
  changeId: string,
): Promise<Response> {
  const skill = await requireVisibleSkill(env, user, skillId);
  if (skill instanceof Response) return skill;

  const row = await env.DB.prepare(
    `SELECT c.*, p.email AS proposer_email, r.email AS reviewer_email
       FROM skill_change_requests c
       LEFT JOIN users p ON p.id = c.proposed_by
       LEFT JOIN users r ON r.id = c.reviewed_by
      WHERE c.id = ? AND c.skill_artifact_id = ?`
  ).bind(changeId, skillId).first<ChangeRow & { markdown: string }>();
  if (!row) return json({ error: 'Change request not found', code: 'NOT_FOUND' }, 404);

  const current = await readSkillMarkdown(env, skillId, skill.latestVersionNo);
  return json({
    change: formatChange(row, row.markdown),
    current_markdown: current ?? '',
    current_version_no: skill.latestVersionNo,
    can_review: await canReviewSkillChanges(env, user.id, skill),
  });
}

// POST /v1/skills/:id/changes — propose a new body.
export async function handleProposeSkillChange(
  request: Request,
  env: Env,
  user: AuthUser,
  skillId: string,
): Promise<Response> {
  const skill = await requireVisibleSkill(env, user, skillId);
  if (skill instanceof Response) return skill;

  let body: { markdown?: string; title?: string; note?: string };
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400); }

  const markdown = (body.markdown ?? '').trim();
  if (!markdown) return json({ error: 'markdown is required', code: 'BAD_REQUEST' }, 400);
  if (markdown.length > MAX_MARKDOWN) {
    return json({ error: `Skill body exceeds ${MAX_MARKDOWN} characters`, code: 'SKILL_TOO_LARGE' }, 400);
  }

  const current = await readSkillMarkdown(env, skillId, skill.latestVersionNo);
  if (current != null && current.trim() === markdown) {
    return json({ error: 'Proposed body is identical to the current version', code: 'NO_CHANGE' }, 400);
  }

  const open = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM skill_change_requests
      WHERE skill_artifact_id = ? AND proposed_by = ? AND status = 'open'`
  ).bind(skillId, user.id).first<{ n: number }>();
  if ((open?.n ?? 0) >= MAX_OPEN_PER_USER) {
    return json({ error: `At most ${MAX_OPEN_PER_USER} open proposals per skill`, code: 'LIMIT_REACHED' }, 400);
  }

  const id = generateId('skc');
  await env.DB.prepare(
    `INSERT INTO skill_change_requests
       (id, skill_artifact_id, workspace_id, proposed_by, base_version_no, title, note, markdown)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, skillId, skill.workspaceId, user.id, skill.latestVersionNo,
    (body.title ?? '').trim().slice(0, 200) || null,
    (body.note ?? '').trim().slice(0, 2000) || null,
    markdown,
  ).run();

  return json({ id, status: 'open', base_version_no: skill.latestVersionNo }, 201);
}

// POST /v1/skills/:id/changes/:changeId — merge, reject, or withdraw.
export async function handleReviewSkillChange(
  request: Request,
  env: Env,
  user: AuthUser,
  skillId: string,
  changeId: string,
  executionCtx?: ExecutionContext,
): Promise<Response> {
  const skill = await requireVisibleSkill(env, user, skillId);
  if (skill instanceof Response) return skill;

  let body: { action?: string; review_note?: string };
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400); }
  const action = body.action;
  if (action !== 'merge' && action !== 'reject' && action !== 'withdraw') {
    return json({ error: "action must be 'merge', 'reject' or 'withdraw'", code: 'BAD_REQUEST' }, 400);
  }

  const row = await env.DB.prepare(
    'SELECT * FROM skill_change_requests WHERE id = ? AND skill_artifact_id = ?'
  ).bind(changeId, skillId).first<ChangeRow & { markdown: string }>();
  if (!row) return json({ error: 'Change request not found', code: 'NOT_FOUND' }, 404);
  if (row.status !== 'open') {
    return json({ error: `Change request is already ${row.status}`, code: 'CHANGE_CLOSED' }, 409);
  }

  // Withdrawing is the proposer's own call; merging and rejecting are the reviewer's.
  if (action === 'withdraw') {
    if (row.proposed_by !== user.id) return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  } else if (!(await canReviewSkillChanges(env, user.id, skill))) {
    return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  }

  const reviewNote = (body.review_note ?? '').trim().slice(0, 2000) || null;

  if (action !== 'merge') {
    const status: ChangeStatus = action === 'reject' ? 'rejected' : 'withdrawn';
    await closeChange(env, changeId, status, user.id, reviewNote, null);
    return json({ id: changeId, status });
  }

  const published = await republishSkillMarkdown(env, user, skill, row.markdown, executionCtx);
  await closeChange(env, changeId, 'merged', user.id, reviewNote, published.versionNo);

  // Any other request written against the version we just superseded is now stale;
  // it stays open on purpose — the reviewer sees the drift in base_version_no rather
  // than having their teammate's work silently discarded.
  return json({
    id: changeId,
    status: 'merged',
    version_no: published.versionNo,
    stale_base: row.base_version_no !== skill.latestVersionNo,
  });
}

async function closeChange(
  env: Env,
  changeId: string,
  status: ChangeStatus,
  reviewerId: string,
  reviewNote: string | null,
  mergedVersionNo: number | null,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE skill_change_requests
        SET status = ?, reviewed_by = ?, review_note = ?, merged_version_no = ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = ?`
  ).bind(status, reviewerId, reviewNote, mergedVersionNo, changeId).run();
}

/** Open-proposal counts for the Library badge, in one query for the whole workspace. */
export async function countOpenChangesBySkill(env: Env, workspaceId: string): Promise<Record<string, number>> {
  const rows = await env.DB.prepare(
    `SELECT skill_artifact_id AS id, COUNT(*) AS n
       FROM skill_change_requests
      WHERE workspace_id = ? AND status = 'open'
      GROUP BY skill_artifact_id`
  ).bind(workspaceId).all<{ id: string; n: number }>();
  const out: Record<string, number> = {};
  for (const r of rows.results ?? []) out[r.id] = r.n;
  return out;
}
