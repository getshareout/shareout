import { queryConnectionAny } from '../../data/connections/warehouse-query';
import type { CrewTool } from '../types';

export const connectionQueryTool: CrewTool = {
  name: 'connection_query',
  mode: 'read',
  defaultApproval: 'never',
  description:
    'Query a workspace data connection by name and return the result. Works for REST API integrations (query = "GET /endpoint") and for SQL warehouses like BigQuery (query = the SQL string; pass params.projectId for BigQuery). Returns rows to you — best for small/aggregate results; for large result sets use materialize_query to save them without loading every row.',
  input_schema: {
    type: 'object',
    properties: {
      connection: { type: 'string', description: 'Connection name the owner configured.' },
      query: { type: 'string', description: 'For REST: "GET /endpoint" or a path. For a warehouse: the SQL query.' },
      params: { type: 'object', description: 'Optional. For BigQuery: { projectId }. For REST: query parameters.' },
    },
    required: ['connection', 'query'],
  },
  async execute(ctx, input) {
    const connection = typeof input.connection === 'string' ? input.connection : '';
    const query = typeof input.query === 'string' ? input.query : '';
    if (!connection) return { error: 'Missing required field "connection".' };
    if (!query) return { error: 'Missing required field "query".' };
    try {
      const data = await queryConnectionAny(
        ctx.data.env,
        ctx.data.artifactId,
        connection,
        query,
        (input.params as Record<string, unknown>) || undefined,
        ctx.principal.ownerId
      );
      return { connection, data };
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'connection query failed' };
    }
  },
};
