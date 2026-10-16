// Read-only review tools for chat surfaces (Telegram, Slack, web home), matching the MCP
// list_versions / list_comments: they call the same handler / query as the REST routes as
// the linked user, after the bot's own access gate.
import { handleGetVersions } from '../../artifacts/versions';
import { queryArtifactComments } from '../../pages/home/queries/comments';
import { resolveArtifactAccessForUser } from '../access';
import type { AccountTool, ToolContext } from './types';
import type { PendingAction } from '../actions';

const NO_ACCESS = { error: 'You don’t have access to that page (or it doesn’t exist).' };
const MAX_VERSIONS = 15;
const MAX_THREADS = 30;

async function linkedUser(ctx: ToolContext): Promise<{ id: string; email: string | null; username: null }> {
  const row = await ctx.env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(ctx.userId).first<{ email: string | null }>();
  return { id: ctx.userId, email: row?.email ?? null, username: null };
}

const artifactId = (input: Record<string, unknown>) => (typeof input.artifact_id === 'string' ? input.artifact_id.trim() : '');

interface VersionRow {
  id: string; version_no: number; created_at: string; source: string | null; message: string | null;
  created_by_name: string | null; created_by_email: string | null; restored_from_version_no: number | null;
  comment_count: number; approvals: Array<{ name: string | null; email: string | null }>;
}

export const listVersionsTool: AccountTool = {
  name: 'list_versions',
  description:
    'What changed on a page: its saved versions, newest first — who published each, when, how (api, agent, editor, restore), its change note, how many comments it got and who approved it, and which one is live. Use for "what changed?" or "who updated this?".',
  input_schema: {
    type: 'object',
    properties: { artifact_id: { type: 'string', description: 'The page id (from list_artifacts or search_workspace).' } },
    required: ['artifact_id'],
  },
  async execute(ctx, input) {
    const id = artifactId(input);
    if (!id) return { error: 'Missing artifact_id.' };
    if (!(await resolveArtifactAccessForUser(ctx.env, id, ctx.userId))) return NO_ACCESS;
    const res = await handleGetVersions(new Request(`https://internal/v1/artifacts/${id}/versions`), ctx.env, await linkedUser(ctx), id);
    // Same rule as GET /v1/artifacts/{id}/versions: owner or named collaborator only.
    if (!res.ok) return { error: 'Only the page’s owner or its collaborators can see its version history.' };
    const body = (await res.json()) as { versions?: VersionRow[]; live_version_id?: string | null };
    return {
      versions: (body.versions ?? []).slice(0, MAX_VERSIONS).map((v) => ({
        version: v.version_no,
        live: v.id === body.live_version_id,
        at: v.created_at,
        by: v.created_by_name || v.created_by_email || null,
        via: v.source,
        note: v.message,
        ...(v.restored_from_version_no ? { restored_from: v.restored_from_version_no } : {}),
        comments: v.comment_count,
        approved_by: v.approvals.map((a) => a.name || a.email).filter(Boolean),
      })),
    };
  },
};

export const listCommentsTool: AccountTool = {
  name: 'list_comments',
  description:
    'Review status of a page: its comment threads (id, who wrote them, open or resolved, who they are assigned to, the version they were left on, reply count). open_only skips resolved threads. Use the id with resolve_comment / assign_comment.',
  input_schema: {
    type: 'object',
    properties: {
      artifact_id: { type: 'string', description: 'The page id.' },
      open_only: { type: 'boolean', description: 'Only open threads.' },
    },
    required: ['artifact_id'],
  },
  async execute(ctx, input) {
    const id = artifactId(input);
    if (!id) return { error: 'Missing artifact_id.' };
    if (!(await resolveArtifactAccessForUser(ctx.env, id, ctx.userId))) return NO_ACCESS;
    const rows = await queryArtifactComments(ctx.env, await linkedUser(ctx), id, 200);
    const replies = new Map<string, number>();
    for (const r of rows) if (r.parent_id) replies.set(r.parent_id, (replies.get(r.parent_id) ?? 0) + 1);
    const threads = rows.filter((r) => !r.parent_id && !(input.open_only === true && r.resolved));
    return {
      open: rows.filter((r) => !r.parent_id && !r.resolved).length,
      resolved: rows.filter((r) => !r.parent_id && r.resolved).length,
      threads: threads.slice(-MAX_THREADS).map((c) => ({
        id: c.id,
        by: c.author_name,
        text: c.content.slice(0, 300),
        at: c.created_at,
        status: c.resolved ? 'resolved' : 'open',
        ...(c.assignee_email ? { assigned_to: c.assignee_email } : {}),
        ...(c.version_no ? { version: c.version_no } : {}),
        replies: replies.get(c.id) ?? 0,
      })),
    };
  },
};

// ── Confirm-gated review writes (the user taps Confirm before anything changes) ──

async function nameOf(ctx: ToolContext, id: string): Promise<string> {
  const r = await ctx.env.DB.prepare('SELECT name FROM artifacts WHERE id = ?').bind(id).first<{ name: string }>();
  return r?.name?.trim() || 'page';
}

async function threadExcerpt(ctx: ToolContext, artifact: string, commentId: string): Promise<string | null> {
  const r = await ctx.env.DB.prepare('SELECT content FROM artifact_comments WHERE id = ? AND artifact_id = ? AND parent_id IS NULL')
    .bind(commentId, artifact).first<{ content: string }>();
  return r ? r.content.slice(0, 200) : null;
}

const propose = (action: PendingAction) => ({ __propose: action });

const versionNo = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : null);

export const restoreVersionTool: AccountTool = {
  name: 'restore_version',
  description: 'Bring an old version of a page back live, saved as a new version (nothing is deleted). Needs edit access. Get the number from list_versions. Asks the user to confirm first.',
  input_schema: {
    type: 'object',
    properties: {
      artifact_id: { type: 'string' },
      version_no: { type: 'integer', minimum: 1 },
      message: { type: 'string', description: 'Optional note for the history.' },
    },
    required: ['artifact_id', 'version_no'],
  },
  async execute(ctx, input) {
    const id = artifactId(input);
    const no = versionNo(input.version_no);
    if (!id || !no) return { error: 'Tell me the page and the version number.' };
    const access = await resolveArtifactAccessForUser(ctx.env, id, ctx.userId);
    if (!access) return NO_ACCESS;
    if (access.role !== 'owner' && access.role !== 'editor') return { error: 'Only the page’s owner or an editor can bring back an old version.' };
    const message = typeof input.message === 'string' ? input.message.trim().slice(0, 500) : '';
    return propose({ kind: 'version_restore', artifactId: id, artifactName: await nameOf(ctx, id), versionNo: no, ...(message ? { message } : {}) });
  },
};

export const approveVersionTool: AccountTool = {
  name: 'approve_version',
  description: 'Record the user’s approval of a version of a page (the live one unless version_no is given); approved: false withdraws it. A record in the history, not a publish gate. Asks the user to confirm first.',
  input_schema: {
    type: 'object',
    properties: { artifact_id: { type: 'string' }, version_no: { type: 'integer', minimum: 1 }, approved: { type: 'boolean' } },
    required: ['artifact_id'],
  },
  async execute(ctx, input) {
    const id = artifactId(input);
    if (!id) return { error: 'Missing artifact_id.' };
    if (!(await resolveArtifactAccessForUser(ctx.env, id, ctx.userId))) return NO_ACCESS;
    return propose({ kind: 'version_approve', artifactId: id, artifactName: await nameOf(ctx, id), versionNo: versionNo(input.version_no), approved: input.approved !== false });
  },
};

export const resolveCommentTool: AccountTool = {
  name: 'resolve_comment',
  description: 'Resolve a comment thread on a page (resolved: false reopens it). Get comment_id from list_comments. Asks the user to confirm first.',
  input_schema: {
    type: 'object',
    properties: { artifact_id: { type: 'string' }, comment_id: { type: 'string' }, resolved: { type: 'boolean' } },
    required: ['artifact_id', 'comment_id'],
  },
  async execute(ctx, input) {
    const id = artifactId(input);
    const commentId = typeof input.comment_id === 'string' ? input.comment_id.trim() : '';
    if (!id || !commentId) return { error: 'Tell me the page and the comment.' };
    if (!(await resolveArtifactAccessForUser(ctx.env, id, ctx.userId))) return NO_ACCESS;
    const excerpt = await threadExcerpt(ctx, id, commentId);
    if (excerpt === null) return { error: 'That comment thread isn’t on this page.' };
    return propose({ kind: 'comment_resolve', artifactId: id, artifactName: await nameOf(ctx, id), commentId, excerpt, resolved: input.resolved !== false });
  },
};

export const assignCommentTool: AccountTool = {
  name: 'assign_comment',
  description: 'Assign a comment thread to someone on the page by email (owner, workspace member or collaborator) — they are notified. assignee null clears it. Asks the user to confirm first.',
  input_schema: {
    type: 'object',
    properties: { artifact_id: { type: 'string' }, comment_id: { type: 'string' }, assignee: { type: ['string', 'null'] } },
    required: ['artifact_id', 'comment_id'],
  },
  async execute(ctx, input) {
    const id = artifactId(input);
    const commentId = typeof input.comment_id === 'string' ? input.comment_id.trim() : '';
    if (!id || !commentId) return { error: 'Tell me the page and the comment.' };
    const assignee = typeof input.assignee === 'string' && input.assignee.trim() ? input.assignee.trim().toLowerCase().slice(0, 320) : null;
    if (assignee && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(assignee)) return { error: 'That doesn’t look like an email.' };
    if (!(await resolveArtifactAccessForUser(ctx.env, id, ctx.userId))) return NO_ACCESS;
    const excerpt = await threadExcerpt(ctx, id, commentId);
    if (excerpt === null) return { error: 'That comment thread isn’t on this page.' };
    return propose({ kind: 'comment_assign', artifactId: id, artifactName: await nameOf(ctx, id), commentId, excerpt, assignee });
  },
};
