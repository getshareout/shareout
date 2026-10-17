import type { AuthUser } from '../../api-auth';
import { validateToken } from '../../api-auth';
import { unauthorizedFor } from '../../auth/unauthorized';
import { getSessionUser } from '../../auth/session';
import { simpleApiError } from '../../http/api-error';
import type { FetchContext } from '../context';

// Workspace Agent and external (`sot_`) tokens carry a one-workspace boundary and action
// scopes that only the artifact, publish, data and support routes enforce. Every other
// route treats them as no credential at all. A route that enforces that boundary itself
// opts in with { allowService: true } (see `allowingAgentTokens`).
export interface GuardOptions {
  allowService?: boolean;
}

export function isAuthUser(result: AuthUser | Response): result is AuthUser {
  return !(result instanceof Response);
}

async function bearerUser(ctx: FetchContext, opts?: GuardOptions): Promise<{ user: AuthUser | null; refusedService: boolean }> {
  const user = await validateToken(ctx.request, ctx.env);
  if (user?.service && !opts?.allowService) return { user: null, refusedService: true };
  return { user, refusedService: false };
}

async function sessionAuthUser(ctx: FetchContext): Promise<AuthUser | null> {
  const sessionUser = await getSessionUser(ctx.request, ctx.env);
  return sessionUser ? { id: sessionUser.id, email: sessionUser.email, username: null } : null;
}

async function refuse(ctx: FetchContext, refusedService: boolean): Promise<Response> {
  if (refusedService) {
    return ctx.addCORS(simpleApiError('Agent tokens cannot perform this action', 'INSUFFICIENT_SCOPE', 403));
  }
  return ctx.addCORS(await unauthorizedFor(ctx.request, ctx.env));
}

export async function requireToken(ctx: FetchContext, opts?: GuardOptions): Promise<AuthUser | Response> {
  const { user, refusedService } = await bearerUser(ctx, opts);
  return user ?? refuse(ctx, refusedService);
}

export async function getTokenOrSessionUser(ctx: FetchContext, opts?: GuardOptions): Promise<AuthUser | null> {
  const { user } = await bearerUser(ctx, opts);
  return user ?? sessionAuthUser(ctx);
}

export async function requireTokenOrSession(ctx: FetchContext, opts?: GuardOptions): Promise<AuthUser | Response> {
  const { user, refusedService } = await bearerUser(ctx, opts);
  const resolved = user ?? (await sessionAuthUser(ctx));
  return resolved ?? refuse(ctx, refusedService);
}

/** Same resolution as requireTokenOrSession; kept as its own name for existing callers. */
export async function requireAuthUser(ctx: FetchContext, opts?: GuardOptions): Promise<AuthUser | Response> {
  return requireTokenOrSession(ctx, opts);
}

/** The guards for routers that enforce `user.service` (workspace boundary + scopes) themselves. */
export const allowingAgentTokens = {
  requireToken: (ctx: FetchContext) => requireToken(ctx, { allowService: true }),
  requireTokenOrSession: (ctx: FetchContext) => requireTokenOrSession(ctx, { allowService: true }),
  requireAuthUser: (ctx: FetchContext) => requireAuthUser(ctx, { allowService: true }),
};
