/**
 * Knowledge tools: cited search over a workspace's Files and pages, and the knowledge
 * graph (entities, connections, facts with quoted evidence). Each one replays the real
 * /v1/workspaces/{id}/knowledge/* route in-process as the caller, so the membership
 * check, the on/off switch, per-source visibility and usage metering all apply unchanged.
 */
import { routeKnowledgeApi } from '../router/api/knowledge';
import { createFetchContext } from '../router/context';
import { visibleSources } from '../knowledge/corpus/search';
import type { SourceKind } from '../knowledge/corpus/client';
import type { BotWorkspace } from '../chat-agent/access';
import {
  NOT_MEMBER, ON_FAILURE, errorText, fail, ok, readJson, resolveWorkspace, str, workspaceChoiceText,
  type Args, type ToolContext, type ToolDef, type ToolResult,
} from './tool-kit';

const ANSWER = 'Answer in the person\'s language, only from what this returns, and say where each fact comes from (the page or file name, with its link when there is one).';

const WORKSPACE_ARG = { type: 'string', description: 'Which workspace to look in. Needed when the person has more than one — ask them which.' };

interface Cite { kind: SourceKind; id: string; title: string; url: string | null }
interface EntitySummary { id: string; type: string; name: string; aliases: string[]; mentions: number; sources: Cite[] }
interface EntityDetail {
  entity: EntitySummary;
  facts: Array<{ predicate: string; value: string; unit: string | null; validFrom: string | null; quote: string; source: Cite }>;
  relations: Array<{ type: string; direction: 'out' | 'in'; other: { id: string; name: string; type: string }; mentions: number; sources: Cite[] }>;
  mentions: Array<{ quote: string; cite: string; source: Cite }>;
}

const citeText = (s: Cite) => (s.url ? `${s.title} (${s.url})` : s.title);

async function knowledgeGet(ctx: ToolContext, workspaceId: string, sub: string, params: Record<string, string> = {}, post?: unknown) {
  const qs = new URLSearchParams(params).toString();
  const req = new Request(`${ctx.origin}/v1/workspaces/${encodeURIComponent(workspaceId)}/knowledge/${sub}${qs ? `?${qs}` : ''}`, {
    headers: { Authorization: ctx.authorization, ...(post !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(post !== undefined ? { method: 'POST', body: JSON.stringify(post) } : {}),
  });
  const res = await routeKnowledgeApi(createFetchContext(req, ctx.env, ctx.executionCtx));
  return { status: res?.status ?? 404, body: res ? await readJson(res) : {} };
}

/** The result to send back instead of data: knowledge off, not set up, not a member, or an error. */
function notAnswered(w: BotWorkspace, status: number, body: Record<string, unknown>): ToolResult {
  if (body.code === 'KNOWLEDGE_DISABLED') {
    return ok(`Knowledge is turned off for "${w.name}", so there is nothing to look in yet. A workspace owner or admin can turn it on in ShareOut, in the Knowledge section.`, { enabled: false, workspace_id: w.id });
  }
  if (body.code === 'NOT_CONFIGURED') return ok('Knowledge is not available on this ShareOut instance.', { enabled: false, configured: false });
  if (status === 403) return fail(NOT_MEMBER);
  return fail(`Could not read the workspace's knowledge: ${errorText(body, status)}`, { status, code: body.code });
}

async function pickWorkspace(ctx: ToolContext, args: Args, action: string): Promise<BotWorkspace | ToolResult> {
  const resolved = await resolveWorkspace(ctx, str(args.workspace_id, 100));
  if (resolved.notMember) return fail(NOT_MEMBER);
  if (resolved.choices) return ok(workspaceChoiceText(action, resolved.choices), { needs_workspace: true, workspaces: resolved.choices });
  if (!resolved.workspace) return ok('Knowledge lives in a workspace, and the person has none yet.', { enabled: false });
  return resolved.workspace;
}

/** Like pickWorkspace, but a named workspace the person is not in is still tried: the
 *  reindex/status routes let instance admins in anywhere and refuse everyone else. */
async function pickAdminWorkspace(ctx: ToolContext, args: Args, action: string): Promise<BotWorkspace | ToolResult> {
  const requested = str(args.workspace_id, 100);
  const resolved = await resolveWorkspace(ctx, requested);
  if (resolved.notMember && requested) return { id: requested, name: requested, slug: requested, role: 'member', artifactCount: 0 };
  return pickWorkspace(ctx, args, action);
}

interface CorpusSource {
  id: string; kind: SourceKind; title: string; status: string; version: string; chunker_version: number; outdated: boolean;
  chunks: number; chunks_with_page: number; chunks_with_anchor: number; error: string | null;
}
interface CorpusStatusBody { chunker_version: number; last_reindex_at: string | null; counts: Record<string, number>; sources: CorpusSource[] }

const isResult = (v: unknown): v is ToolResult => typeof v === 'object' && v !== null && 'content' in v;

/** Entities matching a name (exact name or alias first), or the one whose id was given. */
async function findEntities(ctx: ToolContext, w: BotWorkspace, name: string, limit: number): Promise<EntitySummary[] | ToolResult> {
  const list = await knowledgeGet(ctx, w.id, 'entities', { q: name, limit: String(limit) });
  if (list.status !== 200) return notAnswered(w, list.status, list.body);
  const found = (list.body.entities ?? []) as EntitySummary[];
  if (!found.length) {
    const byId = await knowledgeGet(ctx, w.id, `entities/${encodeURIComponent(name)}`);
    return byId.status === 200 ? [(byId.body as unknown as EntityDetail).entity] : [];
  }
  const want = name.toLowerCase();
  const exact = (e: EntitySummary) => [e.name, ...e.aliases].some((a) => a.toLowerCase() === want);
  return [...found.filter(exact), ...found.filter((e) => !exact(e))];
}

async function entityDetail(ctx: ToolContext, w: BotWorkspace, id: string): Promise<EntityDetail | null> {
  const one = await knowledgeGet(ctx, w.id, `entities/${encodeURIComponent(id)}`);
  return one.status === 200 ? (one.body as unknown as EntityDetail) : null;
}

const nothingKnown = (name: string, w: BotWorkspace) =>
  ok(`Nothing is known about "${name}" in "${w.name}" yet. Try knowledge_search with other words, or tell the person it is not in the workspace's files and pages.`, { found: false, workspace_id: w.id });

const factLine = (owner: string, f: EntityDetail['facts'][number]) =>
  `- ${owner} · ${f.predicate}: ${f.value}${f.unit ? ` ${f.unit}` : ''}${f.validFrom ? ` (from ${f.validFrom})` : ''} — "${f.quote}" [${citeText(f.source)}]`;

// ── tools ───────────────────────────────────────────────────────────────────

const knowledgeSearch: ToolDef = {
  name: 'knowledge_search',
  title: 'Search what the team knows',
  description: [
    'Searches everything the workspace has learned from its Files and pages and returns the passages that answer a question, each with its source.',
    'Use it first for any question about the team\'s clients, projects, numbers, people or decisions.',
    'Write the query in the words the person would use (any language).',
    ANSWER, 'Cite passages by their [number] and source name.', ON_FAILURE,
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The question or the words to look for.' },
      workspace_id: WORKSPACE_ARG,
      limit: { type: 'integer', minimum: 1, maximum: 20, default: 8 },
    },
    required: ['query'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run(ctx, args) {
    const query = str(args.query, 500);
    if (!query) return fail('query is required.');
    const w = await pickWorkspace(ctx, args, 'knowledge_search');
    if (isResult(w)) return w;
    const limit = Math.min(Math.max(Number(args.limit) || 8, 1), 20);
    const { status, body } = await knowledgeGet(ctx, w.id, 'search', { q: query, limit: String(limit) });
    if (status !== 200) return notAnswered(w, status, body);
    const hits = (body.hits ?? []) as Array<{ text: string; locator: string; cite: string; source: Cite; url?: string | null }>;
    if (!hits.length) {
      return ok(`Nothing in "${w.name}" matches "${query}". Tell the person it is not in the workspace's files and pages (or try other words).`, { workspace_id: w.id, query, hits: [] });
    }
    const text = [
      `${hits.length} passages from "${w.name}" for "${query}":`,
      ...hits.map((h, i) => {
        const label = h.locator && h.locator !== h.source.title ? `${h.source.title} — ${h.locator}` : h.source.title;
        const link = h.url ?? h.source.url;
        return `\n[${i + 1}] ${label}${link ? ` — ${link}` : ''}\n${h.text}`;
      }),
      `\n${ANSWER} Cite by [number].`,
    ].join('\n');
    return ok(text, { workspace_id: w.id, query, mode: body.mode, hits });
  },
};

const knowledgeEntity: ToolDef = {
  name: 'knowledge_entity',
  title: 'Look up a client, person or project',
  description: [
    'Looks up one thing the workspace knows about — a company, client, person, product or project — by name:',
    'what it is, what it is connected to (its neighbours), and which files and pages mention it.',
    'Use knowledge_facts for its numbers and dates.', ANSWER, ON_FAILURE,
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'The name as the person said it, or an entity id from an earlier result.' },
      workspace_id: WORKSPACE_ARG,
    },
    required: ['name'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run(ctx, args) {
    const name = str(args.name, 200);
    if (!name) return fail('name is required.');
    const w = await pickWorkspace(ctx, args, 'knowledge_entity');
    if (isResult(w)) return w;
    const found = await findEntities(ctx, w, name, 5);
    if (isResult(found)) return found;
    const x = found[0] ? await entityDetail(ctx, w, found[0].id) : null;
    if (!x) return nothingKnown(name, w);
    const e = x.entity;
    const others = found.slice(1);
    const aliases = e.aliases.filter((a) => a !== e.name);
    const lines = [
      `${e.name} (${e.type}) in "${w.name}"${aliases.length ? ` — also called ${aliases.join(', ')}` : ''}. Mentioned ${e.mentions} times.`,
      'Sources:', ...e.sources.map((s) => `- ${citeText(s)}`),
      ...(x.relations.length ? ['Connected to:', ...x.relations.map((r) => r.direction === 'out'
        ? `- ${e.name} ${r.type} ${r.other.name} (${r.other.type}) [${r.sources.map((s) => s.title).join('; ')}]`
        : `- ${r.other.name} (${r.other.type}) ${r.type} ${e.name} [${r.sources.map((s) => s.title).join('; ')}]`)] : []),
      ...(x.mentions.length ? ['What the sources say:', ...x.mentions.slice(0, 8).map((m) => `- "${m.quote}" [${m.cite}]`)] : []),
      ...(x.facts.length ? [`${x.facts.length} facts on record — call knowledge_facts for them.`] : []),
      ...(others.length ? [`Other matches for "${name}": ${others.map((o) => `${o.name} (${o.type}, id ${o.id})`).join(', ')}.`] : []),
      ANSWER,
    ];
    return ok(lines.join('\n'), {
      workspace_id: w.id,
      entity: e,
      neighbours: x.relations,
      mentions: x.mentions.slice(0, 8),
      fact_count: x.facts.length,
      other_matches: others,
    });
  },
};

const knowledgeFacts: ToolDef = {
  name: 'knowledge_facts',
  title: 'Facts about a client, person or project',
  description: [
    'Returns the recorded facts (amounts, dates, statuses, owners…) about a company, client, person or project,',
    'each with the exact sentence it came from and its source. Optional filter keeps only facts whose name or value contains those words.',
    ANSWER, 'Quote the evidence when the person asks how we know.', ON_FAILURE,
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      about: { type: 'string', description: 'Who or what the facts are about, by name (or an entity id).' },
      filter: { type: 'string', description: 'Only facts mentioning this, e.g. "budget" or "2026".' },
      workspace_id: WORKSPACE_ARG,
    },
    required: ['about'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run(ctx, args) {
    const about = str(args.about, 200);
    if (!about) return fail('about is required.');
    const filter = str(args.filter, 100)?.toLowerCase() ?? null;
    const w = await pickWorkspace(ctx, args, 'knowledge_facts');
    if (isResult(w)) return w;
    const found = await findEntities(ctx, w, about, 3);
    if (isResult(found)) return found;
    if (!found.length) return nothingKnown(about, w);

    const details = (await Promise.all(found.map((e) => entityDetail(ctx, w, e.id)))).filter((d): d is EntityDetail => !!d);
    const facts = details.flatMap((d) => d.facts
      .filter((f) => !filter || [f.predicate, f.value, f.unit ?? '', f.validFrom ?? '', f.quote].join(' ').toLowerCase().includes(filter))
      .map((f) => ({ entity: { id: d.entity.id, name: d.entity.name, type: d.entity.type }, ...f })));
    const names = details.map((d) => d.entity.name).join(', ');
    if (!facts.length) {
      return ok(`No facts${filter ? ` about "${filter}"` : ''} are recorded for ${names || about} in "${w.name}". knowledge_search may still find passages that mention it.`, { workspace_id: w.id, facts: [] });
    }
    const text = [
      `${facts.length} facts about ${names} in "${w.name}" (fact — "evidence" [source]):`,
      ...facts.map((f) => factLine(f.entity.name, f)),
      ANSWER,
    ].join('\n');
    return ok(text, { workspace_id: w.id, facts });
  },
};

const knowledgeStatus: ToolDef = {
  name: 'knowledge_status',
  title: 'What the workspace has learned',
  description: [
    'Says whether knowledge is on for a workspace, how many files and pages are learned, which are still being processed,',
    'which could not be read, and how many people, companies and projects it knows about.',
    'Use it when a search finds nothing or the person asks what is covered. Answer in the person\'s language.', ON_FAILURE,
  ].join(' '),
  inputSchema: { type: 'object', properties: { workspace_id: WORKSPACE_ARG }, additionalProperties: false },
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run(ctx, args) {
    const w = await pickWorkspace(ctx, args, 'knowledge_status');
    if (isResult(w)) return w;
    const [src, ent, st] = await Promise.all([
      knowledgeGet(ctx, w.id, 'sources', { limit: '200' }),
      knowledgeGet(ctx, w.id, 'entities', { limit: '1' }),
      knowledgeGet(ctx, w.id, 'status'),
    ]);
    const corpus = st.status === 200 ? (st.body.corpus as CorpusStatusBody | null) ?? null : null;
    if (src.status !== 200) return notAnswered(w, src.status, src.body);
    const counts = src.body.counts as Record<string, number>;
    const rows = (src.body.sources ?? []) as Array<{ refId: string; kind: SourceKind; status: string; error: string | null; chunkCount: number }>;
    // The store lists every source; only name the ones this person may see.
    const { visible } = await visibleSources(ctx.env, w.id, ctx.user.id, rows);
    const sources = rows.filter((r) => visible.has(r.refId)).map((r) => ({
      kind: r.kind, id: r.refId, title: visible.get(r.refId)!.title, url: visible.get(r.refId)!.url, status: r.status, error: r.error, passages: r.chunkCount,
    }));
    const types = ent.status === 200 ? (ent.body.types ?? []) as Array<{ type: string; count: number }> : [];
    const entityTotal = types.reduce((n, t) => n + t.count, 0);
    const named = (status: string) => sources.filter((s) => s.status === status);
    const list = (label: string, items: typeof sources) =>
      items.length ? [label, ...items.slice(0, 20).map((s) => `- ${s.title}${s.error ? ` (${s.error})` : ''}`)] : [];
    const text = [
      `Knowledge is on for "${w.name}".`,
      `Learned: ${counts.ready ?? 0} files and pages (${Number(src.body.chunks ?? 0)} passages). Processing: ${counts.processing ?? 0}. Could not read: ${counts.failed ?? 0}. Not supported: ${counts.unsupported ?? 0}.`,
      entityTotal ? `Knows about ${entityTotal} people, companies, projects and other things (${types.slice(0, 6).map((t) => `${t.type} ${t.count}`).join(', ')}).` : 'No people, companies or projects extracted yet.',
      ...list('Still processing:', named('processing')),
      ...list('Could not be read:', named('failed')),
      ...list('Not supported (file type):', named('unsupported')),
      ...(corpus?.sources.some((c) => c.outdated) ? [`${corpus.sources.filter((c) => c.outdated).length} sources were learned by an older chunker; they are re-learned overnight, or now with knowledge_reindex.`] : []),
    ].join('\n');
    return ok(text, { workspace_id: w.id, enabled: true, counts, passages: src.body.chunks, entity_types: types, sources, corpus });
  },
};

function corpusText(w: BotWorkspace, enabled: boolean, c: CorpusStatusBody | null): string {
  if (!enabled) return `Knowledge is turned off for "${w.name}".`;
  if (!c) return 'Knowledge is not available on this ShareOut instance.';
  return [
    `Corpus of "${w.name}": ${c.counts.ready ?? 0} ready, ${c.counts.queued ?? 0} queued, ${c.counts.failed ?? 0} failed, ${c.counts.unsupported ?? 0} unsupported. Last reindex: ${c.last_reindex_at ?? 'never'}.`,
    ...c.sources.slice(0, 40).map((s) => `- ${s.title} [${s.status}] ${s.chunks} passages (${s.chunks_with_page} on sub-pages, ${s.chunks_with_anchor} with a section link)${s.outdated ? ' — older chunker' : ''}${s.error ? ` — ${s.error}` : ''}`),
  ].join('\n');
}

const knowledgeReindex: ToolDef = {
  name: 'knowledge_reindex',
  title: 'Re-learn the workspace\'s files and pages',
  description: [
    'Re-learns every file and page of a workspace (or only artifact_ids) even when they did not change, so answers can cite the exact sub-page and section.',
    'Only workspace owners and admins (and instance admins) may run it, once every 10 minutes per workspace. It costs AI usage, so run it only when asked or when knowledge_status shows sources from an older chunker.',
    'With check_only it starts nothing and reports each source (queued / ready / failed, passages, how many cite a sub-page or section, last error) — use it to follow progress.',
    'Answer in the person\'s language.', ON_FAILURE,
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      workspace_id: WORKSPACE_ARG,
      artifact_ids: { type: 'array', items: { type: 'string' }, maxItems: 300, description: 'Only these pages/files. Omit for all of them.' },
      check_only: { type: 'boolean', description: 'Only report progress; start nothing.' },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  async run(ctx, args) {
    const w = await pickAdminWorkspace(ctx, args, 'knowledge_reindex');
    if (isResult(w)) return w;
    if (args.check_only === true) {
      const st = await knowledgeGet(ctx, w.id, 'status');
      if (st.status !== 200) return st.status === 403 ? fail(NOT_MEMBER) : notAnswered(w, st.status, st.body);
      const corpus = (st.body.corpus as CorpusStatusBody | null) ?? null;
      return ok(corpusText(w, st.body.enabled !== false, corpus), { workspace_id: w.id, enabled: st.body.enabled !== false, corpus });
    }
    const ids = Array.isArray(args.artifact_ids) ? (args.artifact_ids as unknown[]).filter((v): v is string => typeof v === 'string') : null;
    const { status, body } = await knowledgeGet(ctx, w.id, 'reindex', {}, ids?.length ? { artifactIds: ids } : {});
    if (status === 429) return ok(`A reindex of "${w.name}" already ran in the last 10 minutes. ${String(body.hint ?? '')}`.trim(), { workspace_id: w.id, rate_limited: true });
    if (status === 403) return fail('Only an owner or admin of that workspace can re-learn it.');
    if (status !== 202) return notAnswered(w, status, body);
    const skipped = (body.skipped ?? []) as string[];
    return ok([
      `Re-learning ${Number(body.queued)} files and pages of "${w.name}"${Number(body.remaining) ? ` (${Number(body.remaining)} more left for a later run)` : ''}.`,
      skipped.length ? `Not found or not eligible: ${skipped.join(', ')}.` : '',
      'Call knowledge_reindex with check_only in a few minutes to see progress.',
    ].filter(Boolean).join('\n'), { workspace_id: w.id, ...body });
  },
};

interface SourceArtifact { id: string; slug: string | null; title: string | null; url: string | null; available: boolean }

const knowledgeNote: ToolDef = {
  name: 'knowledge_get',
  title: 'Read one knowledge note',
  description: [
    'Reads one note the workspace has learned (a topic, client, project…) in full, by its path (from knowledge_from_artifact, e.g. topics/retention.md),',
    'with the pages it was learned from. Cite available sources by title with their link; an unavailable source is gone or not visible to the person, so do not guess what it was.',
    ANSWER, ON_FAILURE,
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: { path: { type: 'string', description: 'The note path, ending in .md.' }, workspace_id: WORKSPACE_ARG },
    required: ['path'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run(ctx, args) {
    const path = str(args.path, 300);
    if (!path) return fail('path is required.');
    const w = await pickWorkspace(ctx, args, 'knowledge_get');
    if (isResult(w)) return w;
    const { status, body } = await knowledgeGet(ctx, w.id, `files/${path.split('/').map(encodeURIComponent).join('/')}`);
    if (status === 404 && body.code === 'NOT_FOUND') return ok(`There is no note "${path}" in "${w.name}" (or Knowledge is off there).`, { found: false, workspace_id: w.id });
    if (status !== 200) return notAnswered(w, status, body);
    const node = body.node as { title?: string; kind?: string; body?: string; source_artifacts?: SourceArtifact[] };
    const sources = node.source_artifacts ?? [];
    const text = [
      `${node.title ?? path} (${node.kind ?? 'note'}) in "${w.name}":`,
      node.body ?? '',
      ...(sources.length ? ['Learned from:', ...sources.map((s) => s.available ? `- ${s.title} (${s.url})` : '- a page that is gone or not visible to the person')] : []),
      ANSWER,
    ].join('\n');
    return ok(text, { workspace_id: w.id, node });
  },
};

const knowledgeFromArtifact: ToolDef = {
  name: 'knowledge_from_artifact',
  title: 'Notes learned from a page',
  description: ['Lists the knowledge notes the workspace learned from one page (the reverse of a note\'s sources), with the paths knowledge_get takes. Empty when the person cannot open the page.', ANSWER].join(' '),
  inputSchema: {
    type: 'object',
    properties: { artifact_id: { type: 'string', description: 'The page id.' }, workspace_id: WORKSPACE_ARG },
    required: ['artifact_id'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  async run(ctx, args) {
    const artifactId = str(args.artifact_id, 100);
    if (!artifactId) return fail('artifact_id is required.');
    // Default to the page's own workspace. The route still checks membership and that the
    // person may open the page, so reading this column decides nothing about access.
    let wsArgs = args;
    if (!str(args.workspace_id, 100)) {
      const row = await ctx.env.DB.prepare('SELECT workspace_id FROM artifacts WHERE id = ?').bind(artifactId).first<{ workspace_id: string | null }>();
      if (row?.workspace_id) wsArgs = { ...args, workspace_id: row.workspace_id };
    }
    const w = await pickWorkspace(ctx, wsArgs, 'knowledge_from_artifact');
    if (isResult(w)) return w;
    const { status, body } = await knowledgeGet(ctx, w.id, `from/${encodeURIComponent(artifactId)}`);
    if (status !== 200) return notAnswered(w, status, body);
    if (body.enabled === false) return notAnswered(w, 200, { code: 'KNOWLEDGE_DISABLED' });
    const notes = (body.notes ?? []) as Array<{ path: string; kind: string; id: string; title: string }>;
    const text = notes.length
      ? [`${notes.length} notes in "${w.name}" were learned from this page:`, ...notes.map((n) => `- ${n.title} (${n.kind}) — path ${n.path}`)].join('\n')
      : `No notes in "${w.name}" come from this page (or the person cannot open it).`;
    return ok(text, { workspace_id: w.id, artifact_id: artifactId, notes });
  },
};

export const KNOWLEDGE_TOOLS: ToolDef[] = [knowledgeSearch, knowledgeEntity, knowledgeFacts, knowledgeStatus, knowledgeReindex, knowledgeNote, knowledgeFromArtifact];
