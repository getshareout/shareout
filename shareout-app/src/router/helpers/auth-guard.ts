import type { AuthUser } from '../../api-auth';
import { validateToken } from '../../api-auth';
import { getAuthUser } from '../../auth-user';
import { getSessionUser } from '../../auth';
import { unauthorized } from '../../cors';
import type { FetchContext } from '../context';

export function isAuthUser(result: AuthUser | Response): result is AuthUser {
  return !(result instanceof Response);
}

export async function requireToken(ctx: FetchContext): Promise<AuthUser | Response> {
  const user = await validateToken(ctx.request, ctx.env);
  if (!user) return ctx.addCORS(unauthorized());
  return user;
}

export async function requireAuthUser(ctx: FetchContext): Promise<AuthUser | Response> {
  const user = await getAuthUser(ctx.request, ctx.env);
  if (!user) return ctx.addCORS(unauthorized());
  return user;
}

export async function getTokenOrSessionUser(ctx: FetchContext): Promise<AuthUser | null> {
  let user = await validateToken(ctx.request, ctx.env);
  if (!user) {
    const sessionUser = await getSessionUser(ctx.request, ctx.env);
    if (sessionUser) {
      user = { id: sessionUser.id, email: sessionUser.email, username: null };
    }
  }
  return user;
}

export async function requireTokenOrSession(ctx: FetchContext): Promise<AuthUser | Response> {
  const user = await getTokenOrSessionUser(ctx);
  if (!user) return ctx.addCORS(unauthorized());
  return user;
}
