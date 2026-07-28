import type { AccountTool, ToolContext } from './types';
import { PERSONAL_SCOPE } from '../../chat-platforms/types';
import {
  isCatalogEnabled,
  loadCatalog,
  searchEntries,
  traverseLineage,
  type CatalogEntry,
} from '../../catalog';

const MAX_RESULTS = 50;

function workspaceId(ctx: ToolContext): string | null {
  const ws = ctx.selectedWorkspaceId;
  return typeof ws === 'string' && ws !== PERSONAL_SCOPE ? ws : null;
}

function summarize(e: CatalogEntry) {
  return {
    id: e.id,
    kind: e.kind,
    title: e.title,
    status: e.status,
    domain: e.domain,
    fqn: e.fqn,
    connection: e.connection,
    artifact: e.artifact,
    store: e.store,
    tags: e.tags,
    upstream: e.upstream,
    downstream: e.downstream,
  };
}

export const catalogSearchTool: AccountTool = {
  name: 'catalog_search',
  description:
    "Search this workspace's data catalog (an optional, opt-in map of its datasets, sources, pipelines, metrics and business terms). Use it BEFORE building or querying to ground on real table names (fqn), pick certified data, and avoid deprecated sources. Returns nothing if the workspace has no catalog.",
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Free-text match over id, title, body, tags, terms.' },
      kind: { type: 'string', description: 'Filter by kind: source, event, dataset, table, view, pipeline, dashboard, model, metric, term.' },
      domain: { type: 'string', description: 'Filter by domain (e.g. chat, growth).' },
      status: { type: 'string', description: 'Filter by status: draft, certified, deprecated.' },
      tag: { type: 'string', description: 'Filter by an exact tag (e.g. tier.silver, PII.None).' },
    },
  },
  async execute(ctx, input) {
    const wsId = workspaceId(ctx);
    if (!wsId) return { error: 'The catalog is only available inside a workspace.' };
    if (!(await isCatalogEnabled(ctx.env, wsId))) {
      return { enabled: false, message: 'This workspace has no data catalog.' };
    }
    const { entries } = await loadCatalog(ctx.env, wsId);
    const results = searchEntries(entries, {
      q: typeof input.query === 'string' ? input.query : undefined,
      kind: typeof input.kind === 'string' ? input.kind : undefined,
      domain: typeof input.domain === 'string' ? input.domain : undefined,
      status: typeof input.status === 'string' ? input.status : undefined,
      tag: typeof input.tag === 'string' ? input.tag : undefined,
    });
    return {
      enabled: true,
      total: entries.length,
      count: results.length,
      truncated: results.length > MAX_RESULTS,
      entries: results.slice(0, MAX_RESULTS).map(summarize),
    };
  },
};

export const catalogGetTool: AccountTool = {
  name: 'catalog_get',
  description:
    'Read one catalog entry in full (its prose/notes plus metadata) and its lineage — what it reads from (upstream) and what depends on it (downstream). Use after catalog_search to understand where data comes from before relying on it.',
  input_schema: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'The catalog entry id (from catalog_search).' },
    },
    required: ['id'],
  },
  async execute(ctx, input) {
    const wsId = workspaceId(ctx);
    if (!wsId) return { error: 'The catalog is only available inside a workspace.' };
    if (!(await isCatalogEnabled(ctx.env, wsId))) {
      return { enabled: false, message: 'This workspace has no data catalog.' };
    }
    const id = typeof input.id === 'string' ? input.id.trim() : '';
    if (!id) return { error: 'Tell me which entry to read (id).' };
    const { entries } = await loadCatalog(ctx.env, wsId);
    const entry = entries.find(e => e.id === id);
    if (!entry) return { error: `No catalog entry with id “${id}”.` };
    return {
      enabled: true,
      entry: { ...summarize(entry), owner: entry.owner, body: entry.body },
      upstreamAll: traverseLineage(entries, id, 'upstream'),
      downstreamAll: traverseLineage(entries, id, 'downstream'),
    };
  },
};
