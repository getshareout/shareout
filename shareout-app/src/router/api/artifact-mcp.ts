/**
 * Host-page endpoints for a page's MCP connections. Only the viewer page around the
 * artifact frame calls these, with the session cookie, same-origin: page code in
 * the sandbox can neither send that cookie nor pass the Sec-Fetch-Site check, so it
 * can't mint broker tokens or grant itself consent.
 *
 *   GET    /v1/artifacts/{id}/mcp/token    → short-lived broker token
 *   GET    /v1/artifacts/{id}/mcp/consent  → declared connections + this viewer's state
 *   POST   /v1/artifacts/{id}/mcp/consent  { connections: [name] } → allow
 *   DELETE /v1/artifacts/{id}/mcp/consent  ?connection=name (or all) → revoke
 */
import type { FetchContext } from '../context';
import type { Env } from '../../types';
import { getSessionUser } from '../../auth/session';
import { logAudit } from '../../audit';
import { jsonWithApiErrors } from '../../http/api-error';
import { hasUserConnectionCredentials } from '../../data/connections/user-credentials';
import { loadMcpConnectionByName } from '../../mcp-client/connection';
import { resolveMcpPage, type McpPageContext } from '../../mcp-broker/gate';
import { createMcpToken } from '../../mcp-broker/token';

const json = (data: unknown, status = 200) => {
  const res = jsonWithApiErrors(data, status);
  res.headers.set('Cache-Control', 'no-store');
  return res;
};

async function consentState(env: Env, page: McpPageContext, userId: string) {
  const { results } = await env.DB.prepare(
    'SELECT connection_id FROM artifact_mcp_consents WHERE artifact_id = ? AND user_id = ? AND capability_hash = ?',
  ).bind(page.artifactId, userId, page.capabilityHash).all<{ connection_id: string }>();
  const allowed = new Set(results.map((r) => r.connection_id));
  return Promise.all(page.capability.connections.map(async (declared) => {
    const conn = await loadMcpConnectionByName(env, page.workspaceId, declared.name);
    if (!conn) return { name: declared.name, tools: declared.tools, available: false, connected: false, allowed: false, connectionId: null };
    return {
      name: declared.name,
      tools: declared.tools,
      available: true,
      connectionId: conn.id,
      needsSignIn: conn.config.auth === 'oauth',
      connected: conn.config.auth === 'none' || await hasUserConnectionCredentials(env, conn.id, userId),
      allowed: allowed.has(conn.id),
    };
  }));
}

export async function routeArtifactMcpApi(ctx: FetchContext): Promise<Response | null> {
  const { request, env, path } = ctx;
  const match = path.match(/^\/v1\/artifacts\/([^/]+)\/mcp\/(token|consent)$/);
  if (!match) return null;
  const [, artifactId, action] = match;

  if (request.headers.get('Sec-Fetch-Site') !== 'same-origin') {
    return json({ error: 'Only the ShareOut page hosting this artifact can call this', code: 'FORBIDDEN' }, 403);
  }
  const user = await getSessionUser(request, env);
  if (!user) return json({ error: 'Sign in to use this page', code: 'UNAUTHORIZED' }, 401);

  const page = await resolveMcpPage(env, artifactId, user);
  if (page === 'not_found') return json({ error: 'Artifact not found', code: 'NOT_FOUND' }, 404);
  if (page === 'not_available') return json({ error: 'MCP connections are not available on this page', code: 'MCP_NOT_AVAILABLE' }, 403);
  if (page === 'not_allowed') return json({ error: 'Only members of this workspace can use its MCP connections', code: 'FORBIDDEN' }, 403);

  if (action === 'token' && request.method === 'GET') {
    return json(await createMcpToken(env, artifactId, user.id, page.capabilityHash));
  }

  if (action === 'consent' && request.method === 'GET') {
    return json({ workspaceId: page.workspaceId, connections: await consentState(env, page, user.id) });
  }

  if (action === 'consent' && request.method === 'POST') {
    let body: { connections?: unknown };
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON body', code: 'INVALID_JSON' }, 400);
    }
    const names = Array.isArray(body.connections) ? body.connections.filter((n): n is string => typeof n === 'string') : [];
    if (names.length === 0) return json({ error: 'connections must list connection names', code: 'VALIDATION_ERROR' }, 400);
    const state = await consentState(env, page, user.id);
    const targets = state.filter((c) => names.includes(c.name) && c.connectionId);
    if (targets.length !== names.length) {
      return json({ error: 'This page did not declare some of those connections', code: 'NOT_IN_MANIFEST' }, 400);
    }
    await env.DB.batch(targets.map((c) => env.DB.prepare(
      `INSERT INTO artifact_mcp_consents (artifact_id, user_id, connection_id, capability_hash) VALUES (?, ?, ?, ?)
       ON CONFLICT(artifact_id, user_id, connection_id) DO UPDATE SET capability_hash = excluded.capability_hash,
         created_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    ).bind(artifactId, user.id, c.connectionId, page.capabilityHash)));
    await logAudit(env, {
      workspaceId: page.workspaceId,
      actorId: user.id,
      actorEmail: user.email,
      action: 'mcp.consent_granted',
      targetType: 'artifact',
      targetId: artifactId,
      detail: { connections: targets.map((c) => c.name), capabilityHash: page.capabilityHash },
    });
    return json({ connections: await consentState(env, page, user.id) });
  }

  if (action === 'consent' && request.method === 'DELETE') {
    const name = new URL(request.url).searchParams.get('connection');
    const state = await consentState(env, page, user.id);
    const ids = state.filter((c) => c.connectionId && (!name || c.name === name)).map((c) => c.connectionId as string);
    if (ids.length) {
      await env.DB.prepare(
        `DELETE FROM artifact_mcp_consents WHERE artifact_id = ? AND user_id = ? AND connection_id IN (${ids.map(() => '?').join(',')})`,
      ).bind(artifactId, user.id, ...ids).run();
      await logAudit(env, {
        workspaceId: page.workspaceId,
        actorId: user.id,
        actorEmail: user.email,
        action: 'mcp.consent_revoked',
        targetType: 'artifact',
        targetId: artifactId,
        detail: { connections: name ? [name] : state.map((c) => c.name) },
      });
    }
    return json({ connections: await consentState(env, page, user.id) });
  }

  return json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' }, 405);
}
