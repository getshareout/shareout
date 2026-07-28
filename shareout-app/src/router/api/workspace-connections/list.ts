/**
 * Read-only workspace connection routes — list connectors, catalog view,
 * and artifact usage for a connector.
 */
import type { Env } from '../../../types';
import type { AuthUser } from '../../../api-auth';
import { getInternalWorkspaceRole } from '../../../workspaces';
import { listProviders } from '../../../data/platform';
import { json, requireMember } from './shared';
import type { CredentialScope } from './shared';

// GET /v1/workspaces/{id}/connections — list shared connectors (no secrets)
export async function handleListWorkspaceConnections(
  env: Env,
  user: AuthUser,
  workspaceId: string
): Promise<Response> {
  const viewerRole = await getInternalWorkspaceRole(env, workspaceId, user.id);
  if (!viewerRole) {
    return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  }

  const rows = await env.DB.prepare(`
    SELECT id, name, kind, provider, auth_type, config, preferred_mode,
           cache_ttl_seconds, rate_limit_rpm, created_by, created_at, updated_at,
           credential_scope, agent_query_enabled
    FROM connections
    WHERE scope_type = 'workspace' AND scope_id = ?
    ORDER BY created_at DESC
  `).bind(workspaceId).all<{
    id: string;
    name: string;
    kind: string;
    provider: string;
    auth_type: string;
    config: string;
    preferred_mode: string;
    cache_ttl_seconds: number;
    rate_limit_rpm: number;
    created_by: string | null;
    created_at: string;
    updated_at: string;
    credential_scope: CredentialScope;
    agent_query_enabled: number;
  }>();

  // How many distinct artifacts have used each shared connector.
  const usageRows = await env.DB.prepare(`
    SELECT u.connection_id, COUNT(DISTINCT u.artifact_id) AS n
    FROM connection_usage u
    JOIN connections c ON c.id = u.connection_id
    WHERE c.scope_type = 'workspace' AND c.scope_id = ?
    GROUP BY u.connection_id
  `).bind(workspaceId).all<{ connection_id: string; n: number }>();
  const usageById = new Map(usageRows.results.map((u) => [u.connection_id, u.n]));

  const perUserIds = rows.results.filter((r) => r.credential_scope === 'per_user').map((r) => r.id);
  const myCredSet = new Set<string>();
  if (perUserIds.length > 0) {
    const placeholders = perUserIds.map(() => '?').join(', ');
    const credRows = await env.DB.prepare(`
      SELECT connection_id FROM connection_user_credentials
      WHERE user_id = ? AND connection_id IN (${placeholders})
    `).bind(user.id, ...perUserIds).all<{ connection_id: string }>();
    for (const c of credRows.results) myCredSet.add(c.connection_id);
  }

  return json({
    viewerRole,
    canManage: viewerRole === 'owner' || viewerRole === 'admin',
    connections: rows.results.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      provider: r.provider,
      authType: r.auth_type,
      credentialScope: r.credential_scope,
      agentQueryEnabled: r.agent_query_enabled === 1,
      hasMyCredentials: r.credential_scope === 'per_user' ? myCredSet.has(r.id) : undefined,
      config: JSON.parse(r.config),
      preferredMode: r.preferred_mode,
      cacheTtl: r.cache_ttl_seconds,
      rateLimit: r.rate_limit_rpm,
      createdBy: r.created_by,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      usageCount: usageById.get(r.id) || 0,
    })),
  });
}

// GET /v1/workspaces/{id}/connections/catalog — provider catalog merged with connections
export async function handleWorkspaceConnectorsCatalog(
  env: Env,
  user: AuthUser,
  workspaceId: string
): Promise<Response> {
  const viewerRole = await getInternalWorkspaceRole(env, workspaceId, user.id);
  if (!viewerRole) {
    return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  }

  const rows = await env.DB.prepare(`
    SELECT id, name, kind, provider, auth_type, config, credential_scope, agent_query_enabled, created_at
    FROM connections
    WHERE scope_type = 'workspace' AND scope_id = ?
    ORDER BY created_at DESC
  `).bind(workspaceId).all<{
    id: string;
    name: string;
    kind: string;
    provider: string;
    auth_type: string;
    config: string;
    credential_scope: CredentialScope;
    agent_query_enabled: number;
    created_at: string;
  }>();

  const usageRows = await env.DB.prepare(`
    SELECT u.connection_id, COUNT(DISTINCT u.artifact_id) AS n
    FROM connection_usage u
    JOIN connections c ON c.id = u.connection_id
    WHERE c.scope_type = 'workspace' AND c.scope_id = ?
    GROUP BY u.connection_id
  `).bind(workspaceId).all<{ connection_id: string; n: number }>();
  const usageById = new Map(usageRows.results.map((u) => [u.connection_id, u.n]));

  const perUserIds = rows.results.filter((r) => r.credential_scope === 'per_user').map((r) => r.id);
  const myCredSet = new Set<string>();
  if (perUserIds.length > 0) {
    const placeholders = perUserIds.map(() => '?').join(', ');
    const credRows = await env.DB.prepare(`
      SELECT connection_id FROM connection_user_credentials
      WHERE user_id = ? AND connection_id IN (${placeholders})
    `).bind(user.id, ...perUserIds).all<{ connection_id: string }>();
    for (const c of credRows.results) myCredSet.add(c.connection_id);
  }

  const connView = (r: (typeof rows.results)[number]) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    credentialScope: r.credential_scope,
    agentQueryEnabled: r.agent_query_enabled === 1,
    hasMyCredentials: r.credential_scope === 'per_user' ? myCredSet.has(r.id) : undefined,
    usageCount: usageById.get(r.id) || 0,
    createdAt: r.created_at,
  });

  // Available providers that opt into the catalog (have display, not hidden).
  const providers = listProviders().filter((p) => p.display && !p.display.hidden);
  const providerIds = new Set(providers.map((p) => p.id));

  const catalog = providers.map((p) => ({
    id: p.id,
    label: p.display!.label || p.name,
    category: p.display!.category,
    tagline: p.display!.tagline || '',
    color: p.display!.color || '#2E52C2',
    iconSvg: p.display!.iconSvg || '',
    connectMethod: p.display!.connectMethod,
    docsUrl: p.display!.docsUrl || '',
    exampleSnippet: p.display!.exampleSnippet || '',
    testable: !!p.display!.testable,
    connections: rows.results.filter((r) => r.provider === p.id).map(connView),
  }));

  // Connections whose provider isn't a catalog provider (custom REST, Postgres, etc.).
  const otherConnections = rows.results
    .filter((r) => !providerIds.has(r.provider))
    .map((r) => ({ ...connView(r), provider: r.provider }));

  return json({
    viewerRole,
    canManage: viewerRole === 'owner' || viewerRole === 'admin',
    catalog,
    otherConnections,
  });
}

// GET /v1/workspaces/{id}/connections/{connId}/artifacts — artifacts using this connector
export async function handleListConnectionArtifacts(
  env: Env,
  user: AuthUser,
  workspaceId: string,
  connectionId: string
): Promise<Response> {
  if (!(await requireMember(env, workspaceId, user.id))) {
    return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  }

  const conn = await env.DB.prepare(
    "SELECT id FROM connections WHERE scope_type = 'workspace' AND scope_id = ? AND id = ?"
  ).bind(workspaceId, connectionId).first<{ id: string }>();
  if (!conn) {
    return json({ error: 'Connection not found', code: 'NOT_FOUND' }, 404);
  }

  const rows = await env.DB.prepare(`
    SELECT u.artifact_id, u.last_used_at, u.use_count, a.name, COALESCE(d.slug, a.slug) AS slug
    FROM connection_usage u
    JOIN artifacts a ON a.id = u.artifact_id
    LEFT JOIN deployments d ON d.artifact_id = a.id AND d.channel = 'production'
    WHERE u.connection_id = ?
    ORDER BY u.last_used_at DESC
  `).bind(conn.id).all<{
    artifact_id: string;
    last_used_at: string;
    use_count: number;
    name: string;
    slug: string | null;
  }>();

  return json({
    artifacts: rows.results.map((r) => ({
      id: r.artifact_id,
      name: r.name,
      slug: r.slug,
      lastUsedAt: r.last_used_at,
      useCount: r.use_count,
    })),
  });
}
