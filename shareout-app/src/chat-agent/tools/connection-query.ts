import type { AccountTool, ToolContext } from './types';
import { scopedWorkspaceId } from '../scope';
import { validateReadOnlySql } from '../../data/connections/sql-guard';
import { isSqlProvider, queryWorkspaceConnection } from '../../data/connections/warehouse-query';
import { PlatformEngine, getProvider } from '../../data/platform';
import { checkWebAgentQueryLimit } from '../../rate-limit';

const MAX_ROWS = 1000;
const TIMEOUT_MS = 60_000;

/** The selected workspace id once internal membership is verified, else null. */
const workspaceId = (ctx: ToolContext): Promise<string | null> => scopedWorkspaceId(ctx);

/** App connectors the assistant reads over their API (read_connector, GET endpoints only). */
const API_READ_PROVIDERS = new Set(['humand']);
export const isApiReadProvider = (provider: string): boolean => API_READ_PROVIDERS.has(provider);

export const listConnectionsTool: AccountTool = {
  name: 'list_connections',
  description:
    "List this workspace's data connectors (name, provider, and what the assistant may do with it: `queryable` = SQL via query_connection, `files` = browse/read via browse_storage, `readable` = read its API via read_connector). Use first to pick a connector.",
  input_schema: { type: 'object', properties: {} },
  async execute(ctx) {
    const wsId = await workspaceId(ctx);
    if (!wsId) return { error: 'Connectors are only available inside a workspace.' };
    const rows = await ctx.env.DB.prepare(
      "SELECT name, provider, kind, agent_query_enabled FROM connections WHERE scope_type = 'workspace' AND scope_id = ? ORDER BY name"
    ).bind(wsId).all<{ name: string; provider: string; kind: string; agent_query_enabled: number }>();
    return {
      connections: rows.results.map((r) => {
        const enabled = r.kind === 'platform' && r.agent_query_enabled === 1;
        return {
          name: r.name,
          provider: r.provider,
          queryable: enabled && isSqlProvider(r.provider),
          files: enabled && r.provider === 's3',
          readable: enabled && isApiReadProvider(r.provider),
        };
      }),
    };
  },
};

export const queryConnectionTool: AccountTool = {
  name: 'query_connection',
  description:
    'Run a single read-only SELECT against a workspace data connector (Snowflake, BigQuery, Redshift, Aurora, Supabase) and return the rows. Only works for connectors an admin has enabled for the assistant (see list_connections). Aggregate in SQL — results are capped. Never attempt to write or change data.',
  input_schema: {
    type: 'object',
    properties: {
      connection: { type: 'string', description: 'Connector name (from list_connections).' },
      sql: { type: 'string', description: 'A single read-only SELECT (or WITH … SELECT) statement.' },
      project_id: { type: 'string', description: 'Optional GCP project id for a BigQuery connector.' },
    },
    required: ['connection', 'sql'],
  },
  async execute(ctx, input) {
    const wsId = await workspaceId(ctx);
    if (!wsId) return { error: 'Connector queries are only available inside a workspace.' };

    const name = typeof input.connection === 'string' ? input.connection.trim() : '';
    const rawSql = typeof input.sql === 'string' ? input.sql : '';
    if (!name) return { error: 'Tell me which connector to query (connection).' };
    if (!rawSql) return { error: 'Give me the SQL to run (sql).' };

    const limit = await checkWebAgentQueryLimit(ctx.env, wsId);
    if (!limit.allowed) return { error: 'This workspace has hit its connector-query limit for now. Try again later.' };

    const conn = await ctx.env.DB.prepare(
      "SELECT id, provider, config, agent_query_enabled FROM connections WHERE scope_type = 'workspace' AND scope_id = ? AND name = ? AND kind = 'platform'"
    ).bind(wsId, name).first<{ id: string; provider: string; config: string | null; agent_query_enabled: number }>();
    if (!conn) return { error: `No queryable connector named “${name}” in this workspace.` };
    if (conn.agent_query_enabled !== 1) {
      return { error: `The connector “${name}” isn’t enabled for the assistant. An admin can turn it on under Connectors.` };
    }

    const guard = validateReadOnlySql(rawSql);
    if (!guard.ok || !guard.sql) return { error: guard.reason || 'That query isn’t allowed — read-only SELECT only.' };

    try {
      const rows = await queryWorkspaceConnection(
        ctx.env,
        wsId,
        { id: conn.id, provider: conn.provider, config: conn.config },
        guard.sql,
        { maxResults: MAX_ROWS, timeoutMs: TIMEOUT_MS, projectId: typeof input.project_id === 'string' ? input.project_id : undefined },
        ctx.userId
      );
      return { connection: name, rowCount: rows.length, rows };
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'The query failed.' };
    }
  },
};

const MAX_TEXT_CHARS = 50_000;

export const browseStorageTool: AccountTool = {
  name: 'browse_storage',
  description:
    'Browse or read files in a workspace storage connector (Amazon S3). action "list" returns folders and files under a prefix; action "read" returns a CSV as rows, JSON as data, or text (capped). Only connectors an admin has enabled for the assistant (see list_connections → files). Read-only.',
  input_schema: {
    type: 'object',
    properties: {
      connection: { type: 'string', description: 'Connector name (from list_connections).' },
      action: { type: 'string', enum: ['list', 'read'], description: '"list" a folder or "read" one file.' },
      prefix: { type: 'string', description: 'Folder to list, e.g. "exports/2026/". Omit for the top level.' },
      key: { type: 'string', description: 'File to read, e.g. "exports/orders.csv".' },
    },
    required: ['connection', 'action'],
  },
  async execute(ctx, input) {
    const wsId = await workspaceId(ctx);
    if (!wsId) return { error: 'Storage connectors are only available inside a workspace.' };
    const name = typeof input.connection === 'string' ? input.connection.trim() : '';
    if (!name) return { error: 'Tell me which connector to browse (connection).' };
    const read = input.action === 'read';
    const key = typeof input.key === 'string' ? input.key.trim() : '';
    if (read && !key) return { error: 'Give me the file key to read.' };

    const limit = await checkWebAgentQueryLimit(ctx.env, wsId);
    if (!limit.allowed) return { error: 'This workspace has hit its connector-query limit for now. Try again later.' };

    const conn = await ctx.env.DB.prepare(
      "SELECT id, provider, agent_query_enabled FROM connections WHERE scope_type = 'workspace' AND scope_id = ? AND name = ? AND kind = 'platform'"
    ).bind(wsId, name).first<{ id: string; provider: string; agent_query_enabled: number }>();
    if (!conn || conn.provider !== 's3') return { error: `No storage connector named “${name}” in this workspace.` };
    if (conn.agent_query_enabled !== 1) {
      return { error: `The connector “${name}” isn’t enabled for the assistant. An admin can turn it on under Connectors.` };
    }

    const engine = new PlatformEngine({ artifactId: '', env: ctx.env, workspaceId: wsId, requesterUserId: ctx.userId ?? undefined });
    const resp = await engine.execute<Record<string, unknown>>({
      provider: 's3',
      endpoint: read ? 'objects.get' : 'objects.list',
      connectionId: conn.id,
      params: { queryParams: read ? { key } : { ...(typeof input.prefix === 'string' && input.prefix ? { prefix: input.prefix } : {}) } },
    });
    if (!resp.success || !resp.data) return { error: resp.error?.message || 'Could not reach the bucket.' };
    const data: Record<string, unknown> = { connection: name, ...resp.data };
    if (Array.isArray(data.rows) && data.rows.length > MAX_ROWS) {
      return { ...data, rows: data.rows.slice(0, MAX_ROWS), truncated: true };
    }
    if (typeof data.text === 'string' && data.text.length > MAX_TEXT_CHARS) {
      return { ...data, text: data.text.slice(0, MAX_TEXT_CHARS), truncated: true };
    }
    return data;
  },
};

const MAX_READ_CHARS = 50_000;

/** Only string/number/boolean values: the model's params can't carry bodies, headers or nested objects. */
function primitives(value: unknown): Record<string, string | number | boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(([, v]) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'),
  ) as Record<string, string | number | boolean>;
}

/** Halve the longest list until the answer fits the budget; the model then asks for a smaller page. */
export function fitToBudget(data: unknown, max = MAX_READ_CHARS): { data: unknown; truncated?: string } {
  const size = (v: unknown) => JSON.stringify(v ?? null).length;
  if (size(data) <= max) return { data };
  const obj = !Array.isArray(data) && data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
  const key = obj
    ? Object.keys(obj).filter((k) => Array.isArray(obj[k])).sort((a, b) => (obj[b] as unknown[]).length - (obj[a] as unknown[]).length)[0]
    : undefined;
  const list = Array.isArray(data) ? data : key ? (obj![key] as unknown[]) : null;
  if (!list || list.length < 2) {
    return { data: JSON.stringify(data).slice(0, max), truncated: 'Answer cut to fit; ask for a smaller page or a narrower endpoint.' };
  }
  const build = (n: number) => (key ? { ...obj!, [key]: list.slice(0, n) } : list.slice(0, n));
  let n = list.length;
  while (n > 1 && size(build(n)) > max) n = Math.floor(n / 2);
  return { data: build(n), truncated: `Showing ${n} of ${list.length} items; ask for a smaller limit or the next page.` };
}

export const readConnectorTool: AccountTool = {
  name: 'read_connector',
  description:
    'Read data from a workspace app connector over its API (Humand: employees, departments, job positions, time off, attendance, courses, form answers…). Call without `endpoint` to list what it can read, then with one `endpoint` and its `query` / `path` parameters. Lists are paged (`page` from 1, `limit` up to 500; `next_page` says what to ask for next). Read-only. Only connectors an admin has enabled for the assistant (see list_connections → readable).',
  input_schema: {
    type: 'object',
    properties: {
      connection: { type: 'string', description: 'Connector name (from list_connections).' },
      endpoint: { type: 'string', description: 'Endpoint id, e.g. "users.list". Omit to list the endpoints.' },
      query: { type: 'object', description: 'Query parameters, e.g. { "page": 1, "limit": 100, "search": "ana" }.' },
      path: { type: 'object', description: 'Path parameters the endpoint needs, e.g. { "id": 12 }.' },
    },
    required: ['connection'],
  },
  async execute(ctx, input) {
    const wsId = await workspaceId(ctx);
    if (!wsId) return { error: 'App connectors are only available inside a workspace.' };
    const name = typeof input.connection === 'string' ? input.connection.trim() : '';
    if (!name) return { error: 'Tell me which connector to read (connection).' };

    const conn = await ctx.env.DB.prepare(
      "SELECT id, provider, agent_query_enabled FROM connections WHERE scope_type = 'workspace' AND scope_id = ? AND name = ? AND kind = 'platform'"
    ).bind(wsId, name).first<{ id: string; provider: string; agent_query_enabled: number }>();
    if (!conn || !isApiReadProvider(conn.provider)) return { error: `No app connector named “${name}” in this workspace.` };
    if (conn.agent_query_enabled !== 1) {
      return { error: `The connector “${name}” isn’t enabled for the assistant. An admin can turn it on under Connectors.` };
    }

    const endpoints = (getProvider(conn.provider)?.listEndpoints() ?? []).filter((e) => e.method === 'GET');
    const endpointId = typeof input.endpoint === 'string' ? input.endpoint.trim() : '';
    if (!endpointId) {
      return {
        connection: name,
        provider: conn.provider,
        endpoints: endpoints.map((e) => ({
          id: e.id,
          description: e.description,
          path_params: [...e.path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]),
          paged: !!e.pagination,
        })),
      };
    }
    if (!endpoints.some((e) => e.id === endpointId)) {
      return { error: `“${endpointId}” isn’t something ${name} can read. Call read_connector without endpoint to see the list.` };
    }

    const limit = await checkWebAgentQueryLimit(ctx.env, wsId);
    if (!limit.allowed) return { error: 'This workspace has hit its connector-query limit for now. Try again later.' };

    const engine = new PlatformEngine({ artifactId: '', env: ctx.env, workspaceId: wsId, requesterUserId: ctx.userId ?? undefined });
    const resp = await engine.execute({
      provider: conn.provider,
      endpoint: endpointId,
      connectionId: conn.id,
      params: { queryParams: primitives(input.query), pathParams: primitives(input.path) as Record<string, string | number> },
    });
    if (!resp.success) return { error: resp.error?.message || 'The connector did not answer.' };
    const fitted = fitToBudget(resp.data);
    return {
      connection: name,
      endpoint: endpointId,
      data: fitted.data,
      ...(resp.pagination?.total !== undefined ? { total: resp.pagination.total } : {}),
      ...(resp.pagination?.hasMore ? { next_page: resp.pagination.cursor } : {}),
      ...(fitted.truncated ? { truncated: fitted.truncated } : {}),
    };
  },
};
