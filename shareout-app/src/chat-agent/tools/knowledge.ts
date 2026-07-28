import type { AccountTool, ToolContext } from './types';
import type { Env } from '../../types';
import { PERSONAL_SCOPE } from '../../chat-platforms/types';
import {
  isKnowledgeEnabled,
  loadKnowledge,
  NODE_KINDS,
  type KnowledgeNode,
} from '../../knowledge';

const MAX_RESULTS = 20;
const SEMANTIC_TOPK = 15;
const EMBED_MODEL = '@cf/baai/bge-base-en-v1.5';
const EMBED_TEXT_CAP = 2000;
const DISABLED_MESSAGE = "Knowledge isn't turned on for this workspace.";

function workspaceId(ctx: ToolContext): string | null {
  const ws = ctx.selectedWorkspaceId;
  return typeof ws === 'string' && ws !== PERSONAL_SCOPE ? ws : null;
}

function summarize(n: KnowledgeNode) {
  return {
    path: n.path,
    kind: n.kind,
    id: n.id,
    title: n.title,
    topics: n.topics,
    entities: n.entities,
    learned_at: n.learnedAt ?? null,
    pinned: n.pinned,
  };
}

// Access is enforced by filtering ids to the kn:<wsId>: prefix — Vectorize
// metadata is never trusted for access (same rule as search/semantic.ts).
async function semanticPaths(env: Env, wsId: string, query: string): Promise<string[]> {
  if (!env.VECTORIZE || !env.AI || !query.trim()) return [];
  try {
    const res = (await env.AI.run(EMBED_MODEL, { text: [query.slice(0, EMBED_TEXT_CAP)] })) as {
      data?: number[][];
    };
    const values = res.data?.[0];
    if (!values) return [];
    const q = await env.VECTORIZE.query(values, {
      topK: SEMANTIC_TOPK,
      namespace: 'knowledge',
      returnValues: false,
      returnMetadata: false,
    });
    const prefix = `kn:${wsId}:`;
    return (q.matches || [])
      .map(m => m.id)
      .filter(id => id.startsWith(prefix))
      .map(id => id.slice(prefix.length));
  } catch {
    return [];
  }
}

function substringPaths(nodes: KnowledgeNode[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return nodes
    .filter(n => [n.title, ...n.topics, ...n.entities].join('\n').toLowerCase().includes(q))
    .map(n => n.path);
}

export const knowledgeSearchTool: AccountTool = {
  name: 'knowledge_search',
  description:
    'Search what this workspace knows — topics, clients and facts learned from its pages. Use it to answer questions about the workspace without re-reading every page.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What to look for — a topic, client, person or question.' },
      kind: {
        type: 'string',
        enum: [...NODE_KINDS],
        description: 'Filter by node kind (artifact-digest, topic, entity, decision, timeline, overview).',
      },
    },
    required: ['query'],
  },
  async execute(ctx, input) {
    const wsId = workspaceId(ctx);
    if (!wsId) return { error: 'Knowledge is only available inside a workspace.' };
    if (!(await isKnowledgeEnabled(ctx.env, wsId))) {
      return { enabled: false, message: DISABLED_MESSAGE };
    }
    const query = typeof input.query === 'string' ? input.query : '';
    const kind = typeof input.kind === 'string' ? input.kind : undefined;

    const { nodes } = await loadKnowledge(ctx.env, wsId);
    const byPath = new Map(nodes.map(n => [n.path, n]));

    let results: KnowledgeNode[];
    if (query.trim()) {
      const semantic = await semanticPaths(ctx.env, wsId, query);
      const substr = substringPaths(nodes, query);
      const seen = new Set<string>();
      results = [];
      for (const p of [...semantic, ...substr]) {
        const node = byPath.get(p);
        if (!node || seen.has(p)) continue;
        seen.add(p);
        results.push(node);
      }
    } else {
      results = nodes;
    }

    if (kind) results = results.filter(n => n.kind === kind);
    return {
      enabled: true,
      count: Math.min(results.length, MAX_RESULTS),
      nodes: results.slice(0, MAX_RESULTS).map(summarize),
    };
  },
};

export const knowledgeGetTool: AccountTool = {
  name: 'knowledge_get',
  description:
    'Read one knowledge node in full — its distilled notes plus the pages it was learned from. Use after knowledge_search to get the detail behind a topic, client or fact.',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'The node path (from knowledge_search), e.g. topics/retention.md.' },
      id: { type: 'string', description: 'The node id (from knowledge_search), e.g. topic.retention.' },
    },
  },
  async execute(ctx, input) {
    const wsId = workspaceId(ctx);
    if (!wsId) return { error: 'Knowledge is only available inside a workspace.' };
    if (!(await isKnowledgeEnabled(ctx.env, wsId))) {
      return { enabled: false, message: DISABLED_MESSAGE };
    }
    const key = typeof input.path === 'string' && input.path.trim()
      ? input.path.trim()
      : typeof input.id === 'string'
        ? input.id.trim()
        : '';
    if (!key) return { error: 'Tell me which node to read (path or id).' };

    const { nodes } = await loadKnowledge(ctx.env, wsId);
    const node = nodes.find(n => n.path === key || n.id === key);
    if (!node) return { error: `Nothing learned under “${key}” yet.` };
    return {
      enabled: true,
      node: { ...summarize(node), body: node.body, sources: node.sources },
    };
  },
};
