import { runMaterialize } from '../../data/materialize';
import { queryConnectionAny } from '../../data/connections/warehouse-query';
import type { CrewTool } from '../types';

export const materializeTool: CrewTool = {
  name: 'materialize_query',
  mode: 'write',
  defaultApproval: 'whenPublic',
  description:
    'Run a connection query (REST or a SQL warehouse like BigQuery — query = the SQL) and SAVE the results into this app, without loading the rows into the conversation. Save to a table, a dataset, or a json key. For dashboards that read a json snapshot, use target { type: "json", name: "snapshot", path: "<field>" } to refresh one field at a time.',
  input_schema: {
    type: 'object',
    properties: {
      connection: { type: 'string', description: 'Connection name to query.' },
      query: { type: 'string', description: 'REST path or, for a warehouse, the SQL query.' },
      params: { type: 'object', description: 'Optional query params. For BigQuery: { projectId }.' },
      target: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['table', 'dataset', 'json'] },
          name: { type: 'string', description: 'Table/dataset name, or json key.' },
          path: { type: 'string', description: 'For json targets: merge the rows at this field inside the key\'s object.' },
        },
        required: ['type', 'name'],
        description: 'Where to save the results.',
      },
      mode: { type: 'string', enum: ['replace', 'append'], description: 'replace (default) or append (table only).' },
    },
    required: ['connection', 'query', 'target'],
  },
  async execute(ctx, input) {
    const connection = typeof input.connection === 'string' ? input.connection : '';
    const query = typeof input.query === 'string' ? input.query : '';
    const target = input.target as { type?: string; name?: string; path?: string } | undefined;
    const params = (input.params as Record<string, unknown>) || undefined;
    if (!connection || !query) return { error: 'Missing "connection" or "query".' };
    if (!target?.name || (target.type !== 'table' && target.type !== 'dataset' && target.type !== 'json')) {
      return { error: 'Provide target { type: "table" | "dataset" | "json", name }.' };
    }
    const mode = input.mode === 'append' ? 'append' : 'replace';

    try {
      const result = await runMaterialize(
        ctx.data.env,
        ctx.data.artifactId,
        {
          source: { connection, query, options: params ? { params } : undefined },
          target: { type: target.type, name: target.name, path: target.path },
          mode,
        },
        (c, q, p) => queryConnectionAny(ctx.data.env, ctx.data.artifactId, c, q, p, ctx.principal.ownerId)
      );
      return result;
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'materialize failed' };
    }
  },
};
