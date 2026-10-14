import type { AccountTool, ToolContext } from './types';
import { PERSONAL_SCOPE } from '../../chat-platforms/types';
import { validateReadOnlySql } from '../../data/connections/sql-guard';
import { isSqlProvider, queryWorkspaceConnection } from '../../data/connections/warehouse-query';
import { PlatformEngine } from '../../data/platform';
import { checkWebAgentQueryLimit } from '../../rate-limit';

const MAX_ROWS = 1000;
const TIMEOUT_MS = 60_000;

/** The active workspace id, or null when the scope isn't a concrete workspace. */
function workspaceId(ctx: ToolContext): string | null {
  const ws = ctx.selectedWorkspaceId;
  return typeof ws === 'string' && ws !== PERSONAL_SCOPE ? ws : null;
}

export const listConnectionsTool: AccountTool = {
  name: 'list_connections',
  description:
    "List this workspace's data connectors (name, provider, and what the assistant may do with it: `queryable` = SQL via query_connection, `files` = browse/read via browse_storage). Use first to pick a connector.",
  input_schema: { type: 'object', properties: {} },
  async execute(ctx) {
    const wsId = workspaceId(ctx);
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
    const wsId = workspaceId(ctx);
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
    const wsId = workspaceId(ctx);
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
