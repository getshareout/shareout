import type { Env } from '../types';
import { chatComplete, getBuildConfig } from '../data/agent/anthropic';
import {
  upsertLearnedFile,
  deleteKnowledgeFile,
  getKnowledgeFile,
  listKnowledgeFilesByPrefix,
  isTombstoned,
  setLastConsolidatedAt,
  listConsolidationCandidates,
  clearKnowledgeRebuild,
} from './store';
import { upsertKnowledgeVector, deleteKnowledgeVector } from './distill';
import { parseNode } from './parse';
import type { KnowledgeNode } from './types';
import { topicPath, entityPath, artifactIdFromDigestPath, INDEX_PATH, PROVENANCE_LINE } from './types';
import {
  appendTimeline,
  byLearnedDesc,
  dropPage,
  findStaleNotes,
  isStale,
  pruneDeadDigests,
  rebuildFeed,
  reenqueueStaleDigests,
} from './upkeep';

const MAX_WORKSPACES_PER_NIGHT = 25;
const MAX_TOPIC_CALLS_PER_WS = 10;
const MAX_ENTITY_CALLS_PER_WS = 10;
const MAX_LLM_CALLS_PER_RUN = 60; // global — the whole scheduled() shares a subrequest budget
const MAX_RUN_MS = 180_000; // wall clock, checked before each workspace AND each LLM call
const MAX_DIGESTS_PER_PAGE_CALL = 12; // newest first
const DIGEST_EXCERPT_CAP = 700; // chars of digest body fed per new note
const CURRENT_PAGE_CAP = 6_000; // chars of existing page body fed back
const PAGE_BODY_CAP = 4_000; // hard truncate of LLM output body
const MAX_ALIAS_NAMES_PER_CALL = 40; // unresolved entity names per night; rest deferred
const SAFE_SLUG = /^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u;
const MAX_PAGE_ENTITIES = 20;
const MAX_PAGE_ALIASES = 20;
const OVERVIEW_TOP_TOPICS = 15;
const OVERVIEW_MAX_PAGES = 30;
const PAGE_MAX_TOKENS = 900;
const ALIAS_MAX_TOKENS = 400;
const OVERVIEW_MAX_TOKENS = 400;

const TOPIC_SYSTEM = `You maintain one evolving topic page in a workspace's knowledge base.
You receive the CURRENT page body and NEW notes distilled from recently updated pages.
Rewrite the page body, merging the new facts into the old.
Rules:
- At most 25 bullet facts / about 350 words. Concrete facts and numbers only, no preamble, no headings.
- When a new fact updates an older version of the same fact (a newer monthly number, a changed status), keep ONLY the newest — no history, no "previously".
- Drop any fact that only came from a REMOVED source.
- Never invent facts absent from the inputs. If nothing changes, return the current body unchanged.
Respond with a single JSON object on the first line, then a blank line, then the page body in markdown.
JSON shape: {"title": string}`;

const ENTITY_SYSTEM = `You maintain one evolving entity page (a client, product, person or system) in a workspace's knowledge base.
You receive the CURRENT page body and NEW notes distilled from recently updated pages.
Rewrite the page body, merging the new facts into the old.
Rules:
- At most 25 bullet facts / about 350 words. Concrete facts and numbers only, no preamble, no headings.
- When a new fact updates an older version of the same fact (a newer monthly number, a changed status), keep ONLY the newest — no history, no "previously".
- Drop any fact that only came from a REMOVED source.
- Never invent facts absent from the inputs. If nothing changes, return the current body unchanged.
Respond with a single JSON object on the first line, then a blank line, then the page body in markdown.
JSON shape: {"title": string, "aliases": string[]}`;

const ALIAS_SYSTEM = `You canonicalize entity names for a workspace's knowledge base.
Given EXISTING entities (slug: title, aliases) and NEW names, return for each new name one of:
- an existing slug, when it clearly refers to the same real-world thing (company, product, person, system);
- a shared canonical name, when two or more NEW names refer to the same thing — use the cleanest, most complete surface form as the identical value for every name in that group (e.g. "Acme" for "Acme", "Acme App", "the Acme team");
- "new", when it is distinct from every existing entity and every other new name.
Respond with exactly one JSON object: {"<new name>": "<existing slug>" | "<canonical name>" | "new"}.`;

const OVERVIEW_SYSTEM = `You write the trunk overview of a workspace's knowledge base — what this
workspace is about, for a teammate or agent seeing it for the first time.
120-200 words of plain concrete prose. No headings, no hype, no lists.
Mention the main topics, clients/products, and anything with hard numbers.
Respond with the prose only.`;

/** `workspaceId` says whom the call is metered to. */
export type ConsolidateComplete = (system: string, user: string, workspaceId?: string) => Promise<string>;

export interface ConsolidateResult {
  workspaces: number;
  topicPages: number;
  entityPages: number;
  pruned: number;
  llmCalls: number;
  skipped: number;
}

// ---------- pure helpers ----------

function asList(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean);
  return String(value)
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
}

function yamlList(items: string[]): string {
  return `[${items.map(s => JSON.stringify(s)).join(', ')}]`;
}

function dedupeCap(items: string[], cap: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    if (!it || seen.has(it)) continue;
    seen.add(it);
    out.push(it);
    if (out.length >= cap) break;
  }
  return out;
}

// A note's sources decide who may read it, so they are never capped (readers see the newest 50).
const allSources = (items: string[]) => dedupeCap(items, Infinity);

export function normalizeEntitySlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .replace(/^the\s+/, '')
    // ponytail: conservative — no suffix stripping ("Acme app" ≠ auto-acme; that's the alias LLM's job).
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function titleFromSlug(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map(w => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

function parsePageResponse(
  response: string,
  fallbackTitle: string
): { title: string; aliases: string[]; body: string } {
  const match = response.match(/\{[\s\S]*?\}/);
  let title = fallbackTitle;
  let aliases: string[] = [];
  let body = response.trim();
  if (match) {
    try {
      const h = JSON.parse(match[0]) as { title?: unknown; aliases?: unknown };
      if (typeof h.title === 'string' && h.title.trim()) title = h.title.trim();
      aliases = asList(h.aliases);
      body = response.slice(match.index! + match[0].length).trim();
    } catch {
      // malformed JSON — treat whole response as body
    }
  }
  return { title, aliases, body: body.slice(0, PAGE_BODY_CAP) };
}

function buildNotesBlock(digests: KnowledgeNode[]): string {
  return digests
    .map(d => {
      const src = d.sources[0] ?? artifactIdFromDigestPath(d.path);
      const when = (d.learnedAt ?? '').slice(0, 10);
      return `### ${d.title} (learned ${when}, source ${src})\n${d.body.slice(0, DIGEST_EXCERPT_CAP)}`;
    })
    .join('\n\n');
}

// ---------- run state ----------

interface RunCtx {
  env: Env;
  complete: ConsolidateComplete;
  model: string;
  nowIso: string;
  now: Date;
  llmCalls: number;
  startedAt: number;
}

function budgetOk(ctx: RunCtx): boolean {
  return ctx.llmCalls < MAX_LLM_CALLS_PER_RUN && Date.now() - ctx.startedAt < MAX_RUN_MS;
}

async function llm(ctx: RunCtx, ws: string, system: string, user: string): Promise<string> {
  const out = await ctx.complete(system, user, ws);
  ctx.llmCalls++;
  return out;
}

// ---------- dirty set ----------

async function collectDirtyDigests(
  env: Env,
  ws: string,
  watermark: string | null
): Promise<KnowledgeNode[]> {
  const rows = (
    await env.DB.prepare(
      `SELECT path, content FROM workspace_files
       WHERE workspace_id = ? AND namespace = 'knowledge' AND path LIKE 'artifacts/%'
         AND updated_at > COALESCE(?, '1970-01-01')
       ORDER BY updated_at DESC`
    )
      .bind(ws, watermark)
      .all<{ path: string; content: string }>()
  ).results;
  const nodes: KnowledgeNode[] = [];
  for (const row of rows) {
    const { node } = parseNode(row.path, row.content);
    if (node) nodes.push(node);
  }
  return nodes;
}

// ---------- alias resolution ----------

interface AliasResolution {
  map: Map<string, string>; // normalized raw name -> canonical slug
  existingEntities: KnowledgeNode[];
}

async function buildAliasMap(env: Env, ws: string): Promise<AliasResolution> {
  const files = await listKnowledgeFilesByPrefix(env, ws, 'entities/');
  const map = new Map<string, string>();
  const existingEntities: KnowledgeNode[] = [];
  for (const f of files) {
    const { node } = parseNode(f.path, f.content);
    if (!node) continue;
    existingEntities.push(node);
    const slug = f.path.slice('entities/'.length, -'.md'.length);
    map.set(slug, slug);
    for (const a of asList(node.extra.aliases)) map.set(normalizeEntitySlug(a), slug);
  }
  return { map, existingEntities };
}

async function resolveAliases(
  ctx: RunCtx,
  ws: string,
  res: AliasResolution,
  rawNames: string[]
): Promise<void> {
  // Dedupe by NORMALIZED form: names that already collapse to the same slug ("Acme"/"acme")
  // need no LLM — only names that normalize DIFFERENTLY are candidates for clustering.
  const seenNorm = new Set<string>();
  const unresolved: string[] = [];
  for (const raw of rawNames) {
    const norm = normalizeEntitySlug(raw);
    if (!norm || res.map.has(norm) || seenNorm.has(norm)) continue;
    seenNorm.add(norm);
    unresolved.push(raw);
  }
  const deduped = dedupeCap(unresolved, MAX_ALIAS_NAMES_PER_CALL);
  // Call the LLM when there's something to adjudicate: map names onto EXISTING entities, OR
  // cluster ≥2 distinct-normalizing NEW names among themselves (night-1 dup fix — one new name
  // with no existing entities has nothing to map or cluster, so skip the call).
  const shouldCall =
    budgetOk(ctx) &&
    deduped.length > 0 &&
    (res.existingEntities.length > 0 || deduped.length >= 2);
  if (!shouldCall) {
    // no LLM: everything unresolved becomes its own new slug
    for (const raw of unresolved) res.map.set(normalizeEntitySlug(raw), normalizeEntitySlug(raw));
    return;
  }

  const existingLines = res.existingEntities
    .slice(0, OVERVIEW_MAX_PAGES)
    .map(n => {
      const slug = n.path.slice('entities/'.length, -'.md'.length);
      const aliases = asList(n.extra.aliases);
      return `- ${slug}: ${JSON.stringify(n.title)}${aliases.length ? ` (aliases: ${aliases.join(', ')})` : ''}`;
    })
    .join('\n');
  const user = `EXISTING:\n${existingLines || '(none)'}\n\nNEW NAMES:\n${deduped.map(n => `- ${n}`).join('\n')}`;

  const slugSet = new Set(res.existingEntities.map(n => n.path.slice('entities/'.length, -'.md'.length)));
  let mapping: Record<string, unknown> = {};
  try {
    const out = await llm(ctx, ws, ALIAS_SYSTEM, user);
    const m = out.match(/\{[\s\S]*\}/);
    if (m) mapping = JSON.parse(m[0]) as Record<string, unknown>;
  } catch {
    mapping = {}; // malformed / throw → treat all as new (safe: each gets its own slug)
  }

  for (const raw of deduped) {
    const target = mapping[raw];
    let canonical = normalizeEntitySlug(raw);
    if (typeof target === 'string' && target !== 'new' && target.trim()) {
      // existing slug → map onto it; else a shared canonical key clusters the night's new names
      // into ONE slug (the cleanest surface form), with the others carried as aliases.
      canonical = slugSet.has(target) ? target : normalizeEntitySlug(target) || canonical;
    }
    res.map.set(normalizeEntitySlug(raw), canonical);
  }
  // any names past the per-call cap: give them their own slug this night
  for (const raw of unresolved) {
    const norm = normalizeEntitySlug(raw);
    if (!res.map.has(norm)) res.map.set(norm, norm);
  }
}

function resolveSlug(res: AliasResolution, raw: string): string {
  const norm = normalizeEntitySlug(raw);
  return res.map.get(norm) ?? norm;
}

// ---------- topic evolve ----------

async function evolveTopicPage(
  ctx: RunCtx,
  ws: string,
  slug: string,
  digests: KnowledgeNode[],
  removedTitles: string[],
  res: AliasResolution,
  withdrawn: Set<string>
): Promise<boolean> {
  const path = topicPath(slug);
  if (await isTombstoned(ctx.env, ws, path)) return false; // a forgotten topic is never re-learned

  const existing = await getKnowledgeFile(ctx.env, ws, path);
  let currentBody = '';
  let oldSources: string[] = [];
  let oldEntities: string[] = [];
  let rebuild = false;
  if (existing) {
    if (existing.source === 'manual') return false; // human's page — don't even call the LLM
    const { node } = parseNode(existing.path, existing.content);
    if (node?.pinned) return false;
    rebuild = !!node && isStale(node, withdrawn);
    currentBody = node?.body ?? '';
    oldSources = node?.sources ?? [];
    oldEntities = node?.entities ?? [];
  }
  let fed = digests.slice(0, MAX_DIGESTS_PER_PAGE_CALL);
  if (rebuild) {
    fed = await rebuildFeed(ctx.env, ws, oldSources, digests, withdrawn);
    if (!fed.length) return dropPage(ctx.env, ws, path);
    currentBody = '';
    oldSources = [];
    oldEntities = [];
    removedTitles = [];
  }
  if (!fed.length && !currentBody) return false; // nothing to build, nothing to prune
  if (!budgetOk(ctx)) return false;

  const user = [
    `Topic: ${slug}`,
    '',
    'CURRENT PAGE:',
    currentBody ? currentBody.slice(0, CURRENT_PAGE_CAP) : rebuild ? '(empty — rebuilt from its sources)' : '(empty — new topic)',
    ...(removedTitles.length
      ? ['', 'REMOVED SOURCES (facts only from these must be dropped):', ...removedTitles.map(t => `- ${t}`)]
      : []),
    '',
    'NEW NOTES:',
    fed.length ? buildNotesBlock(fed) : '(none)',
  ].join('\n');

  let response: string;
  try {
    response = await llm(ctx, ws, TOPIC_SYSTEM, user);
  } catch {
    return false; // keep old page on a bad response
  }
  const parsed = parsePageResponse(response, titleFromSlug(slug));
  if (!parsed.body) return false; // never blank a page

  const fedIds = fed.map(d => d.sources[0] ?? artifactIdFromDigestPath(d.path));
  const sources = allSources([...fedIds, ...oldSources]);
  const fedEntities = fed.flatMap(d => d.entities.map(e => `entity.${resolveSlug(res, e)}`));
  const entities = dedupeCap([...oldEntities, ...fedEntities], MAX_PAGE_ENTITIES);

  const fm = [
    '---',
    'kind: topic',
    `id: topic.${slug}`,
    `title: ${JSON.stringify(parsed.title)}`,
    `topics: ${yamlList([slug])}`,
    `sources: ${yamlList(sources)}`,
    PROVENANCE_LINE,
    `entities: ${yamlList(entities)}`,
    'confidence: inferred',
    `learned_at: ${ctx.nowIso}`,
    'pinned: false',
    '---',
  ].join('\n');
  const wrote = await upsertLearnedFile(ctx.env, ws, {
    path,
    content: `${fm}\n${parsed.body}\n`,
    source: 'consolidated',
  });
  if (!wrote) return false;
  await upsertKnowledgeVector(ctx.env, ws, path, 'topic', `${parsed.title}\n${parsed.body}`);
  return true;
}

// ---------- entity evolve ----------

async function evolveEntityPage(
  ctx: RunCtx,
  ws: string,
  slug: string,
  digests: KnowledgeNode[],
  seedAliases: string[],
  removedTitles: string[],
  res: AliasResolution,
  withdrawn: Set<string>,
  // Duplicate-merge seed: the loser page folded into this winner. Its FULL body (bounded by
  // PAGE_BODY_CAP, not the 700-char digest cap) and FULL sources are carried over — F4.
  mergeSeed?: { title: string; body: string; sources: string[] }
): Promise<boolean> {
  const path = entityPath(slug);
  if (await isTombstoned(ctx.env, ws, path)) return false;

  const existing = await getKnowledgeFile(ctx.env, ws, path);
  let currentBody = '';
  let oldSources: string[] = [];
  let oldAliases: string[] = [];
  let oldTopics: string[] = [];
  let rebuild = false;
  if (existing) {
    if (existing.source === 'manual') return false;
    const { node } = parseNode(existing.path, existing.content);
    if (node?.pinned) return false;
    rebuild = !!node && isStale(node, withdrawn);
    currentBody = node?.body ?? '';
    oldSources = node?.sources ?? [];
    oldAliases = asList(node?.extra.aliases);
    oldTopics = node?.topics ?? [];
  }
  let fed = digests.slice(0, MAX_DIGESTS_PER_PAGE_CALL);
  if (rebuild) {
    // Aliases may have come from a withdrawn page too: keep only names the kept digests use.
    fed = await rebuildFeed(ctx.env, ws, oldSources, digests, withdrawn);
    if (!fed.length) return dropPage(ctx.env, ws, path);
    seedAliases = fed.flatMap(d => d.entities.filter(raw => resolveSlug(res, raw) === slug));
    currentBody = '';
    oldSources = [];
    oldAliases = [];
    oldTopics = [];
    removedTitles = [];
    mergeSeed = undefined;
  }
  if (!fed.length && !currentBody && !mergeSeed) return false;
  if (!budgetOk(ctx)) return false;

  const noteBlocks: string[] = [];
  if (mergeSeed)
    noteBlocks.push(
      `### ${mergeSeed.title} (merged duplicate)\n${mergeSeed.body.slice(0, PAGE_BODY_CAP)}`
    );
  if (fed.length) noteBlocks.push(buildNotesBlock(fed));

  const user = [
    `Entity: ${slug}`,
    '',
    'CURRENT PAGE:',
    currentBody ? currentBody.slice(0, CURRENT_PAGE_CAP) : rebuild ? '(empty — rebuilt from its sources)' : '(empty — new entity)',
    ...(removedTitles.length
      ? ['', 'REMOVED SOURCES (facts only from these must be dropped):', ...removedTitles.map(t => `- ${t}`)]
      : []),
    '',
    'NEW NOTES:',
    noteBlocks.length ? noteBlocks.join('\n\n') : '(none)',
  ].join('\n');

  let response: string;
  try {
    response = await llm(ctx, ws, ENTITY_SYSTEM, user);
  } catch {
    return false;
  }
  const parsed = parsePageResponse(response, titleFromSlug(slug));
  if (!parsed.body) return false;

  const fedIds = fed.map(d => d.sources[0] ?? artifactIdFromDigestPath(d.path));
  const sources = allSources([...fedIds, ...(mergeSeed?.sources ?? []), ...oldSources]);
  const aliases = dedupeCap(
    [...oldAliases, ...seedAliases, ...parsed.aliases].map(a => a.trim()).filter(Boolean),
    MAX_PAGE_ALIASES
  );
  const topics = dedupeCap([...oldTopics, ...fed.flatMap(d => d.topics)], MAX_PAGE_ENTITIES);

  const fm = [
    '---',
    'kind: entity',
    `id: entity.${slug}`,
    `title: ${JSON.stringify(parsed.title)}`,
    `topics: ${yamlList(topics)}`,
    `sources: ${yamlList(sources)}`,
    PROVENANCE_LINE,
    `aliases: ${yamlList(aliases)}`,
    'confidence: inferred',
    `learned_at: ${ctx.nowIso}`,
    'pinned: false',
    '---',
  ].join('\n');
  const wrote = await upsertLearnedFile(ctx.env, ws, {
    path,
    content: `${fm}\n${parsed.body}\n`,
    source: 'consolidated',
  });
  if (!wrote) return false;
  await upsertKnowledgeVector(ctx.env, ws, path, 'entity', `${parsed.title}\n${parsed.body}`);
  return true;
}

// ---------- duplicate-entity merge (deterministic: alias/slug collision) ----------

interface MergePair {
  winner: KnowledgeNode;
  loser: KnowledgeNode;
}

function entityNodeSlug(n: KnowledgeNode): string {
  return n.path.slice('entities/'.length, -'.md'.length);
}

// Two existing entity nodes are the same when one's normalized alias equals another's
// slug ("operator spots acme + acme-app", or an adjudicated alias from a prior night).
function findEntityMerges(entities: KnowledgeNode[]): MergePair[] {
  const bySlug = new Map<string, KnowledgeNode>();
  for (const n of entities) bySlug.set(entityNodeSlug(n), n);
  const pairs: MergePair[] = [];
  const done = new Set<string>();
  for (const n of entities) {
    for (const alias of asList(n.extra.aliases)) {
      const other = bySlug.get(normalizeEntitySlug(alias));
      if (!other || other === n) continue;
      const key = [entityNodeSlug(n), entityNodeSlug(other)].sort().join('|');
      if (done.has(key)) continue;
      done.add(key);
      // winner = more sources; tie → shorter slug
      const [a, b] = [n, other];
      const winner =
        a.sources.length !== b.sources.length
          ? a.sources.length > b.sources.length
            ? a
            : b
          : entityNodeSlug(a).length <= entityNodeSlug(b).length
            ? a
            : b;
      const loser = winner === a ? b : a;
      pairs.push({ winner, loser });
    }
  }
  return pairs;
}

async function mergeEntity(
  ctx: RunCtx,
  ws: string,
  pair: MergePair,
  winnerDirty: KnowledgeNode[],
  winnerRemoved: string[],
  res: AliasResolution,
  withdrawn: Set<string>
): Promise<boolean> {
  const winnerSlug = entityNodeSlug(pair.winner);
  const loserSlug = entityNodeSlug(pair.loser);
  // Never merge when either side is pinned or manual — leave both.
  const loserFile = await getKnowledgeFile(ctx.env, ws, pair.loser.path);
  const winnerFile = await getKnowledgeFile(ctx.env, ws, pair.winner.path);
  if (
    pair.winner.pinned ||
    pair.loser.pinned ||
    loserFile?.source === 'manual' ||
    winnerFile?.source === 'manual'
  )
    return false;

  // Loser folded into the winner: its full body + full sources carried as a mergeSeed (F4);
  // loser slug + aliases become winner aliases so its old name resolves to the winner, not a
  // resurrected page. Winner's own new digests ride along so this night's facts aren't lost (F3).
  const seedAliases = [loserSlug, ...asList(pair.loser.extra.aliases)];
  const mergeSeed = {
    title: pair.loser.title,
    body: pair.loser.body,
    sources: pair.loser.sources,
  };
  const wrote = await evolveEntityPage(
    ctx,
    ws,
    winnerSlug,
    winnerDirty,
    seedAliases,
    winnerRemoved,
    res,
    withdrawn,
    mergeSeed
  );
  if (!wrote) return false;
  // Plain delete, NOT a tombstone: the alias resolves the old name to the winner, and a
  // future distill can re-learn the page if it was merged on a bad (hallucinated) alias (F2).
  await deleteKnowledgeFile(ctx.env, ws, pair.loser.path);
  await deleteKnowledgeVector(ctx.env, ws, pair.loser.path);
  return true;
}

// ---------- overview (trunk) ----------

// The overview goes to every member's assistant, so it is written only from pages whose sources
// every member can open (a stale page still waiting for its rebuild is left out), and it records
// those sources so it is withheld again the moment one of them stops being open to all.
async function regenerateOverview(ctx: RunCtx, ws: string, withdrawn: Set<string>): Promise<void> {
  const existing = await getKnowledgeFile(ctx.env, ws, INDEX_PATH);
  if (existing?.source === 'manual') return; // human-edited trunk is never overwritten
  if (existing && parseNode(existing.path, existing.content).node?.pinned) return; // pinned trunk

  const topicFiles = await listKnowledgeFilesByPrefix(ctx.env, ws, 'topics/');
  const entityFiles = await listKnowledgeFilesByPrefix(ctx.env, ws, 'entities/');
  const topicNodes = topicFiles
    .map(f => parseNode(f.path, f.content).node)
    .filter((n): n is KnowledgeNode => !!n && !isStale(n, withdrawn));
  const entityNodes = entityFiles
    .map(f => parseNode(f.path, f.content).node)
    .filter((n): n is KnowledgeNode => !!n && !isStale(n, withdrawn));
  const digestCount =
    (
      await ctx.env.DB.prepare(
        "SELECT COUNT(*) AS n FROM workspace_files WHERE workspace_id = ? AND namespace = 'knowledge' AND path LIKE 'artifacts/%'"
      )
        .bind(ws)
        .first<{ n: number }>()
    )?.n ?? 0;

  if (!budgetOk(ctx)) return;
  const fedTopics = topicNodes.slice(0, OVERVIEW_MAX_PAGES);
  const fedEntities = entityNodes.slice(0, OVERVIEW_MAX_PAGES);
  const topicsBlock = fedTopics.map(n => `- ${n.title}: ${n.body.slice(0, 200)}`).join('\n');
  const entitiesLine = fedEntities.map(n => n.title).join(', ');
  const user = `TOPICS:\n${topicsBlock || '(none)'}\n\nENTITIES: ${entitiesLine || '(none)'}\n\nPAGES LEARNED: ${digestCount}`;

  let prose: string;
  try {
    prose = (await llm(ctx, ws, OVERVIEW_SYSTEM, user)).trim();
  } catch {
    return; // keep old index
  }
  if (!prose) return;

  // ## Top topics stays deterministic: rank topic pages by their source count (a
  // proxy for tag frequency), so the trunk never needs a full-digest scan.
  const topNodes = [...topicNodes]
    .sort((a, b) => b.sources.length - a.sources.length)
    .slice(0, OVERVIEW_TOP_TOPICS);
  const top = topNodes.map(n => `- [[topic.${topicNodeSlug(n)}]] (${n.sources.length})`);
  const sources = allSources([...fedTopics, ...fedEntities, ...topNodes].flatMap(n => n.sources));
  const fm = [
    '---',
    'kind: overview',
    'id: index',
    'title: "Workspace knowledge"',
    `sources: ${yamlList(sources)}`,
    PROVENANCE_LINE,
    `learned_at: ${ctx.nowIso}`,
    'pinned: false',
    '---',
  ].join('\n');
  const body = [prose, '', '## Top topics', ...(top.length ? top : ['- none yet'])].join('\n');
  const wrote = await upsertLearnedFile(ctx.env, ws, {
    path: INDEX_PATH,
    content: `${fm}\n${body}\n`,
    source: 'consolidated',
  });
  if (wrote) await upsertKnowledgeVector(ctx.env, ws, INDEX_PATH, 'overview', `${prose}`);
}

function topicNodeSlug(n: KnowledgeNode): string {
  return n.path.slice('topics/'.length, -'.md'.length);
}

// ---------- per-workspace pipeline ----------

async function consolidateWorkspace(
  ctx: RunCtx,
  ws: string,
  watermark: string | null,
  rebuildRequestedAt: string | null,
  result: ConsolidateResult
): Promise<'done' | 'skipped'> {
  // (review note 2) capture the watermark ceiling right before reading dirty digests.
  // ponytail: strict `updated_at > watermark` — a digest written in the same second
  // consolidation starts waits until its next edit to be folded in. Fine for a nightly job.
  // MUST match D1's strftime('%Y-%m-%dT%H:%M:%fZ','now') format ('YYYY-MM-DD HH:MM:SS', space + no ms/Z) —
  // workspace_files.updated_at is written that way, and both the candidate query and the
  // dirty-digest query compare it against this watermark as a raw string. A ' ' (0x20)
  // sorts below 'T' (0x54), so an ISO watermark would make same-date digests compare LESS
  // than the watermark and never be seen as dirty (silent data loss).
  const runStartedAt = ctx.now.toISOString().slice(0, 19).replace('T', ' ');
  // per-workspace deltas (F5): `result` is the whole-run accumulator, so `changed` must be
  // computed from THIS workspace's contribution, not the fleet-global totals.
  const t0 = result.topicPages;
  const e0 = result.entityPages;

  const removed = await pruneDeadDigests(ctx.env, ws);
  result.pruned += removed.length;
  await reenqueueStaleDigests(ctx.env, ws, runStartedAt.slice(0, 10));

  const dirtyAll = await collectDirtyDigests(ctx.env, ws, watermark);
  // Notes citing a page members can no longer all open are rebuilt first (privacy before
  // freshness), and a pinned or hand-written digest of such a page never feeds shared notes.
  const { withdrawn, stale } = await findStaleNotes(ctx.env, ws, dirtyAll.flatMap(d => d.sources));
  const dirty = dirtyAll.filter(d => !d.sources.some(id => withdrawn.has(id)));
  const staleUnder = (prefix: string) =>
    [...stale].filter(p => p.startsWith(prefix)).map(p => p.slice(prefix.length, -'.md'.length));
  // A page from before slugs were normalized could carry a newline into the rewritten
  // frontmatter (F6); such a page is dropped instead of rebuilt.
  for (const prefix of ['topics/', 'entities/'])
    for (const slug of staleUnder(prefix))
      if (!SAFE_SLUG.test(slug)) await dropPage(ctx.env, ws, `${prefix}${slug}.md`);
  const staleSlugs = (prefix: string) => staleUnder(prefix).filter(slug => SAFE_SLUG.test(slug));

  // group topics + collect removed titles. Topic slugs come from the distill LLM (page-
  // steered) — normalize them (same as entities) so a slug like "retention\npinned: true"
  // can't inject a frontmatter line via the raw `id: topic.${slug}` / topicPath(slug).
  const dirtyTopics = new Map<string, KnowledgeNode[]>();
  for (const d of dirty)
    for (const raw of d.topics) {
      const t = normalizeEntitySlug(raw);
      if (!t) continue;
      (dirtyTopics.get(t) ?? dirtyTopics.set(t, []).get(t)!).push(d);
    }
  const removedByTopic = new Map<string, string[]>();
  for (const r of removed)
    for (const raw of r.topics) {
      const t = normalizeEntitySlug(raw);
      if (!t) continue;
      (removedByTopic.get(t) ?? removedByTopic.set(t, []).get(t)!).push(r.title);
    }

  // entity resolution
  const res = await buildAliasMap(ctx.env, ws);
  const rawEntityNames = [
    ...new Set([...dirty.flatMap(d => d.entities), ...removed.flatMap(r => r.entities)]),
  ];
  await resolveAliases(ctx, ws, res, rawEntityNames);

  // group dirty digests + removed titles per canonical entity slug (built BEFORE the merge
  // pass so a merge can fold in the winner's AND loser's own new digests that night — F3).
  const dirtyEntities = new Map<string, { digests: KnowledgeNode[]; aliases: Set<string> }>();
  for (const d of dirty)
    for (const raw of d.entities) {
      const slug = resolveSlug(res, raw);
      const e = dirtyEntities.get(slug) ?? { digests: [], aliases: new Set() };
      e.digests.push(d);
      e.aliases.add(raw);
      dirtyEntities.set(slug, e);
    }
  const removedByEntity = new Map<string, string[]>();
  for (const r of removed)
    for (const raw of r.entities) {
      const slug = resolveSlug(res, raw);
      (removedByEntity.get(slug) ?? removedByEntity.set(slug, []).get(slug)!).push(r.title);
    }

  // duplicate-node merges (deterministic) — winners join the entity dirty set
  const merges = findEntityMerges(res.existingEntities);
  const mergedWinners = new Set<string>();
  for (const pair of merges) {
    if (!budgetOk(ctx)) break;
    // A stale side is rebuilt on its own first; the pair can merge on a later night.
    if (stale.has(pair.winner.path) || stale.has(pair.loser.path)) continue;
    const winnerSlug = entityNodeSlug(pair.winner);
    const loserSlug = entityNodeSlug(pair.loser);
    // Fold both sides' new digests (deduped by path) into the winner this night, else the
    // watermark advances past facts that never landed on any page (F3).
    const byPath = new Map<string, KnowledgeNode>();
    for (const d of dirtyEntities.get(winnerSlug)?.digests ?? []) byPath.set(d.path, d);
    for (const d of dirtyEntities.get(loserSlug)?.digests ?? []) byPath.set(d.path, d);
    const winnerDirty = [...byPath.values()].sort(byLearnedDesc);
    const winnerRemoved = [
      ...(removedByEntity.get(winnerSlug) ?? []),
      ...(removedByEntity.get(loserSlug) ?? []),
    ];
    if (await mergeEntity(ctx, ws, pair, winnerDirty, winnerRemoved, res, withdrawn)) {
      mergedWinners.add(winnerSlug);
      mergedWinners.add(loserSlug); // loser slug excluded from the evolve pass → no resurrection
      result.entityPages++;
    }
  }

  // topic evolve (stale pages first, then biggest signal first, capped)
  const topicSlugs = [
    ...new Set([
      ...staleSlugs('topics/'),
      ...[...new Set([...dirtyTopics.keys(), ...removedByTopic.keys()])].sort(
        (a, b) => (dirtyTopics.get(b)?.length ?? 0) - (dirtyTopics.get(a)?.length ?? 0)
      ),
    ]),
  ].slice(0, MAX_TOPIC_CALLS_PER_WS);
  for (const slug of topicSlugs) {
    if (!budgetOk(ctx)) return 'skipped';
    const digests = (dirtyTopics.get(slug) ?? []).slice().sort(byLearnedDesc);
    if (await evolveTopicPage(ctx, ws, slug, digests, removedByTopic.get(slug) ?? [], res, withdrawn))
      result.topicPages++;
  }

  // entity evolve (stale pages first, capped) — skip winners already written by the merge pass
  const entitySlugs = [
    ...new Set([
      ...staleSlugs('entities/'),
      ...[...new Set([...dirtyEntities.keys(), ...removedByEntity.keys()])].sort(
        (a, b) => (dirtyEntities.get(b)?.digests.length ?? 0) - (dirtyEntities.get(a)?.digests.length ?? 0)
      ),
    ]),
  ]
    .filter(s => !mergedWinners.has(s))
    .slice(0, MAX_ENTITY_CALLS_PER_WS);
  for (const slug of entitySlugs) {
    if (!budgetOk(ctx)) return 'skipped';
    const e = dirtyEntities.get(slug);
    const digests = (e?.digests ?? []).slice().sort(byLearnedDesc);
    if (
      await evolveEntityPage(
        ctx,
        ws,
        slug,
        digests,
        [...(e?.aliases ?? [])],
        removedByEntity.get(slug) ?? [],
        res,
        withdrawn
      )
    )
      result.entityPages++;
  }

  await appendTimeline(ctx.env, ctx.nowIso, ws, dirty, withdrawn, staleUnder('timeline/'));

  const changed =
    result.topicPages - t0 + (result.entityPages - e0) > 0 || removed.length > 0;
  if (changed || stale.has(INDEX_PATH)) await regenerateOverview(ctx, ws, withdrawn);

  await setLastConsolidatedAt(ctx.env, ws, runStartedAt);
  // The request is served once nothing is left to rebuild. Checking again (rather than trusting
  // this run's list) also catches a page that went private while it ran; whatever is left —
  // over the per-run caps, or a call that failed — keeps the request for the next run.
  if (rebuildRequestedAt && !(await findStaleNotes(ctx.env, ws)).stale.size) {
    await clearKnowledgeRebuild(ctx.env, ws, rebuildRequestedAt);
  }
  return 'done';
}

// ---------- entry point ----------

export async function runKnowledgeConsolidate(
  env: Env,
  opts?: { complete?: ConsolidateComplete; now?: Date }
): Promise<ConsolidateResult> {
  const result: ConsolidateResult = {
    workspaces: 0,
    topicPages: 0,
    entityPages: 0,
    pruned: 0,
    llmCalls: 0,
    skipped: 0,
  };
  const config = getBuildConfig(env);
  const complete: ConsolidateComplete | null =
    opts?.complete ??
    (config
      ? (system, user, workspaceId) =>
          chatComplete(
            env,
            { workspaceId: workspaceId ?? null, userId: null, kind: 'knowledge_consolidate', source: 'knowledge' },
            [{ role: 'user', content: user }],
            system,
            system.startsWith('You canonicalize')
              ? ALIAS_MAX_TOKENS
              : system.startsWith('You write the trunk')
                ? OVERVIEW_MAX_TOKENS
                : PAGE_MAX_TOKENS,
            config
          )
      : null);
  if (!complete) return result;

  const now = opts?.now ?? new Date();
  const ctx: RunCtx = {
    env,
    complete,
    model: config?.model ?? 'injected',
    nowIso: now.toISOString(),
    now,
    llmCalls: 0,
    startedAt: Date.now(),
  };

  const candidates = await listConsolidationCandidates(env, MAX_WORKSPACES_PER_NIGHT);
  for (const cand of candidates) {
    if (!budgetOk(ctx)) {
      result.skipped++;
      continue;
    }
    try {
      const state = await consolidateWorkspace(ctx, cand.workspaceId, cand.lastConsolidatedAt, cand.rebuildRequestedAt, result);
      if (state === 'done') result.workspaces++;
      else result.skipped++;
    } catch {
      // workspace-fatal error → watermark untouched, redo next night; move on
      result.skipped++;
    }
  }

  result.llmCalls = ctx.llmCalls;
  return result;
}
