import type { Env } from '../../types';
import { DATA_ERRORS } from '../../types';
import { validateToken } from '../../api-auth';
import { verifyLiveSessionToken } from '../../auth/session';
import { extractTokenFromCookie } from '../../token';
import { getInternalWorkspaceRole } from '../../workspaces/roles';
import { errorResponse, successResponse, corsHeaders, resolveRequesterUserId, type DataContext } from '../middleware';
import { resolveGenericConnection } from './resolve';
import type { ResolvedGenericConnection } from './types';

export function consentUrl(origin: string, artifactId: string, connectionName: string): string {
  return `${origin}/connect-consent?artifact=${encodeURIComponent(artifactId)}&connection=${encodeURIComponent(connectionName)}`;
}

export async function hasConnectionConsent(env: Env, userId: string, artifactId: string, connectionId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    'SELECT 1 AS ok FROM connection_consents WHERE user_id = ? AND artifact_id = ? AND connection_id = ?',
  ).bind(userId, artifactId, connectionId).first();
  return !!row;
}

export async function setConnectionConsent(env: Env, userId: string, artifactId: string, connectionId: string, granted: boolean): Promise<void> {
  await (granted
    ? env.DB.prepare('INSERT OR IGNORE INTO connection_consents (user_id, artifact_id, connection_id) VALUES (?, ?, ?)')
    : env.DB.prepare('DELETE FROM connection_consents WHERE user_id = ? AND artifact_id = ? AND connection_id = ?')
  ).bind(userId, artifactId, connectionId).run();
}

/** A viewer's per-user credentials driven by someone else's page need that viewer's consent. */
export async function requireConnectionConsent(
  request: Request,
  ctx: DataContext,
  name: string,
): Promise<Response | null> {
  const conn = await resolveGenericConnection(ctx.env, ctx.artifactId, name);
  if (conn?.credential_scope !== 'per_user') return null;
  const userId = await resolveRequesterUserId(request, ctx);
  if (!userId || userId === ctx.artifact.owner_id) return null;
  if (await hasConnectionConsent(ctx.env, userId, ctx.artifactId, conn.id)) return null;
  const url = consentUrl(new URL(request.url).origin, ctx.artifactId, name);
  return Response.json({
    success: false,
    error: 'Approve this page to use your own connector credentials',
    code: 'CONSENT_REQUIRED',
    hint: 'Open consent_url while signed in to ShareOut, approve, then retry.',
    consent_url: url,
    redirect_url: url,
  }, { status: 403, headers: corsHeaders(ctx.origin) });
}

async function resolveSignedInUserId(request: Request, env: Env): Promise<{ id: string; cookie: boolean } | null> {
  const apiUser = await validateToken(request, env);
  if (apiUser) return { id: apiUser.id, cookie: false };
  const token = extractTokenFromCookie(request.headers.get('Cookie'), /shareout_session=([^;]+)/);
  const payload = token ? await verifyLiveSessionToken(token, env, request) : null;
  return payload?.userId ? { id: payload.userId, cookie: true } : null;
}

export interface ConsentTarget {
  conn: ResolvedGenericConnection;
  artifact: { id: string; name: string; owner: string | null };
}

/** The per-user connector `name` on `artifactId`, only when `userId` is an internal member of its workspace. */
export async function loadConsentTarget(env: Env, artifactId: string, name: string, userId: string): Promise<ConsentTarget | null> {
  const art = await env.DB.prepare(
    `SELECT a.id, a.name, a.workspace_id, COALESCE(u.name, u.email) AS owner
       FROM artifacts a LEFT JOIN users u ON u.id = a.owner_id WHERE a.id = ?`,
  ).bind(artifactId).first<{ id: string; name: string; workspace_id: string | null; owner: string | null }>();
  if (!art?.workspace_id) return null;
  if (!(await getInternalWorkspaceRole(env, art.workspace_id, userId))) return null;
  const conn = await resolveGenericConnection(env, artifactId, name);
  if (conn?.credential_scope !== 'per_user') return null;
  return { conn, artifact: { id: art.id, name: art.name, owner: art.owner } };
}

export async function handleConsent(request: Request, ctx: DataContext, name: string): Promise<Response> {
  const method = request.method;
  if (method !== 'GET' && method !== 'POST' && method !== 'DELETE') return errorResponse(DATA_ERRORS.NOT_FOUND, ctx.origin);

  const who = await resolveSignedInUserId(request, ctx.env);
  if (!who) return errorResponse(DATA_ERRORS.UNAUTHORIZED, ctx.origin);
  if (who.cookie && method !== 'GET') {
    const site = request.headers.get('Sec-Fetch-Site');
    const sameOrigin = site ? site === 'same-origin' : request.headers.get('Origin') === new URL(request.url).origin;
    if (!sameOrigin) return errorResponse(DATA_ERRORS.FORBIDDEN, ctx.origin);
  }

  const target = await loadConsentTarget(ctx.env, ctx.artifactId, name, who.id);
  if (!target) return errorResponse(DATA_ERRORS.NOT_FOUND, ctx.origin);

  if (method === 'GET') {
    return successResponse({
      consented: await hasConnectionConsent(ctx.env, who.id, ctx.artifactId, target.conn.id),
      consent_url: consentUrl(new URL(request.url).origin, ctx.artifactId, name),
    }, 200, ctx.origin);
  }
  await setConnectionConsent(ctx.env, who.id, ctx.artifactId, target.conn.id, method === 'POST');
  return successResponse({ consented: method === 'POST' }, 200, ctx.origin);
}
