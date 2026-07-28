import type { AccountTool, ToolContext } from './types';
import { PERSONAL_SCOPE } from '../../chat-platforms/types';
import { validateReadOnlySql } from '../../data/connections/sql-guard';
import { queryWorkspaceConnection } from '../../data/connections/warehouse-query';
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
    "List this workspace's data connectors (name, provider, and whether the assistant may query it). Use before query_connection to pick a connector and check it's queryable.",
  input_schema: { type: 'object', properties: {} },
  async execute(ctx) {
    const wsId = workspaceId(ctx);
    if (!wsId) return { error: 'Connectors are only available inside a workspace.' };
    const rows = await ctx.env.DB.prepare(
      "SELECT name, provider, kind, agent_query_enabled FROM connections WHERE scope_type = 'workspace' AND scope_id = ? ORDER BY name"
    ).bind(wsId).all<{ name: string; provider: string; kind: string; agent_query_enabled: number }>();
    return {
      connections: rows.results.map((r) => ({
        name: r.name,
        provider: r.provider,
        queryable: r.kind === 'platform' && r.agent_query_enabled === 1,
      })),
    };
  },
};

export const queryConnectionTool: AccountTool = {
  name: 'query_connection',
  description:
    'Run a single read-only SELECT against a workspace data connector (warehouse like Snowflake or BigQuery) and return the rows. Only works for connectors an admin has enabled for the assistant (see list_connections). Aggregate in SQL — results are capped. Never attempt to write or change data.',
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
