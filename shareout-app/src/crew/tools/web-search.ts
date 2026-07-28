import { getSearchProvider } from '../search';
import type { CrewTool } from '../types';

export const webSearchTool: CrewTool = {
  name: 'web_search',
  mode: 'read',
  defaultApproval: 'never',
  description:
    'Search the web for current information (e.g. to find providers, prices, news, or facts). Returns a list of results with title, url, and snippet.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The search query.' },
      limit: { type: 'number', description: 'Max results to return (default 5).' },
    },
    required: ['query'],
  },
  async execute(ctx, input) {
    const query = typeof input.query === 'string' ? input.query.trim() : '';
    if (!query) return { error: 'Missing required field "query".' };

    const cap = ctx.limits.maxResults ?? 8;
    const limit = Math.min(typeof input.limit === 'number' ? input.limit : 5, cap);

    const provider = getSearchProvider(ctx.data.env);
    try {
      const results = await provider.search(query, limit);
      return { query, provider: provider.name, count: results.length, results };
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'web search failed' };
    }
  },
};
