import type { Env } from '../types';
import { createSessionToken } from '../token';
import { autoJoinWorkspacesByDomain } from '../workspaces';
import { buildSessionCookie } from './cookies';
import { getPlatformHostname } from '../config/origins';
import { verifyGoogleIdToken } from './google-id-token';
import { jsonResponse } from './json-response';
import { resolveSessionMaxAge } from './session';
import { upsertUser } from './users';

/** Sign in with Google One Tap (ID-token flow). */
export async function handleGoogleOneTap(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  let credential = '';
  try {
    const body = await request.json<{ credential?: string }>();
    credential = body.credential || '';
  } catch {
    return jsonResponse({ error: 'Invalid body' }, 400);
  }
  if (!credential) return jsonResponse({ error: 'Missing credential' }, 400);

  let claims;
  try {
    claims = await verifyGoogleIdToken(credential, env.GOOGLE_CLIENT_ID || "");
  } catch (err: any) {
    console.error('One Tap verification failed:', err?.message || err);
    return jsonResponse({ error: 'Invalid credential' }, 401);
  }

  const emailVerified = claims.email_verified === true || claims.email_verified === 'true';
  if (!claims.email || !emailVerified) {
    return jsonResponse({ error: 'Email not verified' }, 403);
  }

  const user = await upsertUser(env, {
    id: claims.sub,
    email: claims.email,
    name: claims.name || claims.email.split('@')[0],
    picture: claims.picture || '',
  });
  await autoJoinWorkspacesByDomain(env, user.id, user.email);
  const maxAge = await resolveSessionMaxAge(env, user.id);
  const sessionToken = await createSessionToken(user.id, user.email, env, maxAge);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': buildSessionCookie(url, sessionToken, maxAge, getPlatformHostname(env)),
    },
  });
}
