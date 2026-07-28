import { successResponse, errorResponse, type DataContext } from '../middleware';
import { getSession } from './auth';

/** GET `/_unread` — count of comments since the viewer's last read timestamp. */
export async function handleUnread(request: Request, ctx: DataContext): Promise<Response> {
  const session = await getSession(request, ctx);
  if (!session) return successResponse({ count: 0 });

  const read = await ctx.env.DB.prepare(
    'SELECT last_read_at FROM comment_reads WHERE user_id = ? AND artifact_id = ?'
  ).bind(session.userId, ctx.artifactId).first<{ last_read_at: string }>();
  const since = read?.last_read_at ?? '1970-01-01T00:00:00Z';

  const row = await ctx.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM artifact_comments
      WHERE artifact_id = ? AND created_at > ? AND (author_id IS NULL OR author_id != ?)`
  ).bind(ctx.artifactId, since, session.userId).first<{ n: number }>();

  return successResponse({ count: Number(row?.n ?? 0) });
}

/** POST `/_read` — mark all comments as read for the signed-in viewer. */
export async function handleMarkRead(request: Request, ctx: DataContext): Promise<Response> {
  if (request.method !== 'POST') {
    return errorResponse({ code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed', status: 405 });
  }
  const session = await getSession(request, ctx);
  if (!session) return successResponse({ ok: true });

  const now = new Date().toISOString();
  await ctx.env.DB.prepare(
    `INSERT INTO comment_reads (user_id, artifact_id, last_read_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id, artifact_id) DO UPDATE SET last_read_at = excluded.last_read_at`
  ).bind(session.userId, ctx.artifactId, now).run();

  return successResponse({ ok: true, lastReadAt: now });
}
