// Confirmed review writes from a chat surface: restore a version, approve one, resolve or
// assign a comment. Each runs the same handler / domain function as its REST route and MCP
// tool, as the linked user, so the editor / comment-access gates apply unchanged.
import type { Env } from '../types';
import type { PendingAction } from './actions';
import { handleRestoreVersion } from '../artifacts/versions';
import { setApproval, setCommentAssignee, setCommentResolved } from '../pages/home/queries/review';

type ReviewAction = Extract<PendingAction, { kind: 'version_restore' | 'version_approve' | 'comment_resolve' | 'comment_assign' }>;

const DENIED: Record<ReviewAction['kind'], string> = {
  version_restore: 'Only the page’s owner or an editor can bring back an old version.',
  version_approve: 'You need comment access to this page to approve a version.',
  comment_resolve: 'You need comment access to this page to resolve comments.',
  comment_assign: 'You need comment access to this page to assign comments.',
};

export async function executeReviewAction(env: Env, userId: string, a: ReviewAction): Promise<string> {
  const row = await env.DB.prepare('SELECT email, name FROM users WHERE id = ?').bind(userId).first<{ email: string | null; name: string | null }>();
  const user = { id: userId, email: row?.email ?? null, name: row?.name ?? null, username: null };
  const failed = (status: number, message: string) => (status === 403 ? DENIED[a.kind] : `Couldn’t do that: ${message}.`);

  switch (a.kind) {
    case 'version_restore': {
      const res = await handleRestoreVersion(
        new Request(`https://internal/v1/artifacts/${a.artifactId}/versions/${a.versionNo}/restore`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(a.message ? { message: a.message } : {}),
        }),
        env, user, a.artifactId, a.versionNo,
      );
      const body = (await res.json().catch(() => ({}))) as { version_no?: number; staged?: boolean; error?: string };
      if (!res.ok) return failed(res.status, body.error ?? `HTTP ${res.status}`);
      return `Done — version ${a.versionNo} is back as version ${body.version_no ?? '?'}.${body.staged ? ' It goes live once the page’s checks pass.' : ''}`;
    }
    case 'version_approve': {
      const versionId = a.versionNo === null ? null
        : (await env.DB.prepare('SELECT id FROM versions WHERE artifact_id = ? AND version_no = ?').bind(a.artifactId, a.versionNo).first<{ id: string }>())?.id ?? 'ver_unknown';
      const r = await setApproval(env, user, a.artifactId, versionId, a.approved);
      if (!r.ok) return failed(r.status, r.message);
      return a.approved ? 'Done — approved.' : 'Done — approval withdrawn.';
    }
    case 'comment_resolve': {
      const r = await setCommentResolved(env, user, a.artifactId, a.commentId, a.resolved);
      if (!r.ok) return failed(r.status, r.message);
      return a.resolved ? 'Done — comment resolved.' : 'Done — comment reopened.';
    }
    case 'comment_assign': {
      const r = await setCommentAssignee(env, user, a.artifactId, a.commentId, a.assignee);
      if (!r.ok) return r.code === 'ASSIGNEE_NOT_FOUND' ? `${a.assignee} isn’t on this page, so the comment can’t be assigned to them.` : failed(r.status, r.message);
      return r.data.assignee_email ? `Done — assigned to ${r.data.assignee_email}.` : 'Done — unassigned.';
    }
  }
}
