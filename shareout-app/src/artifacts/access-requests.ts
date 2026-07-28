/**
 * Access requests — viewers ask artifact owners for permission (Google Drive style).
 */
import type { Env } from '../types';
import type { AuthUser } from '../api-auth';
import { generateId } from '../crypto-utils';
import { addCollaboratorEmails } from './collaborators';
import { isArtifactSharingAdmin } from './roles';
import { json } from './json-response';
import { getLinkedChatId } from '../telegram/linking';
import { dispatchLifecycleEmail } from '../email/gateway';
import { sendMessageWithButtons, answerCallbackQuery, editMessageText } from '../telegram/client';
import { getPlatformOrigin } from '../config/origins';

export type AccessRequestStatus = 'pending' | 'approved' | 'denied';

export interface AccessRequestRow {
  id: string;
  artifact_id: string;
  requester_user_id: string;
  requester_email: string;
  requester_name: string | null;
  status: AccessRequestStatus;
  created_at: string;
}

export interface IncomingAccessRequest {
  id: string;
  artifact_id: string;
  artifact_name: string;
  artifact_slug: string;
  requester_email: string;
  requester_name: string | null;
  created_at: string;
}

async function resolveArtifactBySlug(env: Env, slug: string): Promise<{
  id: string;
  name: string;
  owner_id: string;
  visibility: string;
} | null> {
  const row = await env.DB.prepare(`
    SELECT a.id, a.name, a.owner_id, a.visibility
    FROM deployments d
    JOIN artifacts a ON a.id = d.artifact_id
    WHERE d.slug = ? AND d.channel = 'production'
    LIMIT 1
  `).bind(slug).first<{ id: string; name: string; owner_id: string; visibility: string }>();
  return row ?? null;
}

export async function getPendingAccessRequest(
  env: Env,
  artifactId: string,
  requesterUserId: string,
): Promise<AccessRequestRow | null> {
  return env.DB.prepare(
    `SELECT id, artifact_id, requester_user_id, requester_email, requester_name, status, created_at
     FROM access_requests
     WHERE artifact_id = ? AND requester_user_id = ? AND status = 'pending'
     LIMIT 1`
  ).bind(artifactId, requesterUserId).first<AccessRequestRow>();
}

export async function listIncomingAccessRequests(
  env: Env,
  ownerUserId: string,
): Promise<IncomingAccessRequest[]> {
  // Owner's own artifacts, plus every artifact in a workspace they administer —
  // otherwise a request against a departed member's page sits in a queue nobody
  // can see. Matches who decideAccessRequest lets answer.
  const rows = await env.DB.prepare(`
    SELECT ar.id, ar.artifact_id, ar.requester_email, ar.requester_name, ar.created_at,
           a.name AS artifact_name, a.slug AS artifact_slug
    FROM access_requests ar
    JOIN artifacts a ON a.id = ar.artifact_id
    WHERE ar.status = 'pending'
      AND ( a.owner_id = ?1
         OR a.workspace_id IN (
              SELECT workspace_id FROM workspace_members
               WHERE user_id = ?1 AND member_class = 'internal' AND role IN ('owner','admin')
            ) )
    ORDER BY ar.created_at DESC
    LIMIT 20
  `).bind(ownerUserId).all<IncomingAccessRequest>();
  return rows.results ?? [];
}

async function notifyOwnerOfAccessRequest(
  env: Env,
  request: AccessRequestRow,
  artifact: { id: string; name: string; owner_id: string },
  requesterLabel: string,
): Promise<void> {
  const baseUrl = getPlatformOrigin(env);

  const chatId = await getLinkedChatId(env, artifact.owner_id);
  if (!chatId) {
    // No Telegram link — fall back to email so the owner still hears about it.
    await dispatchLifecycleEmail(env, {
      type: 'access_request',
      toUserId: artifact.owner_id,
      data: { requesterEmail: requesterLabel, pageName: artifact.name, url: `${baseUrl}/home` },
    }).catch(() => {});
    return;
  }

  const text = `${requesterLabel} is requesting access to “${artifact.name}”.`;

  await sendMessageWithButtons(env, chatId, text, [
    [
      { text: 'Approve', callback_data: `ar:ok:${request.id}` },
      { text: 'Deny', callback_data: `ar:no:${request.id}` },
    ],
    [
      { text: 'Open in ShareOut', url: `${baseUrl}/home` },
    ],
  ]);
}

export async function createAccessRequestForSlug(
  env: Env,
  user: AuthUser,
  slug: string,
): Promise<{ ok: true; status: 'created' | 'pending' } | { ok: false; error: string; code: string; status: number }> {
  if (!user.email) {
    return { ok: false, error: 'Sign in with an email address to request access.', code: 'EMAIL_REQUIRED', status: 400 };
  }

  const artifact = await resolveArtifactBySlug(env, slug);
  if (!artifact) {
    return { ok: false, error: 'Page not found', code: 'NOT_FOUND', status: 404 };
  }

  if (artifact.visibility !== 'private' && artifact.visibility !== 'workspace') {
    return { ok: false, error: 'This page is already open to you.', code: 'NOT_PRIVATE', status: 400 };
  }

  if (artifact.owner_id === user.id) {
    return { ok: false, error: 'You already own this page.', code: 'IS_OWNER', status: 400 };
  }

  const existingCollab = await env.DB.prepare(
    'SELECT 1 FROM collaborators WHERE artifact_id = ? AND email = ?'
  ).bind(artifact.id, user.email).first();
  if (existingCollab) {
    return { ok: false, error: 'You already have access.', code: 'HAS_ACCESS', status: 400 };
  }

  const pending = await getPendingAccessRequest(env, artifact.id, user.id);
  if (pending) {
    return { ok: true, status: 'pending' };
  }

  // A denial has to stick for a while. The unique index only covers PENDING rows, so
  // without this the requester can re-ask the instant they're denied and re-ping the
  // owner's Telegram/inbox on a loop. Same shape as the already-asked answer so the
  // response never leaks the owner's decision.
  const recentlyDenied = await env.DB.prepare(
    `SELECT 1 FROM access_requests
      WHERE artifact_id = ? AND requester_user_id = ? AND status = 'denied'
        AND decided_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 days')
      LIMIT 1`
  ).bind(artifact.id, user.id).first();
  if (recentlyDenied) {
    return { ok: true, status: 'pending' };
  }

  const profile = await env.DB.prepare(
    'SELECT name FROM users WHERE id = ?'
  ).bind(user.id).first<{ name: string | null }>();

  const requestId = generateId('arq');
  const requesterName = profile?.name || user.email.split('@')[0];

  try {
    await env.DB.prepare(
      `INSERT INTO access_requests (id, artifact_id, requester_user_id, requester_email, requester_name)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(requestId, artifact.id, user.id, user.email.toLowerCase(), requesterName).run();
  } catch {
    const again = await getPendingAccessRequest(env, artifact.id, user.id);
    if (again) return { ok: true, status: 'pending' };
    return { ok: false, error: 'Could not send request. Try again.', code: 'REQUEST_FAILED', status: 500 };
  }

  const request: AccessRequestRow = {
    id: requestId,
    artifact_id: artifact.id,
    requester_user_id: user.id,
    requester_email: user.email.toLowerCase(),
    requester_name: requesterName,
    status: 'pending',
    created_at: new Date().toISOString(),
  };

  await notifyOwnerOfAccessRequest(env, request, artifact, requesterName);

  return { ok: true, status: 'created' };
}

export async function decideAccessRequest(
  env: Env,
  ownerUserId: string,
  requestId: string,
  action: 'approve' | 'deny',
): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await env.DB.prepare(`
    SELECT ar.id, ar.artifact_id, ar.requester_email, ar.requester_name, ar.status,
           a.name AS artifact_name, a.slug AS artifact_slug, a.owner_id
    FROM access_requests ar
    JOIN artifacts a ON a.id = ar.artifact_id
    WHERE ar.id = ?
  `).bind(requestId).first<{
    id: string;
    artifact_id: string;
    requester_email: string;
    requester_name: string | null;
    status: AccessRequestStatus;
    artifact_name: string;
    artifact_slug: string;
    owner_id: string;
  }>();

  if (!row) return { ok: false, error: 'Request not found.' };
  if (row.owner_id !== ownerUserId
      && !(await isArtifactSharingAdmin(env, row.artifact_id, ownerUserId))) {
    return { ok: false, error: 'Only the owner or a workspace admin can respond.' };
  }
  if (row.status !== 'pending') return { ok: false, error: 'This request was already handled.' };

  const now = new Date().toISOString();
  const baseUrl = getPlatformOrigin(env);

  if (action === 'deny') {
    await env.DB.prepare(
      `UPDATE access_requests SET status = 'denied', decided_by = ?, decided_at = ? WHERE id = ?`
    ).bind(ownerUserId, now, requestId).run();
    // Close the loop for the requester — they asked and deserve an answer.
    await dispatchLifecycleEmail(env, {
      type: 'access_declined',
      toEmail: row.requester_email,
      data: { pageName: row.artifact_name },
    }).catch(() => {});
    return { ok: true };
  }

  await addCollaboratorEmails(env, row.artifact_id, [row.requester_email], 'viewer', ownerUserId);
  await env.DB.prepare(
    `UPDATE access_requests SET status = 'approved', decided_by = ?, decided_at = ? WHERE id = ?`
  ).bind(ownerUserId, now, requestId).run();
  await dispatchLifecycleEmail(env, {
    type: 'access_approved',
    toEmail: row.requester_email,
    data: { pageName: row.artifact_name, url: `${baseUrl}/a/${encodeURIComponent(row.artifact_slug)}/` },
  }).catch(() => {});

  return { ok: true };
}

/** Telegram inline-keyboard handler for ar:ok / ar:no callbacks. */
export async function handleAccessRequestTelegramCallback(
  env: Env,
  userId: string,
  data: string,
  callbackId: string,
  chatId: number,
  messageId: number,
): Promise<boolean> {
  const [kind, decision, requestId] = data.split(':');
  if (kind !== 'ar' || !requestId || (decision !== 'ok' && decision !== 'no')) return false;

  const action = decision === 'ok' ? 'approve' : 'deny';
  const result = await decideAccessRequest(env, userId, requestId, action);

  if (!result.ok) {
    await answerCallbackQuery(env, callbackId, result.error);
    return true;
  }

  const row = await env.DB.prepare(`
    SELECT ar.requester_name, ar.requester_email, a.name AS artifact_name
    FROM access_requests ar
    JOIN artifacts a ON a.id = ar.artifact_id
    WHERE ar.id = ?
  `).bind(requestId).first<{ requester_name: string | null; requester_email: string; artifact_name: string }>();

  const who = row?.requester_name || row?.requester_email || 'The requester';
  const label = action === 'approve'
    ? `✅ Approved — ${who} can now view “${row?.artifact_name ?? 'the page'}”.`
    : `Denied — ${who} was not given access.`;

  await answerCallbackQuery(env, callbackId, action === 'approve' ? 'Access granted' : 'Request denied');
  await editMessageText(env, chatId, messageId, label);
  return true;
}

export async function handleCreateAccessRequest(
  request: Request,
  env: Env,
  user: AuthUser,
): Promise<Response> {
  let body: { slug?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400);
  }

  const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
  if (!slug) {
    return json({ error: 'slug is required', code: 'INVALID_SLUG' }, 400);
  }

  const result = await createAccessRequestForSlug(env, user, slug);
  if (!result.ok) {
    return json({ error: result.error, code: result.code }, result.status);
  }

  return json({
    ok: true,
    status: result.status,
    message: result.status === 'pending'
      ? 'You already requested access. The owner was notified.'
      : 'Access request sent. The owner will be notified.',
  });
}

export async function handleListIncomingAccessRequests(
  env: Env,
  user: AuthUser,
): Promise<Response> {
  const requests = await listIncomingAccessRequests(env, user.id);
  return json({ requests });
}

export async function handleDecideAccessRequest(
  request: Request,
  env: Env,
  user: AuthUser,
  requestId: string,
): Promise<Response> {
  let body: { action?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400);
  }

  const action = body.action === 'approve' || body.action === 'deny' ? body.action : null;
  if (!action) {
    return json({ error: 'action must be approve or deny', code: 'INVALID_ACTION' }, 400);
  }

  const result = await decideAccessRequest(env, user.id, requestId, action);
  if (!result.ok) {
    return json({ error: result.error, code: 'FORBIDDEN' }, 403);
  }

  return json({ ok: true, action });
}
