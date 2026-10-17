import { errorResponse, type DataContext } from '../middleware';
import { extractTokenFromCookie } from '../../token';
import { verifyLiveSessionToken } from '../../auth/session';
import { validateToken } from '../../api-auth';
import type { CommentsConfig } from './types';
import { guestCommentsOpen, resolveGuest, type GuestIdentity } from './guest';

export interface CommentSession {
  userId: string;
  email: string;
  name?: string;
}

/** Resolve the signed-in user from a Bearer API token or the shareout_session cookie, if any. */
export async function getSession(
  request: Request,
  ctx: DataContext,
): Promise<CommentSession | null> {
  const apiUser = await validateToken(request, ctx.env);
  let payload: { userId: string; email: string } | null = null;
  if (apiUser) {
    payload = { userId: apiUser.id, email: apiUser.email ?? apiUser.username ?? apiUser.id };
  } else {
    const token = extractTokenFromCookie(request.headers.get('Cookie'), /shareout_session=([^;]+)/);
    if (!token) return null;
    payload = await verifyLiveSessionToken(token, ctx.env);
  }
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

export interface CommentIdentity {
  authorId: string | null;
  authorName: string;
  /** Set when the author is a verified guest (no account). */
  guest?: GuestIdentity;
}

/**
 * Map identityMode + optional display name to author fields for a new comment.
 * A signed-in session always wins. With guest comments open on this artifact, a
 * verified guest token is an identity in every mode, and it is REQUIRED of anyone
 * without an account unless the mode is 'anonymous'.
 */
export async function validateIdentity(
  request: Request,
  ctx: DataContext,
  config: CommentsConfig,
  providedName?: string,
): Promise<CommentIdentity | Response> {
  const session = await getSession(request, ctx);
  if (session) return { authorId: session.userId, authorName: session.name || session.email };

  // A space guest comments as the identity it already verified for the space — no second
  // email code — but only with a 'comment' grant.
  const sg = ctx.spaceGuest;
  if (sg) {
    if (sg.capability !== 'comment') {
      return errorResponse({ code: 'FORBIDDEN', message: 'You can view this space but not comment on it', status: 403 });
    }
    return { authorId: null, authorName: sg.name, guest: { name: sg.name, emailHash: sg.emailHash, key: `${ctx.artifactId}:${sg.emailHash}` } };
  }

  if (await guestCommentsOpen(request, ctx, config)) {
    const guest = await resolveGuest(request, ctx);
    if (guest) return { authorId: null, authorName: guest.name, guest };
    if (config.identityMode !== 'anonymous') {
      return errorResponse({ code: 'GUEST_VERIFICATION_REQUIRED', message: 'Confirm your email to comment as a guest', status: 401 });
    }
  }

  switch (config.identityMode) {
    case 'anonymous':
      return { authorId: null, authorName: providedName || 'Anonymous' };

    case 'named': {
      if (!providedName || providedName.trim().length === 0) {
        return errorResponse({ code: 'NAME_REQUIRED', message: 'Author name is required', status: 400 });
      }
      return { authorId: null, authorName: providedName.trim() };
    }

    case 'authenticated':
      return errorResponse({ code: 'AUTH_REQUIRED', message: 'Authentication required', status: 401 });

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
