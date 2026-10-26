// Where a metric's rows come from, resolved inside its workspace only: a connection id
// or shared-table name from another workspace resolves to nothing, never to that
// workspace's data.
import type { Env } from '../../types';
import type { Dialect } from './sql-safety';
import type { MetricSpec, SpecIssue } from './spec';

export interface MetricConnection {
  id: string;
  name: string;
  provider: string;
  kind: string;
  config: string | null;
  agent_query_enabled: number;
  /** Reserved by its creator: other members cannot query it (see verifyWorkspaceConnectionAccess). */
  is_private: number;
  created_by: string | null;
}

export interface MetricSharedTable {
  name: string;
  ownerArtifactId: string;
  table: string;
}

export type CompileBase =
  | { kind: 'fqn'; fqn: string }
  | { kind: 'sql'; sql: string }
  | { kind: 'rows'; artifactId: string; table: string };

export interface MetricTarget {
  dialect: Dialect;
  base: CompileBase;
  connection: MetricConnection | null;
  sharedTable: MetricSharedTable | null;
}

export interface WorkspaceSources {
  connections: Map<string, MetricConnection>;
  sharedTables: Map<string, MetricSharedTable>;
}

const POSTGRES_FAMILY = new Set(['supabase', 'redshift', 'aurora']);

/** The SQL dialect a provider speaks, when ShareOut can compile metrics for it. */
export function dialectFor(provider: string): Dialect | null {
  if (provider === 'bigquery') return 'bigquery';
  if (provider === 'snowflake') return 'snowflake';
  return POSTGRES_FAMILY.has(provider) ? 'postgres' : null;
}

/** The workspace's connections and shared tables, loaded once for many metrics. */
export async function loadWorkspaceSources(env: Env, workspaceId: string): Promise<WorkspaceSources> {
  const [conns, shared] = await Promise.all([
    env.DB.prepare(
      "SELECT id, name, provider, kind, config, agent_query_enabled, is_private, created_by FROM connections WHERE scope_type = 'workspace' AND scope_id = ?"
    )
      .bind(workspaceId)
      .all<MetricConnection>(),
    env.DB.prepare('SELECT shared_name, owner_artifact_id, source_table_name FROM workspace_shared_tables WHERE workspace_id = ?')
      .bind(workspaceId)
      .all<{ shared_name: string; owner_artifact_id: string; source_table_name: string }>(),
  ]);
  return {
    connections: new Map(conns.results.map(c => [c.id, c])),
    sharedTables: new Map(
      shared.results.map(s => [s.shared_name, { name: s.shared_name, ownerArtifactId: s.owner_artifact_id, table: s.source_table_name }])
    ),
  };
}

export function resolveTarget(
  spec: Pick<MetricSpec, 'source'>,
  sources: WorkspaceSources
): { ok: true; target: MetricTarget } | { ok: false; issue: SpecIssue } {
  const src = spec.source;
  if (src.kind === 'shared_table') {
    const table = sources.sharedTables.get(src.shared_table);
    if (!table) {
      return {
        ok: false,
        issue: {
          param: 'source.shared_table',
          message: `No shared table "${src.shared_table}" in this workspace`,
          hint: 'Share the table from the page that owns it, or fix the name.',
        },
      };
    }
    return {
      ok: true,
      target: { dialect: 'sqlite', base: { kind: 'rows', artifactId: table.ownerArtifactId, table: table.table }, connection: null, sharedTable: table },
    };
  }
  const connection = sources.connections.get(src.connection);
  if (!connection) {
    return {
      ok: false,
      issue: {
        param: 'source.connection',
        message: `No connection ${src.connection} in this workspace`,
        hint: 'It may have been deleted. GET /v1/workspaces/{id}/connections lists the ids.',
      },
    };
  }
  const dialect = connection.kind === 'platform' ? dialectFor(connection.provider) : null;
  if (!dialect) {
    return {
      ok: false,
      issue: {
        param: 'source.connection',
        message: `The ${connection.name} connection (${connection.provider}) cannot run SQL for a metric`,
        hint: 'Metrics run on BigQuery, Snowflake, Supabase, Redshift and Aurora PostgreSQL. For other sources, refresh the data into a workspace shared table and use source.shared_table.',
      },
    };
  }
  return {
    ok: true,
    target: {
      dialect,
      base: src.kind === 'fqn' ? { kind: 'fqn', fqn: src.fqn } : { kind: 'sql', sql: src.sql },
      connection,
      sharedTable: null,
    },
  };
}
