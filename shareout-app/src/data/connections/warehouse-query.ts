// Server-side querying of workspace connections, generic REST *or* a platform
// warehouse (BigQuery today; Snowflake/others extensible). The generic path is the
// existing rest_api executor; the platform path runs through PlatformEngine on the
// caller's per-user credentials (e.g. the crew/artifact owner), so unattended jobs
// and crews can query a per_user BigQuery connection the same way the interactive
// data API does.

import type { Env } from '../../types';
import { PlatformEngine } from '../platform';
import { queryConnectionData } from './handler';
import { parseBqRows, parseSnowflakeRows, type WarehouseQueryOptions } from './warehouse-exec';

export type { WarehouseQueryOptions };

interface PlatformConnRow {
  id: string;
  provider: string;
  config: string | null;
}

/** Resolve a workspace PLATFORM connection by name in the artifact's workspace. */
export async function resolvePlatformConnection(
  env: Env,
  artifactId: string,
  name: string
): Promise<PlatformConnRow | null> {
  const ws = await env.DB.prepare('SELECT workspace_id FROM artifacts WHERE id = ?')
    .bind(artifactId).first<{ workspace_id: string | null }>();
  if (!ws?.workspace_id) return null;
  return env.DB.prepare(
    "SELECT id, provider, config FROM connections WHERE scope_type = 'workspace' AND scope_id = ? AND name = ? AND kind = 'platform'"
  ).bind(ws.workspace_id, name).first<PlatformConnRow>();
}

/** Run a SQL query against a platform warehouse connection. Returns parsed row objects. */
export async function queryPlatformConnection(
  env: Env,
  artifactId: string,
  conn: PlatformConnRow,
  sql: string,
  opts: WarehouseQueryOptions,
  userId?: string | null
): Promise<Record<string, unknown>[]> {
  const engine = new PlatformEngine({ artifactId, env, requesterUserId: userId ?? undefined });

  if (conn.provider === 'bigquery') {
    const cfg = (conn.config ? JSON.parse(conn.config) : {}) as Record<string, unknown>;
    const projectId = opts.projectId || cfg.projectId || cfg.project || cfg.defaultProject;
    if (!projectId) throw new Error('projectId is required to query this BigQuery connection (pass params.projectId)');
    const resp = await engine.execute({
      provider: 'bigquery',
      endpoint: 'jobs.query',
      connectionId: conn.id,
      params: {
        pathParams: { projectId: String(projectId) },
        body: { query: sql, useLegacySql: false, maxResults: opts.maxResults ?? 10000, timeoutMs: opts.timeoutMs ?? 120000 },
      },
      options: { cache: false },
    });
    if (!resp.success) throw new Error(resp.error?.message || 'BigQuery query failed');
    return parseBqRows(resp.data);
  }

  if (conn.provider === 'snowflake') {
    const resp = await engine.execute({
      provider: 'snowflake',
      endpoint: 'statements.execute',
      connectionId: conn.id,
      params: { body: { statement: sql, timeout: Math.ceil((opts.timeoutMs ?? 60000) / 1000) } },
      options: { cache: false },
    });
    if (!resp.success) throw new Error(resp.error?.message || 'Snowflake query failed');
    return parseSnowflakeRows(resp.data);
  }

  throw new Error(`Server-side SQL query is not yet supported for platform provider "${conn.provider}"`);
}

function pickNum(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}

/**
 * Query a workspace connection by name — generic REST (existing executor) OR a
 * platform warehouse like BigQuery. For a warehouse connection, `query` is the SQL
 * string and `params` may carry projectId/maxResults/timeoutMs. Per-user credentials
 * resolve via `userId` (pass the owner's id for unattended jobs/crews).
 */
export async function queryConnectionAny(
  env: Env,
  artifactId: string,
  name: string,
  query: string | Record<string, unknown>,
  params?: Record<string, unknown>,
  userId?: string | null
): Promise<unknown> {
  const platform = await resolvePlatformConnection(env, artifactId, name);
  if (platform) {
    const sql = typeof query === 'string'
      ? query
      : String((query as Record<string, unknown>)?.sql ?? (query as Record<string, unknown>)?.query ?? '');
    if (!sql) throw new Error('Provide the SQL string in "query" for a warehouse connection');
    const projectId = (params?.projectId ?? params?.project) as string | undefined;
    return await queryPlatformConnection(env, artifactId, platform, sql, {
      projectId,
      maxResults: pickNum(params?.maxResults),
      timeoutMs: pickNum(params?.timeoutMs),
    }, userId);
  }
  return await queryConnectionData(env, artifactId, name, query, params, userId);
}

/**
 * Run a SQL query against a workspace platform connection without an artifact —
 * the workspace-level assistant path. Mirrors queryPlatformConnection but anchors
 * the engine on the workspace (credential resolution, rate-limit, usage). Per-user
 * credentials resolve via `userId`.
 */
export async function queryWorkspaceConnection(
  env: Env,
  workspaceId: string,
  conn: PlatformConnRow,
  sql: string,
  opts: WarehouseQueryOptions,
  userId?: string | null
): Promise<Record<string, unknown>[]> {
  const engine = new PlatformEngine({ artifactId: '', env, workspaceId, requesterUserId: userId ?? undefined });

  if (conn.provider === 'bigquery') {
    const cfg = (conn.config ? JSON.parse(conn.config) : {}) as Record<string, unknown>;
    const projectId = opts.projectId || cfg.projectId || cfg.project || cfg.defaultProject;
    if (!projectId) throw new Error('projectId is required to query this BigQuery connection (pass params.projectId)');
    const resp = await engine.execute({
      provider: 'bigquery',
      endpoint: 'jobs.query',
      connectionId: conn.id,
      params: {
        pathParams: { projectId: String(projectId) },
        body: { query: sql, useLegacySql: false, maxResults: opts.maxResults ?? 10000, timeoutMs: opts.timeoutMs ?? 120000 },
      },
      options: { cache: false },
    });
    if (!resp.success) throw new Error(resp.error?.message || 'BigQuery query failed');
    return parseBqRows(resp.data);
  }

  if (conn.provider === 'snowflake') {
    const resp = await engine.execute({
      provider: 'snowflake',
      endpoint: 'statements.execute',
      connectionId: conn.id,
      params: { body: { statement: sql, timeout: Math.ceil((opts.timeoutMs ?? 60000) / 1000) } },
      options: { cache: false },
    });
    if (!resp.success) throw new Error(resp.error?.message || 'Snowflake query failed');
    return parseSnowflakeRows(resp.data);
  }

  throw new Error(`Server-side SQL query is not yet supported for platform provider "${conn.provider}"`);
}
