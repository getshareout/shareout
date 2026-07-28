import type { Env } from '../types';
import { getSessionUser } from '../auth';
import { validateToken } from '../api-auth';
import { isSuperAdminEmail, rosterIsEmpty, SUPERADMIN_EMAILS } from './recipients';

export { isSuperAdminEmail, SUPERADMIN_EMAILS };

export interface SuperAdmin {
  id: string;
  email: string;
}

/** First-boot: empty roster + no SETUP_ADMIN_EMAIL ⇒ earliest user is admin. */
async function isFirstUserAdmin(env: Env, userId: string): Promise<boolean> {
  if (!rosterIsEmpty(env)) return false;
  if (env.SETUP_ADMIN_EMAIL?.trim()) return false;
  try {
    const first = await env.DB.prepare(
      `SELECT id FROM users ORDER BY created_at ASC LIMIT 1`,
    ).first<{ id: string }>();
    return first?.id === userId;
  } catch {
    return false;
  }
}

export async function isPlatformAdmin(env: Env, email: string | null | undefined, userId?: string): Promise<boolean> {
  if (isSuperAdminEmail(email, env)) return true;
  if (userId && (await isFirstUserAdmin(env, userId))) return true;
  return false;
}

// Require a platform owner, from either a browser session or a personal API token.
// Returns null when neither identifies an owner — callers decide page vs JSON.
//
// The token path exists so an agent can configure an instance it just deployed: the
// whole point of /v1/admin/instance is to tell an operator what is unset, and until
// now only a browser could read it.
//
// Service-account tokens are deliberately refused. An `sot_` token is issued to a
// workspace agent with a declared, narrow scope; honouring it here would let a
// workspace-level credential provision workspaces and read instance configuration —
// a privilege escalation, not a convenience. Personal `so_` tokens already carry the
// full authority of the human who created them, so accepting one grants nothing the
// holder could not do by signing in.
export async function requireSuperAdmin(
  request: Request,
  env: Env
): Promise<SuperAdmin | null> {
  const user = await getSessionUser(request, env);
  if (user) {
    if (!(await isPlatformAdmin(env, user.email, user.id))) return null;
    return { id: user.id, email: user.email };
  }
  const tokenUser = await validateToken(request, env);
  if (!tokenUser || tokenUser.service) return null;
  if (!(await isPlatformAdmin(env, tokenUser.email, tokenUser.id))) return null;
  return { id: tokenUser.id, email: tokenUser.email || '' };
}
