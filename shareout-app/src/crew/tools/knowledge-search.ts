import { isKnowledgeEnabled } from '../../knowledge/store';
import { searchCorpus } from '../../knowledge/corpus/search';
import { getInternalWorkspaceRole } from '../../workspaces/roles';
import type { CrewTool } from '../types';

// Search the crew's workspace Knowledge as its owner: only sources the owner may see.
export const knowledgeSearchTool: CrewTool = {
  name: 'knowledge_search',
  mode: 'read',
  description:
    "Search this workspace's Knowledge (uploaded Files and pages) and return cited passages: { cite, text, source, page?, url }. Only content the crew owner can see. Cite `source` and link `url` for every fact.",
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What to look for.' },
      limit: { type: 'number', description: 'Max passages (default 8, max 20).' },
    },
    required: ['query'],
  },
  async execute(ctx, input) {
    const { env } = ctx.data;
    const { ownerId, workspaceId } = ctx.principal;
    const query = typeof input.query === 'string' ? input.query.trim() : '';
    if (!query) return { error: 'Missing required field "query".' };
    if (!workspaceId) return { error: 'Knowledge is only available inside a workspace.' };
    if (!(await getInternalWorkspaceRole(env, workspaceId, ownerId))) return { error: 'The crew owner is not a member of this workspace.' };
    if (!(await isKnowledgeEnabled(env, workspaceId))) return { enabled: false, message: "Knowledge isn't turned on for this workspace." };
    const limit = Math.min(Math.max(Number(input.limit) || 8, 1), 20);
    const { hits } = await searchCorpus(env, workspaceId, ownerId, query, { limit });
    return {
      enabled: true,
      passages: hits.map((h) => ({ cite: h.cite, text: h.text, source: h.source, ...(h.page ? { page: h.page } : {}), url: h.url })),
    };
  },
};
