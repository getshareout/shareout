/**
 * Data connector tools: list the workspace's connectors, run read-only SQL on the
 * warehouse ones (Snowflake, BigQuery, Redshift, Aurora, Supabase) and browse/read S3.
 * They run the workspace assistant's own tools after the MCP membership check, so the
 * same gates apply: only connectors an admin switched on for AI, the read-only SQL
 * guard, the per-workspace query limit, and per-user credentials.
 */
import { browseStorageTool, listConnectionsTool, queryConnectionTool } from '../chat-agent/tools/connection-query';
import type { AccountTool } from '../chat-agent/tools/types';
import {
  NOT_MEMBER, fail, ok, resolveWorkspace, str, workspaceChoiceText,
  type Args, type ToolContext, type ToolDef, type ToolResult,
} from './tool-kit';

const MAX_TEXT_CHARS = 60_000;

/** Runs an in-app connector tool as the person, inside the workspace they named (or their only one). */
async function runInWorkspace(ctx: ToolContext, args: Args, action: string, tool: AccountTool, input: Record<string, unknown>): Promise<ToolResult> {
  const resolved = await resolveWorkspace(ctx, str(args.workspace_id, 100));
  if (resolved.notMember) return fail(NOT_MEMBER);
  if (resolved.choices) return ok(workspaceChoiceText(action, resolved.choices), { needs_workspace: true, workspaces: resolved.choices });
  if (!resolved.workspace) return ok('The person has no workspace yet, so there are no data connectors.');

  const out = (await tool.execute({ env: ctx.env, userId: ctx.user.id, selectedWorkspaceId: resolved.workspace.id }, input)) as Record<string, unknown>;
  if (typeof out.error === 'string') return ok(out.error, { error: out.error, workspace_id: resolved.workspace.id });
  const structured = { workspace_id: resolved.workspace.id, ...out };
  const text = JSON.stringify(out);
  return ok(text.length > MAX_TEXT_CHARS ? `${text.slice(0, MAX_TEXT_CHARS)}… (cut; ask a narrower question)` : text, structured);
}

const workspaceProp = { type: 'string', description: 'Needed when the person has more than one workspace.' };

const listConnections: ToolDef = {
  name: 'list_connections',
  title: 'List data connectors',
  description: [
    "Lists the workspace's data connectors (Snowflake, BigQuery, Redshift, Aurora, Supabase, Amazon S3, …).",
    '`queryable` means query_connection can run SQL on it; `files` means browse_storage can list and read its files.',
    'Connectors an admin has not switched on for AI show neither; tell the person an admin can switch it on under Connectors.',
  ].join(' '),
  inputSchema: { type: 'object', properties: { workspace_id: workspaceProp }, additionalProperties: false },
  annotations: { readOnlyHint: true, openWorldHint: false },
  run: (ctx, args) => runInWorkspace(ctx, args, 'list_connections', listConnectionsTool, {}),
};

const queryConnection: ToolDef = {
  name: 'query_connection',
  title: 'Query a data connector',
  description: [
    'Runs one read-only SELECT (or WITH … SELECT) on a warehouse connector and returns the rows.',
    'Call list_connections first. Aggregate in SQL — results are capped at 1000 rows. Never try to change data.',
    'When you answer, say which connector the numbers came from.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      workspace_id: workspaceProp,
      connection: { type: 'string', description: 'Connector name from list_connections.' },
      sql: { type: 'string', description: 'One read-only SELECT statement in the connector’s SQL dialect.' },
      project_id: { type: 'string', description: 'GCP project id, for a BigQuery connector only.' },
    },
    required: ['connection', 'sql'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  run: (ctx, args) => runInWorkspace(ctx, args, 'query_connection', queryConnectionTool, {
    connection: args.connection, sql: args.sql, project_id: args.project_id,
  }),
};

const browseStorage: ToolDef = {
  name: 'browse_storage',
  title: 'Browse files in a storage connector',
  description: [
    'Lists folders and files in an Amazon S3 connector (action "list", optional prefix) or reads one file (action "read", key).',
    'CSV comes back as rows, JSON as data, text as text. Files over 10 MB or binary files cannot be read here.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      workspace_id: workspaceProp,
      connection: { type: 'string', description: 'Connector name from list_connections.' },
      action: { type: 'string', enum: ['list', 'read'] },
      prefix: { type: 'string', description: 'Folder to list, e.g. "exports/2026/".' },
      key: { type: 'string', description: 'File to read, e.g. "exports/orders.csv".' },
    },
    required: ['connection', 'action'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  run: (ctx, args) => runInWorkspace(ctx, args, 'browse_storage', browseStorageTool, {
    connection: args.connection, action: args.action, prefix: args.prefix, key: args.key,
  }),
};

export const CONNECTOR_TOOLS: ToolDef[] = [listConnections, queryConnection, browseStorage];
