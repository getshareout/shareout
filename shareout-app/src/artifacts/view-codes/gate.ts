// The one-time view gate (auth_method 'onetime'): redeem a code, hold a pass for exactly
// the code's window, log what the viewer tried while it was open.
import type { Env } from '../../types';
import { createAccessToken, verifyAccessToken, extractTokenFromCookie } from '../../token';
import { artifactLocation } from '../../auth/artifact-auth';
import { viewCodeLoginPage } from '../../auth/pages';
import { cookieSecureAttr } from '../../auth/cookies';
import { pageLocale } from '../../i18n/accept-language';
import { checkViewCodeGateLimit, rateLimitHeaders } from '../../rate-limit';
import {
  deviceClass, getLiveViewCode, isViewCodeEventKind, recordViewCodeEvent, redeemViewCode,
  type LiveViewCode,
} from './store';

import { VIEW_PASS_PREFIX } from './tokens';

export { VIEW_PASS_PREFIX };

const passCookieName = (artifactId: string) => `shareout_access_${artifactId}`;

/** The live code behind this request's pass, or null (no pass, expired, revoked). */
export async function readViewPass(request: Request, env: Env, artifactId: string): Promise<LiveViewCode | null> {
  const token = extractTokenFromCookie(request.headers.get('Cookie'), new RegExp(`${passCookieName(artifactId)}=([^;]+)`));
  if (!token) return null;
  const payload = await verifyAccessToken(token, artifactId, env);
  if (!payload || !payload.authType.startsWith(VIEW_PASS_PREFIX)) return null;
  return getLiveViewCode(env, artifactId, payload.authType.slice(VIEW_PASS_PREFIX.length));
}

/** POST /auth/view-code — form: slug, artifact_id, code. */
export async function handleViewCodeAuth(request: Request, env: Env): Promise<Response> {
  const form = await request.formData().catch(() => null);
  const slug = form?.get('slug');
  const artifactId = form?.get('artifact_id');
  const code = form?.get('code');
  if (typeof slug !== 'string' || !slug || typeof artifactId !== 'string' || !artifactId || typeof code !== 'string') {
    return new Response('Bad Request', { status: 400 });
  }
  const artifact = await env.DB.prepare('SELECT id, auth_method FROM artifacts WHERE id = ?')
    .bind(artifactId).first<{ id: string; auth_method: string | null }>();
  if (!artifact || artifact.auth_method !== 'onetime') return new Response('Not Found', { status: 404 });

  const lang = pageLocale(request);
  const rl = await checkViewCodeGateLimit(env, request, artifact.id);
  if (!rl.allowed) {
    const page = viewCodeLoginPage(slug, artifact.id, lang, 'throttled', 429);
    return new Response(page.body, { status: 429, headers: { ...Object.fromEntries(page.headers), ...rateLimitHeaders(rl) } });
  }

  const result = await redeemViewCode(env, artifact.id, code, deviceClass(request.headers.get('User-Agent')));
  if (!result.ok) return viewCodeLoginPage(slug, artifact.id, lang, result.reason);

  const seconds = Math.max(1, Math.ceil((Date.parse(result.openedAt) + result.viewSeconds * 1000 - Date.now()) / 1000));
  const pass = await createAccessToken(artifact.id, `${VIEW_PASS_PREFIX}${result.codeId}`, env, seconds);
  const url = new URL(request.url);
  return new Response(null, {
    status: 302,
    headers: {
      Location: artifactLocation(request, slug, env),
      'Set-Cookie': `${passCookieName(artifact.id)}=${pass}; Path=/; HttpOnly;${cookieSecureAttr(url)} SameSite=Lax; Max-Age=${seconds}`,
      'Cache-Control': 'no-store',
    },
  });
}

/** POST /auth/view-code/event — `{ artifact_id, kind }` from the open page (sendBeacon). */
export async function handleViewCodeEvent(request: Request, env: Env): Promise<Response> {
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return new Response(null, { status: 403 });
  let body: { artifact_id?: unknown; kind?: unknown };
  try { body = JSON.parse(await request.text()); } catch { return new Response(null, { status: 400 }); }
  if (typeof body.artifact_id !== 'string' || !isViewCodeEventKind(body.kind)) return new Response(null, { status: 400 });
  const live = await readViewPass(request, env, body.artifact_id);
  if (!live) return new Response(null, { status: 403 });
  await recordViewCodeEvent(env, live.id, body.kind);
  return new Response(null, { status: 204 });
}
