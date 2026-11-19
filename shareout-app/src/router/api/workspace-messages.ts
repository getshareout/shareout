import type { FetchContext } from '../context';
import type { AuthUser } from '../../api-auth';
import { isAuthUser, requireTokenOrSession } from '../helpers/auth-guard';
import { json } from '../../workspaces/json-response';
import { getInternalWorkspaceRole } from '../../workspaces/roles';
import {
  findThread, listMessageablePeople, listMessages, listThreads, markThreadRead, resolveRecipient, unreadCount,
  type MessageError,
} from '../../messages/store';
import { sendAndNotify } from '../../messages/send';

// Direct messages between internal members of a workspace (src/messages). Session or personal
// token; workspace agent (`sot_`) tokens are refused by the guard: a message is from a person.
//
//   GET  /v1/workspaces/{ws}/messages                  conversations (?unread=1, ?limit) + unread total
//   POST /v1/workspaces/{ws}/messages                  send {to, text, artifact_id?} — to = name, email or user id
//   GET  /v1/workspaces/{ws}/messages/unread           { unread } for a badge
//   GET  /v1/workspaces/{ws}/messages/people           who you can write to
//   GET  /v1/workspaces/{ws}/messages/with/{userId}    one conversation (?before, ?limit)
//   POST /v1/workspaces/{ws}/messages/with/{userId}/read   mark it read

const errorJson = (e: MessageError) =>
  new Response(JSON.stringify({ success: false, error: e.message, code: e.code, ...(e.candidates ? { candidates: e.candidates } : {}) }), {
    status: e.status, headers: { 'Content-Type': 'application/json' },
  });

const viaOf = (request: Request) => (/^Bearer\s+\S/i.test(request.headers.get('authorization') || '') ? 'api' : 'web');

export async function routeWorkspaceMessages(ctx: FetchContext): Promise<Response | null> {
  const { request, env, path, addCORS } = ctx;
  const m = path.match(/^\/v1\/workspaces\/([^/]+)\/messages(\/.*)?$/);
  if (!m) return null;
  const workspaceId = decodeURIComponent(m[1]!);
  const sub = (m[2] || '').replace(/\/$/, '');

  const user = await requireTokenOrSession(ctx);
  if (!isAuthUser(user)) return user;
  // Not an internal member: stay vague (don't confirm the workspace exists).
  if (!(await getInternalWorkspaceRole(env, workspaceId, user.id))) {
    return addCORS(json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403));
  }
  const res = await handle(ctx, user, workspaceId, sub);
  return res ? addCORS(res) : null;
}

async function handle(ctx: FetchContext, user: AuthUser, workspaceId: string, sub: string): Promise<Response | null> {
  const { request, env } = ctx;
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get('limit')) || undefined;

  if (sub === '' && request.method === 'GET') {
    const [threads, unread] = await Promise.all([
      listThreads(env, workspaceId, user.id, { limit, unreadOnly: url.searchParams.get('unread') === '1' }),
      unreadCount(env, workspaceId, user.id),
    ]);
    return json({ threads, unread });
  }

  if (sub === '' && request.method === 'POST') {
    let body: { to?: unknown; text?: unknown; artifact_id?: unknown };
    try { body = await request.json(); } catch { return json({ error: 'Body must be JSON: {"to": "…", "text": "…"}', code: 'INVALID_JSON' }, 400); }
    if (typeof body?.to !== 'string' || typeof body?.text !== 'string') {
      return json({ error: 'Send {"to": "<name, email or user id>", "text": "<message>"}', code: 'VALIDATION_ERROR' }, 400);
    }
    if (body.artifact_id != null && typeof body.artifact_id !== 'string') {
      return json({ error: 'artifact_id must be a string', code: 'VALIDATION_ERROR' }, 400);
    }
    const who = await resolveRecipient(env, workspaceId, user.id, body.to);
    if (!who.ok) return errorJson(who);
    const sent = await sendAndNotify(env, {
      workspaceId, senderId: user.id, recipientId: who.person.id, body: body.text,
      artifactId: (body.artifact_id as string | undefined) ?? null, via: viaOf(request),
    }, ctx.executionCtx ? (p) => ctx.executionCtx!.waitUntil(p) : undefined);
    if (!sent.ok) return errorJson(sent);
    return json({ message: sent.message, thread_id: sent.threadId, recipient: sent.recipient }, 201);
  }

  if (sub === '/unread' && request.method === 'GET') {
    return json({ unread: await unreadCount(env, workspaceId, user.id) });
  }

  if (sub === '/people' && request.method === 'GET') {
    return json({ people: await listMessageablePeople(env, workspaceId, user.id) });
  }

  const withMatch = sub.match(/^\/with\/([^/]+)(\/read)?$/);
  if (withMatch) {
    const otherId = decodeURIComponent(withMatch[1]!);
    if (withMatch[2] && request.method === 'POST') {
      const thread = await findThread(env, workspaceId, user.id, { withUserId: otherId });
      if (thread) await markThreadRead(env, thread.id, user.id);
      return json({ success: true });
    }
    if (!withMatch[2] && request.method === 'GET') {
      const thread = await findThread(env, workspaceId, user.id, { withUserId: otherId });
      if (thread) {
        const messages = await listMessages(env, thread.id, user.id, { limit, before: url.searchParams.get('before') || undefined });
        return json({ thread_id: thread.id, with: thread.with, messages });
      }
      // No conversation yet: say who it would be with, so a new one can open.
      const people = await listMessageablePeople(env, workspaceId, user.id);
      const person = people.find((p) => p.id === otherId);
      if (!person) return json({ error: 'That person is not a member of this workspace.', code: 'RECIPIENT_NOT_FOUND' }, 404);
      return json({ thread_id: null, with: person, messages: [] });
    }
  }

  return null;
}
