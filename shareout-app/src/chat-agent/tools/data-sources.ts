import type { Env } from '../../types';
import { queryConnectionData } from '../../data/connections/handler';
import { listConnections } from '../../data/platform/core/credentials';
import { resolveArtifactAccessForUser } from '../access';
import type { AccountTool } from './types';

const MAX_DATA_CHARS = 8_000;

function boundData(data: unknown): unknown {
  const s = JSON.stringify(data);
  if (s.length <= MAX_DATA_CHARS) return data;
  return { truncated: true, preview: s.slice(0, MAX_DATA_CHARS) + '…' };
}

// Generic (REST) connections — these are the ones run_data_source can execute.
async function listGenericConnections(
  env: Env,
  artifactId: string,
  workspaceId: string | null
): Promise<Array<{ name: string; type: string }>> {
  const local = await env.DB.prepare("SELECT name, provider AS type FROM connections WHERE scope_type = 'artifact' AND scope_id = ? AND kind = 'generic' ORDER BY name")
    .bind(artifactId)
    .all<{ name: string; type: string }>();
  let shared: Array<{ name: string; type: string }> = [];
  if (workspaceId) {
    const r = await env.DB.prepare(
      "SELECT name, provider AS type FROM connections WHERE scope_type = 'workspace' AND scope_id = ? AND kind = 'generic' ORDER BY name"
    ).bind(workspaceId).all<{ name: string; type: string }>();
    shared = r.results;
  }
  const seen = new Set(local.results.map((c) => c.name));
  return [...local.results, ...shared.filter((c) => !seen.has(c.name))];
}

export const listDataSourcesTool: AccountTool = {
  name: 'list_data_sources',
  description:
    'List a page’s connected data sources. REST/API sources are runnable with run_data_source. Warehouse sources (Snowflake, BigQuery, Sheets) are not runnable over chat yet — read their latest saved numbers with read_artifact instead.',
  input_schema: {
    type: 'object',
    properties: { artifact_id: { type: 'string', description: 'The id of the page.' } },
    required: ['artifact_id'],
  },
  async execute(ctx, input) {
    const artifactId = typeof input.artifact_id === 'string' ? input.artifact_id : '';
    if (!artifactId) return { error: 'Missing artifact_id.' };

    const access = await resolveArtifactAccessForUser(ctx.env, artifactId, ctx.userId);
    if (!access) return { error: 'You don’t have access to that page (or it doesn’t exist).' };

    const [generic, platform] = await Promise.all([
      listGenericConnections(ctx.env, artifactId, access.workspaceId),
      listConnections(ctx.env, artifactId),
    ]);

    return {
      canRun: access.canRunConnections,
      sources: [
        ...generic.map((c) => ({ name: c.name, kind: c.type, runnable: true })),
        ...platform.map((c) => ({
          name: c.name,
          kind: c.provider,
          runnable: false,
          note: 'Read its latest saved data with read_artifact.',
        })),
      ],
    };
  },
};

export const runDataSourceTool: AccountTool = {
  name: 'run_data_source',
  description:
    'Run a live read query against a page’s REST/API data source (by connection name) and return the result — use this for fresh numbers. Only works if the user owns the page or is a member of its workspace. Not for warehouse sources.',
  input_schema: {
    type: 'object',
    properties: {
      artifact_id: { type: 'string', description: 'The id of the page.' },
      connection: { type: 'string', description: 'The connection name (from list_data_sources).' },
      query: { type: 'string', description: 'The request to run, e.g. "GET /endpoint".' },
      params: { type: 'object', description: 'Optional query parameters.' },
    },
    required: ['artifact_id', 'connection', 'query'],
  },
  async execute(ctx, input) {
    const artifactId = typeof input.artifact_id === 'string' ? input.artifact_id : '';
    const connection = typeof input.connection === 'string' ? input.connection : '';
    const query = typeof input.query === 'string' ? input.query : '';
    if (!artifactId || !connection || !query) {
      return { error: 'Need artifact_id, connection, and query.' };
    }

    const access = await resolveArtifactAccessForUser(ctx.env, artifactId, ctx.userId);
    if (!access) return { error: 'You don’t have access to that page (or it doesn’t exist).' };
    if (!access.canRunConnections) {
      return {
        error:
          'Running live data needs you to be the page owner or a member of its workspace. You can still read its saved data.',
      };
    }

    try {
      const data = await queryConnectionData(
        ctx.env,
        artifactId,
        connection,
        query,
        (input.params as Record<string, unknown>) || undefined
      );
      return { connection, data: boundData(data) };
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'Query failed.' };
    }
  },
};
