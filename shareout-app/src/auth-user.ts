import type { Env } from './types';
import { validateToken, type AuthUser } from './api-auth';
import { getSessionUser } from './auth';

export async function getAuthUser(request: Request, env: Env): Promise<AuthUser | null> {
  let user = await validateToken(request, env);
  if (!user) {
    const sessionUser = await getSessionUser(request, env);
    if (sessionUser) {
      user = { id: sessionUser.id, email: sessionUser.email, username: null };
    }
  }
  return user;
}
