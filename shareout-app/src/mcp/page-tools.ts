/**
 * Per-page tools: version history (list, read an old version, restore), review
 * (comments, resolve, assign, approve) and the page's schedules. Each one calls the
 * same handler or domain function as its REST route — /v1/artifacts/{id}/versions*,
 * /v1/home/comments*, /v1/home/approvals, /v1/jobs — as the caller, so the viewer /
 * editor / comment-access gates apply unchanged.
 */
import { handleGetVersions, handleGetVersionSource, handleRestoreVersion } from '../artifacts/versions';
import { queryArtifactComments } from '../pages/home/queries/comments';
import { setApproval, setCommentAssignee, setCommentResolved, type ReviewResult } from '../pages/home/queries/review';
import { handleListJobs } from '../scheduling/handler';
import {
  ON_FAILURE, errorText, fail, getRequest, ok, readJson, str,
  type ToolContext, type ToolDef, type ToolResult,
} from './tool-kit';

const ARTIFACT_ID = { type: 'string', description: 'The page id (from list_artifacts or get_artifact).' };
const VERSION_NO = { type: 'integer', minimum: 1, description: 'The version number (from list_versions).' };

function postRequest(ctx: ToolContext, path: string, body: unknown): Request {
  return new Request(`${ctx.origin}${path}`, {
    method: 'POST',
    headers: { Authorization: ctx.authorization, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const MISSING = fail('artifact_id is required.');
const NO_COMMENT = fail('artifact_id and comment_id are both required.');

function reviewFailed<T>(r: Extract<ReviewResult<T>, { ok: false }>, action: string): ToolResult {
  if (r.status === 403) return fail(`The person cannot ${action}: they need comment access to this page.`, { status: 403, code: r.code });
  return fail(`Could not ${action}: ${r.message}.`, { status: r.status, code: r.code });
}

interface VersionRow {
  id: string; version_no: number; created_at: string; source: string | null; message: string | null;
  message_source: string | null; created_by_email: string | null; created_by_name: string | null;
  restored_from_version_no: number | null; comment_count: number; approvals: Array<{ name: string | null; email: string | null }>;
}

const listVersions: ToolDef = {
  name: 'list_versions',
  title: 'Page history',
  description: 'Lists the saved versions of a page, newest first: who published each one, when, how (api, agent, editor or restore), its change note, how many comments were left on it and who approved it. Says which version is live. Answer in the person\'s language.',
  inputSchema: { type: 'object', properties: { artifact_id: ARTIFACT_ID }, required: ['artifact_id'], additionalProperties: false },
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run(ctx, args) {
    const id = str(args.artifact_id, 100);
    if (!id) return MISSING;
    const res = await handleGetVersions(getRequest(ctx, `/v1/artifacts/${id}/versions`), ctx.env, ctx.user, id);
    const body = await readJson(res);
    if (!res.ok) return fail(`Could not read the page history: ${errorText(body, res.status)}`, { status: res.status, code: body.code });
    const versions = (body.versions ?? []) as VersionRow[];
    const live = body.live_version_id as string | null;
    const lines = versions.map((v) => {
      const who = v.created_by_name || v.created_by_email || 'someone';
      const note = v.message ? ` — "${v.message}"${v.message_source === 'ai' ? ' (auto-written)' : ''}` : '';
      const from = v.restored_from_version_no ? `, restored from v${v.restored_from_version_no}` : '';
      const extras = [
        v.comment_count ? `${v.comment_count} comments` : '',
        v.approvals.length ? `approved by ${v.approvals.map((a) => a.name || a.email).join(', ')}` : '',
      ].filter(Boolean).join('; ');
      return `- v${v.version_no}${v.id === live ? ' (live)' : ''}: ${who}, ${v.created_at} via ${v.source ?? 'unknown'}${from}${note}${extras ? ` [${extras}]` : ''}`;
    });
    return ok(versions.length ? lines.join('\n') : 'This page has no saved versions.', { versions, live_version_id: live });
  },
};

const getVersionSource: ToolDef = {
  name: 'get_version_source',
  title: 'Read an old version',
  description: 'Returns the main file of one saved version of a page (up to 512 KB), to compare with the current one or to see what it said before.',
  inputSchema: {
    type: 'object',
    properties: { artifact_id: ARTIFACT_ID, version_no: VERSION_NO },
    required: ['artifact_id', 'version_no'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run(ctx, args) {
    const id = str(args.artifact_id, 100);
    if (!id) return MISSING;
    const no = Number(args.version_no);
    const res = await handleGetVersionSource(getRequest(ctx, `/v1/artifacts/${id}/versions/${no}/source`), ctx.env, ctx.user, id, no);
    const body = await readJson(res);
    if (!res.ok) return fail(`Could not read version ${no}: ${errorText(body, res.status)}`, { status: res.status, code: body.code });
    const text = [`Version ${no} (${String(body.entrypoint)})${body.truncated ? ', cut at 512 KB' : ''}:`, String(body.content ?? '')].join('\n');
    return ok(text, body);
  },
};

const restoreVersion: ToolDef = {
  name: 'restore_version',
  title: 'Bring back an old version',
  description: [
    'Makes an old version of a page live again by saving it as a new version (nothing is deleted; the history keeps every version).',
    'Needs edit access. Confirm the version with the person first. message: optional note for the history.',
    'Afterwards tell the person which version is now live.', ON_FAILURE,
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      artifact_id: ARTIFACT_ID,
      version_no: VERSION_NO,
      message: { type: 'string', description: 'A short note on why, shown in the history.' },
    },
    required: ['artifact_id', 'version_no'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  async run(ctx, args) {
    const id = str(args.artifact_id, 100);
    if (!id) return MISSING;
    const no = Number(args.version_no);
    const message = str(args.message, 500);
    const waitUntil = ctx.executionCtx?.waitUntil?.bind(ctx.executionCtx);
    const res = await handleRestoreVersion(
      postRequest(ctx, `/v1/artifacts/${id}/versions/${no}/restore`, message ? { message } : {}), ctx.env, ctx.user, id, no, waitUntil,
    );
    const body = await readJson(res);
    if (!res.ok) return fail(`Version ${no} was not restored: ${errorText(body, res.status)}`, { status: res.status, code: body.code });
    const staged = body.staged ? ' It is waiting for the page\'s checks to pass before it goes live.' : ' It is live now.';
    return ok(`Restored version ${no} as the new version ${String(body.version_no)}.${staged}`, body);
  },
};

interface CommentRow {
  id: string; parent_id: string | null; author_name: string | null; content: string; created_at: string;
  resolved: number | boolean | null; assignee_email: string | null; version_no: number | null;
}

const listComments: ToolDef = {
  name: 'list_comments',
  title: 'Comments on a page',
  description: 'Lists the comment threads on a page with their ids (for resolve_comment / assign_comment), who wrote them, whether they are resolved, who they are assigned to, and the version they were written on. open_only skips resolved threads.',
  inputSchema: {
    type: 'object',
    properties: {
      artifact_id: ARTIFACT_ID,
      open_only: { type: 'boolean', default: false },
      limit: { type: 'integer', minimum: 1, maximum: 500, default: 200 },
    },
    required: ['artifact_id'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run(ctx, args) {
    const id = str(args.artifact_id, 100);
    if (!id) return MISSING;
    const rows = (await queryArtifactComments(ctx.env, ctx.user, id, Number(args.limit) || 200)) as unknown as CommentRow[];
    const replies = new Map<string, number>();
    for (const r of rows) if (r.parent_id) replies.set(r.parent_id, (replies.get(r.parent_id) ?? 0) + 1);
    const threads = rows.filter((r) => !r.parent_id && !(args.open_only === true && r.resolved));
    if (!threads.length) return ok('No comments the person can see on this page.', { comments: [] });
    const text = threads.map((c) => {
      const tags = [
        c.resolved ? 'resolved' : 'open',
        c.assignee_email ? `assigned to ${c.assignee_email}` : '',
        c.version_no ? `on v${c.version_no}` : '',
        replies.get(c.id) ? `${replies.get(c.id)} replies` : '',
      ].filter(Boolean).join(', ');
      return `- ${c.id} · ${c.author_name ?? 'someone'}: "${c.content.slice(0, 200)}" (${tags})`;
    }).join('\n');
    return ok(text, { comments: rows });
  },
};

const resolveComment: ToolDef = {
  name: 'resolve_comment',
  title: 'Resolve or reopen a comment',
  description: 'Marks a comment thread resolved (or reopens it with resolved: false). Anyone with comment access to the page may do it. Get the comment_id from list_comments.',
  inputSchema: {
    type: 'object',
    properties: { artifact_id: ARTIFACT_ID, comment_id: { type: 'string' }, resolved: { type: 'boolean', default: true } },
    required: ['artifact_id', 'comment_id'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async run(ctx, args) {
    const resolved = args.resolved !== false;
    const id = str(args.artifact_id, 100), commentId = str(args.comment_id, 100);
    if (!id || !commentId) return NO_COMMENT;
    const r = await setCommentResolved(ctx.env, ctx.user, id, commentId, resolved);
    if (!r.ok) return reviewFailed(r, resolved ? 'resolve that comment' : 'reopen that comment');
    return ok(resolved ? 'The comment is resolved.' : 'The comment is open again.', r.data);
  },
};

const assignComment: ToolDef = {
  name: 'assign_comment',
  title: 'Assign a comment',
  description: 'Assigns a comment thread to someone on the page (owner, workspace member or collaborator) by email, turning it into an action item; they are notified. assignee null clears it. Replies cannot be assigned, only the thread.',
  inputSchema: {
    type: 'object',
    properties: {
      artifact_id: ARTIFACT_ID,
      comment_id: { type: 'string' },
      assignee: { type: ['string', 'null'], description: 'Email of the person, or null to unassign.' },
    },
    required: ['artifact_id', 'comment_id'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async run(ctx, args) {
    const assignee = str(args.assignee, 320);
    const id = str(args.artifact_id, 100), commentId = str(args.comment_id, 100);
    if (!id || !commentId) return NO_COMMENT;
    const r = await setCommentAssignee(ctx.env, ctx.user, id, commentId, assignee);
    if (!r.ok) {
      if (r.code === 'ASSIGNEE_NOT_FOUND') return fail(`${assignee} is not on this page (not the owner, a workspace member or a collaborator), so the comment cannot be assigned to them.`, { code: r.code });
      return reviewFailed(r, 'assign that comment');
    }
    return ok(r.data.assignee_email ? `Assigned to ${r.data.assignee_email}.` : 'The comment is no longer assigned.', r.data);
  },
};

const approveVersion: ToolDef = {
  name: 'approve_version',
  title: 'Approve a version',
  description: 'Records that the person approves a version of a page (the live one unless version_no is given); approved: false withdraws it. Approvals are a record shown in the history, not a publish gate. Needs comment access.',
  inputSchema: {
    type: 'object',
    properties: { artifact_id: ARTIFACT_ID, version_no: VERSION_NO, approved: { type: 'boolean', default: true } },
    required: ['artifact_id'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async run(ctx, args) {
    const id = str(args.artifact_id, 100);
    if (!id) return MISSING;
    const approved = args.approved !== false;
    // Map a version number to its id without deciding access here: an unknown number becomes
    // an id no version has, so setApproval still runs its comment-access gate first.
    let versionId: string | null = null;
    if (args.version_no !== undefined && args.version_no !== null) {
      const row = await ctx.env.DB.prepare('SELECT id FROM versions WHERE artifact_id = ? AND version_no = ?')
        .bind(id, Number(args.version_no)).first<{ id: string }>();
      versionId = row?.id ?? 'ver_unknown';
    }
    const r = await setApproval(ctx.env, ctx.user, id, versionId, approved);
    if (!r.ok) return reviewFailed(r, approved ? 'approve that version' : 'withdraw that approval');
    const no = args.version_no ?? r.data.live_version_no;
    return ok(approved ? `Approved version ${String(no)}.` : `Withdrew the approval of version ${String(no)}.`, r.data as unknown as Record<string, unknown>);
  },
};

interface JobRow { id: string; title: string | null; action: string; trigger_type: string; schedule: string | null; enabled: boolean; next_run_at: string | null; artifact_id: string }

const listJobs: ToolDef = {
  name: 'list_jobs',
  title: 'Scheduled sends',
  description: 'Lists scheduled and automatic sends (email, Slack, Telegram, webhooks…). With artifact_id: the schedules on that page — its owner and editors see every shared one plus their own; other people\'s personal subscriptions (their Slack DM, own email) stay private. Without it: the person\'s own schedules, optionally in one workspace. Times are UTC.',
  inputSchema: {
    type: 'object',
    properties: { artifact_id: ARTIFACT_ID, workspace_id: { type: 'string', description: 'Only the person\'s schedules in this workspace (id).' } },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run(ctx, args) {
    const qs = new URLSearchParams();
    const artifactId = str(args.artifact_id, 100);
    const workspaceId = str(args.workspace_id, 100);
    if (artifactId) qs.set('artifact_id', artifactId);
    if (workspaceId) qs.set('workspace_id', workspaceId);
    const res = await handleListJobs(getRequest(ctx, `/v1/jobs${qs.size ? `?${qs}` : ''}`), ctx.env, ctx.user);
    const body = await readJson(res);
    if (!res.ok) return fail(`Could not list the schedules: ${errorText(body, res.status)}`, { status: res.status, code: body.code });
    const jobs = (body.jobs ?? []) as JobRow[];
    const text = jobs.length
      ? jobs.map((j) => `- ${j.title || j.action} (${j.action}, ${j.trigger_type === 'cron' ? `schedule ${j.schedule} UTC` : 'on an event'}${j.enabled ? '' : ', paused'}${j.next_run_at ? `, next ${j.next_run_at}` : ''}) id ${j.id}`).join('\n')
      : 'No schedules found.';
    return ok(text, { jobs });
  },
};

export const PAGE_TOOLS: ToolDef[] = [
  listVersions, getVersionSource, restoreVersion, listComments, resolveComment, assignComment, approveVersion, listJobs,
];
