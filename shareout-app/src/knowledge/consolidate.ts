import type { Env } from '../types';
import { chatComplete, getBuildConfig } from '../data/agent/anthropic';
import { recordAiUsage } from '../data/ai-usage';
import {
  upsertLearnedFile,
  deleteKnowledgeFile,
  getKnowledgeFile,
  listKnowledgeFilesByPrefix,
  isTombstoned,
  setLastConsolidatedAt,
  listConsolidationCandidates,
} from './store';
import { upsertKnowledgeVector, deleteKnowledgeVector } from './distill';
import { enqueueIngest } from './ingest';
import { parseNode } from './parse';
import type { KnowledgeNode } from './types';
import {
  topicPath,
  entityPath,
  timelinePath,
  artifactIdFromDigestPath,
  INDEX_PATH,
} from './types';

const MAX_WORKSPACES_PER_NIGHT = 25;
const MAX_TOPIC_CALLS_PER_WS = 10;
const MAX_ENTITY_CALLS_PER_WS = 10;
const MAX_LLM_CALLS_PER_RUN = 60; // global — the whole scheduled() shares a subrequest budget
const MAX_RUN_MS = 180_000; // wall clock, checked before each workspace AND each LLM call
const MAX_DIGESTS_PER_PAGE_CALL = 12; // newest first
const DIGEST_EXCERPT_CAP = 700; // chars of digest body fed per new note
const CURRENT_PAGE_CAP = 6_000; // chars of existing page body fed back
const PAGE_BODY_CAP = 4_000; // hard truncate of LLM output body
const MAX_SOURCES_PER_PAGE = 50; // sources[] frontmatter cap, newest kept
const MAX_ALIAS_NAMES_PER_CALL = 40; // unresolved entity names per night; rest deferred
const MAX_TIMELINE_LINES = 200; // per month file
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

export type ConsolidateComplete = (system: string, user: string) => Promise<string>;

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
  const out = await ctx.complete(system, user);
  ctx.llmCalls++;
  await recordAiUsage(ctx.env, {
    workspaceId: ws,
    userId: null,
    kind: 'knowledge_consolidate',
    model: ctx.model,
    units: Math.ceil(out.length / 4),
    unitKind: 'tokens_out',
    baseCostMicroUsd: 0,
    source: 'knowledge',
  }).catch(() => {});
  return out;
}

// ---------- prune (runs FIRST per workspace) ----------

interface Removed {
  artifactId: string;
  title: string;
  topics: string[];
  entities: string[];
}

async function pruneDeadDigests(env: Env, ws: string): Promise<Removed[]> {
  // artifactId from path 'artifacts/<id>.md': len('artifacts/')=10 → substr start 11;
  // trailing '.md' (3) added to the 10 → subtract 10+3=13 from the length.
  const rows = (
    await env.DB.prepare(
      `SELECT kf.path, kf.content, kf.source FROM workspace_files kf
       LEFT JOIN artifacts a ON a.id = substr(kf.path, 11, length(kf.path) - 13)
       WHERE kf.workspace_id = ? AND kf.namespace = 'knowledge' AND kf.path LIKE 'artifacts/%'
         AND (a.id IS NULL OR a.deleted_at IS NOT NULL)
       LIMIT 200`
    )
      .bind(ws)
      .all<{ path: string; content: string; source: string }>()
  ).results;

  const removed: Removed[] = [];
  for (const row of rows) {
    const { node } = parseNode(row.path, row.content);
    // HARD RULE: pinned or manual digests are the human's — never pruned.
    // Parse failure (node undefined) → keep: corrupted frontmatter could be a pinned node.
    if (!node || row.source === 'manual' || node.pinned) continue;
    await deleteKnowledgeFile(env, ws, row.path); // plain delete, no tombstone — republish re-learns
    await deleteKnowledgeVector(env, ws, row.path);
    removed.push({
      artifactId: artifactIdFromDigestPath(row.path),
      title: node?.title ?? artifactIdFromDigestPath(row.path),
      topics: node?.topics ?? [],
      entities: node?.entities ?? [],
    });
  }
  return removed;
}

async function reenqueueStaleDigests(env: Env, ws: string, today: string): Promise<void> {
  // Cheap prefilter ('stale_after' only appears in a digest that declares one) + LIMIT
  // keep this off a full-content scan of every digest every night (spec §2: targeted reads).
  const rows = (
    await env.DB.prepare(
      `SELECT path, content FROM workspace_files
       WHERE workspace_id = ? AND namespace = 'knowledge' AND path LIKE 'artifacts/%'
         AND content LIKE '%stale_after%'
       LIMIT 200`
    )
      .bind(ws)
      .all<{ path: string; content: string }>()
  ).results;
  for (const row of rows) {
    const { node } = parseNode(row.path, row.content);
    if (node?.staleAfter && node.staleAfter < today) {
      // null hash forces the distiller to reprocess fresh content this hour-cycle.
      await enqueueIngest(env, ws, artifactIdFromDigestPath(row.path), 'stale', null);
    }
  }
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
  res: AliasResolution
): Promise<boolean> {
  const path = topicPath(slug);
  if (await isTombstoned(ctx.env, ws, path)) return false; // a forgotten topic is never re-learned

  const existing = await getKnowledgeFile(ctx.env, ws, path);
  let currentBody = '';
  let oldSources: string[] = [];
  let oldEntities: string[] = [];
  if (existing) {
    if (existing.source === 'manual') return false; // human's page — don't even call the LLM
    const { node } = parseNode(existing.path, existing.content);
    if (node?.pinned) return false;
    currentBody = node?.body ?? '';
    oldSources = node?.sources ?? [];
    oldEntities = node?.entities ?? [];
  }
  const fed = digests.slice(0, MAX_DIGESTS_PER_PAGE_CALL);
  if (!fed.length && !currentBody) return false; // nothing to build, nothing to prune
  if (!budgetOk(ctx)) return false;

  const user = [
    `Topic: ${slug}`,
    '',
    'CURRENT PAGE:',
    currentBody ? currentBody.slice(0, CURRENT_PAGE_CAP) : '(empty — new topic)',
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
  const sources = dedupeCap([...fedIds, ...oldSources], MAX_SOURCES_PER_PAGE);
  const fedEntities = fed.flatMap(d => d.entities.map(e => `entity.${resolveSlug(res, e)}`));
  const entities = dedupeCap([...oldEntities, ...fedEntities], MAX_PAGE_ENTITIES);

  const fm = [
    '---',
    'kind: topic',
    `id: topic.${slug}`,
    `title: ${JSON.stringify(parsed.title)}`,
    `topics: ${yamlList([slug])}`,
    `sources: ${yamlList(sources)}`,
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
  if (existing) {
    if (existing.source === 'manual') return false;
    const { node } = parseNode(existing.path, existing.content);
    if (node?.pinned) return false;
    currentBody = node?.body ?? '';
    oldSources = node?.sources ?? [];
    oldAliases = asList(node?.extra.aliases);
    oldTopics = node?.topics ?? [];
  }
  const fed = digests.slice(0, MAX_DIGESTS_PER_PAGE_CALL);
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
    currentBody ? currentBody.slice(0, CURRENT_PAGE_CAP) : '(empty — new entity)',
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
  const sources = dedupeCap(
    [...fedIds, ...(mergeSeed?.sources ?? []), ...oldSources],
    MAX_SOURCES_PER_PAGE
  );
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
  winnerRemoved: string[]
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
    mergeSeed
  );
  if (!wrote) return false;
  // Plain delete, NOT a tombstone: the alias resolves the old name to the winner, and a
  // future distill can re-learn the page if it was merged on a bad (hallucinated) alias (F2).
  await deleteKnowledgeFile(ctx.env, ws, pair.loser.path);
  await deleteKnowledgeVector(ctx.env, ws, pair.loser.path);
  return true;
}

// ---------- timeline ----------

async function appendTimeline(
  ctx: RunCtx,
  ws: string,
  digests: KnowledgeNode[]
): Promise<void> {
  const byMonth = new Map<string, KnowledgeNode[]>();
  for (const d of digests) {
    const month = (d.learnedAt ?? ctx.nowIso).slice(0, 7);
    (byMonth.get(month) ?? byMonth.set(month, []).get(month)!).push(d);
  }
  for (const [month, list] of byMonth) {
    const path = timelinePath(month);
    const existing = await getKnowledgeFile(ctx.env, ws, path);
    if (existing?.source === 'manual') continue;
    const existingNode = existing ? parseNode(existing.path, existing.content).node : undefined;
    if (existingNode?.pinned) continue; // human-pinned month file — never rewritten
    const parsedBody = existingNode?.body ?? '';
    const lines = parsedBody
      .split('\n')
      .filter(l => l.startsWith('- ') && !l.startsWith('- …and'));
    for (const d of list) {
      const id = d.sources[0] ?? artifactIdFromDigestPath(d.path);
      if (lines.some(l => l.includes(`[${id}]`))) continue; // dedupe by artifact id
      const when = (d.learnedAt ?? ctx.nowIso).slice(0, 10);
      const tags = d.topics.slice(0, 3).join(', ');
      lines.push(`- ${when}: learned ${JSON.stringify(d.title)}${tags ? ` (${tags})` : ''} [${id}]`);
    }
    lines.sort();
    let bodyLines = lines;
    if (lines.length > MAX_TIMELINE_LINES) {
      const overflow = lines.length - MAX_TIMELINE_LINES;
      bodyLines = [...lines.slice(0, MAX_TIMELINE_LINES), `- …and ${overflow} more`];
    }
    const ids = dedupeCap(
      bodyLines.map(l => l.match(/\[([^\]]+)\]$/)?.[1] ?? '').filter(Boolean),
      MAX_SOURCES_PER_PAGE
    );
    const title = new Date(`${month}-01T00:00:00Z`).toLocaleString('en-US', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
    const fm = [
      '---',
      'kind: timeline',
      `id: timeline.${month}`,
      `title: ${JSON.stringify(title)}`,
      `sources: ${yamlList(ids)}`,
      'pinned: false',
      '---',
    ].join('\n');
    await upsertLearnedFile(ctx.env, ws, {
      path,
      content: `${fm}\n${bodyLines.join('\n')}\n`,
      source: 'consolidated',
    });
  }
}

// ---------- overview (trunk) ----------

async function regenerateOverview(ctx: RunCtx, ws: string): Promise<void> {
  const existing = await getKnowledgeFile(ctx.env, ws, INDEX_PATH);
  if (existing?.source === 'manual') return; // human-edited trunk is never overwritten
  if (existing && parseNode(existing.path, existing.content).node?.pinned) return; // pinned trunk

  const topicFiles = await listKnowledgeFilesByPrefix(ctx.env, ws, 'topics/');
  const entityFiles = await listKnowledgeFilesByPrefix(ctx.env, ws, 'entities/');
  const topicNodes = topicFiles
    .map(f => parseNode(f.path, f.content).node)
    .filter((n): n is KnowledgeNode => !!n);
  const entityNodes = entityFiles
    .map(f => parseNode(f.path, f.content).node)
    .filter((n): n is KnowledgeNode => !!n);
  const digestCount =
    (
      await ctx.env.DB.prepare(
        "SELECT COUNT(*) AS n FROM workspace_files WHERE workspace_id = ? AND namespace = 'knowledge' AND path LIKE 'artifacts/%'"
      )
        .bind(ws)
        .first<{ n: number }>()
    )?.n ?? 0;

  if (!budgetOk(ctx)) return;
  const topicsBlock = topicNodes
    .slice(0, OVERVIEW_MAX_PAGES)
    .map(n => `- ${n.title}: ${n.body.slice(0, 200)}`)
    .join('\n');
  const entitiesLine = entityNodes
    .slice(0, OVERVIEW_MAX_PAGES)
    .map(n => n.title)
    .join(', ');
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
  const top = [...topicNodes]
    .sort((a, b) => b.sources.length - a.sources.length)
    .slice(0, OVERVIEW_TOP_TOPICS)
    .map(n => `- [[topic.${topicNodeSlug(n)}]] (${n.sources.length})`);
  const fm = [
    '---',
    'kind: overview',
    'id: index',
    'title: "Workspace knowledge"',
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

  const dirty = await collectDirtyDigests(ctx.env, ws, watermark);

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
    if (await mergeEntity(ctx, ws, pair, winnerDirty, winnerRemoved)) {
      mergedWinners.add(winnerSlug);
      mergedWinners.add(loserSlug); // loser slug excluded from the evolve pass → no resurrection
      result.entityPages++;
    }
  }

  // topic evolve (biggest signal first, capped)
  const topicSlugs = [...new Set([...dirtyTopics.keys(), ...removedByTopic.keys()])]
    .sort((a, b) => (dirtyTopics.get(b)?.length ?? 0) - (dirtyTopics.get(a)?.length ?? 0))
    .slice(0, MAX_TOPIC_CALLS_PER_WS);
  for (const slug of topicSlugs) {
    if (!budgetOk(ctx)) return 'skipped';
    const digests = (dirtyTopics.get(slug) ?? []).slice().sort(byLearnedDesc);
    if (await evolveTopicPage(ctx, ws, slug, digests, removedByTopic.get(slug) ?? [], res))
      result.topicPages++;
  }

  // entity evolve (capped) — skip winners already written by the merge pass
  const entitySlugs = [...new Set([...dirtyEntities.keys(), ...removedByEntity.keys()])]
    .filter(s => !mergedWinners.has(s))
    .sort((a, b) => (dirtyEntities.get(b)?.digests.length ?? 0) - (dirtyEntities.get(a)?.digests.length ?? 0))
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
        removedByEntity.get(slug) ?? []
      )
    )
      result.entityPages++;
  }

  await appendTimeline(ctx, ws, dirty);

  const changed =
    result.topicPages - t0 + (result.entityPages - e0) > 0 || removed.length > 0;
  if (changed) await regenerateOverview(ctx, ws);

  await setLastConsolidatedAt(ctx.env, ws, runStartedAt);
  return 'done';
}

function byLearnedDesc(a: KnowledgeNode, b: KnowledgeNode): number {
  return (b.learnedAt ?? '').localeCompare(a.learnedAt ?? '');
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
      ? (system, user) =>
          chatComplete(
            env,
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
      const state = await consolidateWorkspace(ctx, cand.workspaceId, cand.lastConsolidatedAt, result);
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
