import { errorResponse, type DataContext } from '../middleware';
import { verifySessionToken, extractTokenFromCookie } from '../../token';
import type { CommentsConfig } from './types';

export interface CommentSession {
  userId: string;
  email: string;
  name?: string;
}

/** Resolve the signed-in user from the shareout_session cookie, if any. */
export async function getSession(
  request: Request,
  ctx: DataContext,
): Promise<CommentSession | null> {
  const cookies = request.headers.get('Cookie');
  const token = extractTokenFromCookie(cookies, /shareout_session=([^;]+)/);
  if (!token) return null;

  const payload = await verifySessionToken(token, ctx.env);
  if (!payload) return null;

  let name = payload.email;
  try {
    const u = await ctx.env.DB.prepare('SELECT name FROM users WHERE id = ?')
      .bind(payload.userId).first<{ name: string | null }>();
    if (u?.name) name = u.name;
  } catch { /* fall back to email */ }

  return {
    userId: payload.userId,
    email: payload.email,
    name,
  };
}

/** Map identityMode + optional display name to author fields for a new comment. */
export async function validateIdentity(
  request: Request,
  ctx: DataContext,
  config: CommentsConfig,
  providedName?: string,
): Promise<{ authorId: string | null; authorName: string } | Response> {
  switch (config.identityMode) {
    case 'anonymous': {
      const session = await getSession(request, ctx);
      if (session) {
        return { authorId: session.userId, authorName: session.name || session.email };
      }
      return {
        authorId: null,
        authorName: providedName || 'Anonymous',
      };
    }

    case 'named': {
      const session = await getSession(request, ctx);
      if (session) {
        return { authorId: session.userId, authorName: session.name || session.email };
      }
      if (!providedName || providedName.trim().length === 0) {
        return errorResponse({ code: 'NAME_REQUIRED', message: 'Author name is required', status: 400 });
      }
      return {
        authorId: null,
        authorName: providedName.trim(),
      };
    }

    case 'authenticated': {
      const session = await getSession(request, ctx);
      if (!session) {
        return errorResponse({ code: 'AUTH_REQUIRED', message: 'Authentication required', status: 401 });
      }
      return {
        authorId: session.userId,
        authorName: session.name || session.email,
      };
    }

    default:
      return errorResponse({ code: 'INVALID_CONFIG', message: 'Invalid identity mode', status: 500 });
  }
}

/** True when the requester is the comment's original author. */
export async function checkIsAuthor(
  request: Request,
  ctx: DataContext,
  authorId: string | null,
): Promise<boolean> {
  if (!authorId) return false;

  const session = await getSession(request, ctx);
  if (!session) return false;

  return session.userId === authorId;
}
