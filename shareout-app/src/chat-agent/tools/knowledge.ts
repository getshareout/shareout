import type { AccountTool, ToolContext } from './types';
import type { Env } from '../../types';
import { isKnowledgeEnabled, loadKnowledge } from '../../knowledge/store';
import { NODE_KINDS, type KnowledgeNode } from '../../knowledge/types';
import { corpusFor } from '../../knowledge/corpus/client';
import { searchCorpus, visibleSources } from '../../knowledge/corpus/search';
import { listVisibleEntities, visibleEntity } from '../../knowledge/corpus/graph';
import { scopedWorkspaceId, selectedWorkspace } from '../scope';
import { sourceArtifacts } from '../../knowledge/source-links';

const MAX_RESULTS = 20;
const SEMANTIC_TOPK = 15;
const EMBED_MODEL = '@cf/baai/bge-base-en-v1.5';
const EMBED_TEXT_CAP = 2000;
const DISABLED_MESSAGE = "Knowledge isn't turned on for this workspace.";
const NO_WORKSPACE = 'Knowledge is only available inside a workspace.';
const PASSAGES = 8;

const NOT_MEMBER = 'You are not a member of this workspace.';

/** The verified workspace id, or the result to return instead (no workspace selected, or not an internal member). */
async function memberWorkspace(ctx: ToolContext): Promise<{ wsId: string } | { error: string }> {
  if (!selectedWorkspace(ctx.selectedWorkspaceId)) return { error: NO_WORKSPACE };
  const wsId = await scopedWorkspaceId(ctx);
  return wsId ? { wsId } : { error: NOT_MEMBER };
}

type Corpus = NonNullable<ReturnType<typeof corpusFor>>;

/** The member's workspace corpus, or the result to return instead (no workspace, not a member, off, not configured). */
async function corpusScope(ctx: ToolContext): Promise<{ wsId: string; store: Corpus } | Record<string, unknown>> {
  const member = await memberWorkspace(ctx);
  if (!('wsId' in member)) return member;
  const { wsId } = member;
  if (!(await isKnowledgeEnabled(ctx.env, wsId))) return { enabled: false, message: DISABLED_MESSAGE };
  const store = corpusFor(ctx.env, wsId);
  return store ? { wsId, store } : { enabled: false, message: 'Knowledge search is not available on this instance.' };
}

const isScope = (v: object): v is { wsId: string; store: Corpus } => 'store' in v;

/** Entities matching a name (exact name or alias first), else the one with that id. */
async function findEntities(ctx: ToolContext, wsId: string, store: Corpus, name: string, limit: number) {
  const { entities } = await listVisibleEntities(ctx.env, store, wsId, ctx.userId, { q: name, limit });
  if (!entities.length) {
    const byId = await visibleEntity(ctx.env, store, wsId, ctx.userId, name);
    return byId ? [byId.entity] : [];
  }
  const want = name.toLowerCase();
  const exact = (e: (typeof entities)[number]) => [e.name, ...e.aliases].some(a => a.toLowerCase() === want);
  return [...entities.filter(exact), ...entities.filter(e => !exact(e))];
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
    "Search what this workspace knows. Returns `passages` (cited excerpts from its uploaded Files — PDFs, docs, sheets — and pages) plus `nodes` (distilled notes: topics, clients, decisions). Use it first for any question about the workspace's clients, projects, numbers or people, and cite each passage's `cite` with its `url` (it opens the right sub-page and section). For where-is-this-covered questions prefer find_passages.",
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
    const member = await memberWorkspace(ctx);
    if (!('wsId' in member)) return member;
    const { wsId } = member;
    if (!(await isKnowledgeEnabled(ctx.env, wsId))) {
      return { enabled: false, message: DISABLED_MESSAGE };
    }
    const query = typeof input.query === 'string' ? input.query : '';
    const scope = query.trim() && !input.kind ? await corpusScope(ctx) : null;
    const passages = scope && isScope(scope)
      ? (await searchCorpus(ctx.env, wsId, ctx.userId, query, { limit: PASSAGES })).hits
          .map(h => ({ cite: h.cite, text: h.text, source: h.source, ...(h.page ? { page: h.page } : {}), url: h.url }))
      : [];
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
      passages,
    };
  },
};

export const knowledgeGetTool: AccountTool = {
  name: 'knowledge_get',
  description:
    'Read one knowledge node in full — its distilled notes plus the pages it was learned from. Use after knowledge_search to get the detail behind a topic, client or fact. `sources` lists each page as { id, slug, title, url, available }: cite available ones by title, linking their absolute `url`; an unavailable one is gone or not visible to this person, so do not guess what it was.',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'The node path (from knowledge_search), e.g. topics/retention.md.' },
      id: { type: 'string', description: 'The node id (from knowledge_search), e.g. topic.retention.' },
    },
  },
  async execute(ctx, input) {
    const member = await memberWorkspace(ctx);
    if (!('wsId' in member)) return member;
    const { wsId } = member;
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
      node: { ...summarize(node), body: node.body, sources: await sourceArtifacts(ctx.env, wsId, ctx.userId, node.sources) },
    };
  },
};

export const knowledgeEntityTool: AccountTool = {
  name: 'knowledge_entity',
  description:
    'Look up one company, client, person, product or project the workspace knows about, by name: what it is, what it connects to, and the quoted passages that mention it. Use knowledge_facts for its numbers and dates.',
  input_schema: {
    type: 'object',
    properties: { name: { type: 'string', description: 'The name as the person said it, or an entity id from an earlier result.' } },
    required: ['name'],
  },
  async execute(ctx, input) {
    const scope = await corpusScope(ctx);
    if (!isScope(scope)) return scope;
    const name = typeof input.name === 'string' ? input.name.trim().slice(0, 200) : '';
    if (!name) return { error: 'Tell me who or what to look up.' };
    const found = await findEntities(ctx, scope.wsId, scope.store, name, 5);
    const x = found[0] ? await visibleEntity(ctx.env, scope.store, scope.wsId, ctx.userId, found[0].id) : null;
    if (!x) return { enabled: true, found: false, message: `Nothing is known about “${name}” yet.` };
    return {
      enabled: true,
      found: true,
      entity: x.entity,
      relations: x.relations,
      mentions: x.mentions.slice(0, 8),
      fact_count: x.facts.length,
      other_matches: found.slice(1),
    };
  },
};

export const knowledgeFactsTool: AccountTool = {
  name: 'knowledge_facts',
  description:
    'Recorded facts (amounts, dates, statuses, owners, steps…) about a company, client, person or project, each with the exact sentence it came from and its source. `filter` keeps only facts containing those words.',
  input_schema: {
    type: 'object',
    properties: {
      about: { type: 'string', description: 'Who or what the facts are about, by name (or an entity id).' },
      filter: { type: 'string', description: 'Only facts mentioning this, e.g. "budget" or "2026".' },
    },
    required: ['about'],
  },
  async execute(ctx, input) {
    const scope = await corpusScope(ctx);
    if (!isScope(scope)) return scope;
    const about = typeof input.about === 'string' ? input.about.trim().slice(0, 200) : '';
    if (!about) return { error: 'Tell me who or what the facts are about.' };
    const filter = typeof input.filter === 'string' && input.filter.trim() ? input.filter.trim().toLowerCase() : null;
    const found = await findEntities(ctx, scope.wsId, scope.store, about, 3);
    const details = (await Promise.all(found.map(e => visibleEntity(ctx.env, scope.store, scope.wsId, ctx.userId, e.id))))
      .filter((d): d is NonNullable<typeof d> => !!d);
    const facts = details.flatMap(d => d.facts
      .filter(f => !filter || [f.predicate, f.value, f.unit ?? '', f.validFrom ?? '', f.quote].join(' ').toLowerCase().includes(filter))
      .map(f => ({ entity: { id: d.entity.id, name: d.entity.name, type: d.entity.type }, ...f })));
    return { enabled: true, count: facts.length, facts };
  },
};

export const knowledgeStatusTool: AccountTool = {
  name: 'knowledge_status',
  description:
    'What the workspace has learned: how many files and pages are learned, which are still processing or could not be read, and how many people, companies and projects it knows. Use it when a search finds nothing or the person asks what is covered.',
  input_schema: { type: 'object', properties: {} },
  async execute(ctx) {
    const scope = await corpusScope(ctx);
    if (!isScope(scope)) return scope;
    const [src, ent] = await Promise.all([
      scope.store.listSources(200),
      listVisibleEntities(ctx.env, scope.store, scope.wsId, ctx.userId, { limit: 1 }),
    ]);
    // The store lists every source; only name the ones this person may see.
    const { visible } = await visibleSources(ctx.env, scope.wsId, ctx.userId, src.sources);
    const sources = src.sources.filter(r => visible.has(r.refId)).map(r => ({
      kind: r.kind, id: r.refId, title: visible.get(r.refId)!.title, url: visible.get(r.refId)!.url,
      status: r.status, error: r.error, passages: r.chunkCount,
    }));
    return { enabled: true, counts: src.counts, passages: src.chunks, entity_types: ent.types, sources };
  },
};
