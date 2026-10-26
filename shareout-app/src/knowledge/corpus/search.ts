// Hybrid corpus search: FTS5 keyword hits + Vectorize semantic hits, fused by reciprocal
// rank, then re-checked against D1 for access (Vectorize and the DO are never trusted
// for access). Every hit carries a citation an agent can quote.
//
// Keyword candidates are picked for the member asking, before the cut: the store leaves
// out sources it last saw as hidden from them (another member's private File or page), so
// those can't fill the pool and starve the member. That record is only a hint. D1 checks
// every source the pick depended on — the candidates, and the hidden sources skipped above
// the last of them — and when it disagrees (a visibility change, a source never checked)
// the store picks again with D1's answers, at most MAX_ROUNDS times. D1's answers are then
// recorded in the store, so the next search starts from them.
import type { Env } from '../../types';
import { artifactLink } from '../../artifacts/page-links';
import { corpusFor, sourceAccess, type CachedAccess, type CandidateQuery, type Candidates, type ChunkHit, type SourceAccess, type SourceKind } from './client';
import { queueKnowledgeSource } from './ingest';
import { meterKnowledge } from './usage';
import { JSON_IN, jsonList } from '../../sql-in';
import { denseCorpusKeys, queryCostMicroUsd, type DenseKeys } from '../vectors/v2';

const CANDIDATES = 30;
/** Keyword picks per search at most: each is one store call plus one D1 round trip. */
const MAX_ROUNDS = 4;
/** A pick that met hidden candidates asks for twice as many next time, up to this. */
const MAX_POOL = 120;
const RRF_K = 60;
const SNIPPET_CHARS = 700;

export interface SearchHit {
  id: string;
  text: string;
  locator: string;
  score: number;
  source: { kind: SourceKind; id: string; title: string; url: string | null };
  cite: string;
  /** Sub-page of a multi-page artifact the passage is on (null = its home page / a file). */
  page: string | null;
  /** Heading id the passage sits under, when the page has one. */
  anchor: string | null;
  /** Deep link to the passage: the page (and sub-page), scrolled to its section when possible. */
  url: string | null;
}

export interface SearchResult {
  mode: 'hybrid' | 'keyword';
  hits: SearchHit[];
}

const key = (h: { refId: string; ord: number }) => `${h.refId}:${h.ord}`;

// Dense candidates: the v1 index, or the multilingual v2 index once reads are cut over and it
// covers this workspace's passages (vectors/v2.ts). Over-fetched when the store knows of
// sources hidden from this member; searchCorpus keeps the first CANDIDATES that D1 lets them
// see. The model rides along for metering.
function semanticKeys(env: Env, store: NonNullable<ReturnType<typeof corpusFor>>, workspaceId: string, userId: string, q: string): Promise<DenseKeys | null> {
  return denseCorpusKeys(env, store, workspaceId, q.slice(0, 2000), { viewer: userId, candidates: CANDIDATES }).catch(() => null);
}

export interface Visible { title: string; url: string | null; slug?: string }

/** D1's word on one source. */
interface SourceFact {
  kind: SourceKind;
  access: SourceAccess;
  ownerId: string | null;
  /** No longer in the workspace (deleted, or moved away). */
  gone: boolean;
  title: string;
  url: string | null;
  slug?: string;
}

const canSee = (f: SourceFact | undefined, userId: string) => !!f && (f.access === 'all' || (f.access === 'owner' && f.ownerId === userId));

/**
 * Who may see each source right now, per D1, in one round trip: it still exists in the
 * workspace, is not awaiting moderation (pages), and is not someone else's private
 * page/File. A source D1 doesn't have comes back gone.
 */
async function lookupSources(env: Env, workspaceId: string, refs: Map<string, SourceKind>): Promise<Map<string, SourceFact>> {
  const out = new Map<string, SourceFact>();
  const ids = (kind: SourceKind) => [...refs].filter(([, k]) => k === kind).map(([id]) => id);
  const pages = ids('page');
  const assets = ids('asset');
  const stmts: D1PreparedStatement[] = [];
  if (pages.length) {
    stmts.push(env.DB.prepare(
      `SELECT a.id, a.name, a.slug, a.owner_id, a.visibility, COALESCE(m.status, 'approved') AS moderation FROM artifacts a
         LEFT JOIN artifact_moderation m ON m.artifact_id = a.id
        WHERE a.workspace_id = ? AND a.deleted_at IS NULL AND a.id IN ${JSON_IN}`,
    ).bind(workspaceId, jsonList(pages)));
  }
  if (assets.length) {
    stmts.push(env.DB.prepare(
      `SELECT id, name, owner_id, visibility FROM asset_deliverables
        WHERE workspace_id = ? AND deleted_at IS NULL AND id IN ${JSON_IN}`,
    ).bind(workspaceId, jsonList(assets)));
  }
  if (!stmts.length) return out;
  const results = await env.DB.batch(stmts);
  type PageRow = { id: string; name: string; slug: string; owner_id: string; visibility: string; moderation: string };
  type AssetRow = { id: string; name: string; owner_id: string; visibility: string };
  const pageRows = (pages.length ? results[0].results || [] : []) as PageRow[];
  const assetRows = (assets.length ? results[stmts.length - 1].results || [] : []) as AssetRow[];
  for (const r of pageRows) {
    out.set(r.id, {
      kind: 'page',
      // Pages awaiting moderation stay in the corpus but out of results until approved.
      access: sourceAccess(r.visibility, r.moderation),
      ownerId: r.owner_id, gone: false, title: r.name, url: artifactLink(env, r.slug), slug: r.slug,
    });
  }
  for (const r of assetRows) {
    out.set(r.id, { kind: 'asset', access: sourceAccess(r.visibility), ownerId: r.owner_id, gone: false, title: r.name, url: null });
  }
  for (const [id, kind] of refs) if (!out.has(id)) out.set(id, { kind, access: 'none', ownerId: null, gone: true, title: '', url: null });
  return out;
}

/** Which sources this member may see right now: the source still exists in the workspace
 *  and is not someone else's private page/file. */
export async function visibleSources(env: Env, workspaceId: string, userId: string, hits: { refId: string; kind: SourceKind }[]) {
  const facts = await lookupSources(env, workspaceId, new Map(hits.map((h) => [h.refId, h.kind])));
  const visible = new Map<string, Visible>();
  const gone = new Map<string, SourceKind>();
  for (const [refId, f] of facts) {
    if (f.gone) gone.set(refId, f.kind);
    else if (canSee(f, userId)) visible.set(refId, f.kind === 'page' ? { title: f.title, url: f.url, slug: f.slug } : { title: f.title, url: null });
  }
  return { visible, gone };
}

/** D1's answers within one search: each source is looked up once, however many picks ask. */
class AccessCheck {
  readonly facts = new Map<string, SourceFact>();

  constructor(private readonly env: Env, private readonly workspaceId: string, readonly userId: string) {}

  async lookup(refs: { refId: string; kind: SourceKind }[]): Promise<void> {
    const todo = new Map<string, SourceKind>();
    for (const r of refs) if (!this.facts.has(r.refId)) todo.set(r.refId, r.kind);
    if (!todo.size) return;
    for (const [id, f] of await lookupSources(this.env, this.workspaceId, todo)) this.facts.set(id, f);
  }

  canSee(refId: string): boolean {
    return canSee(this.facts.get(refId), this.userId);
  }
}

type Store = NonNullable<ReturnType<typeof corpusFor>>;
type AccessRecord = { refId: string; access: SourceAccess; ownerId: string | null };

const differs = (cached: CachedAccess, f: SourceFact) => cached.access !== f.access || (f.access === 'owner' && cached.ownerId !== f.ownerId);

/** One pick from the store. A store still on the previous deploy during a gradual rollout
 *  has no searchCandidates: it answers with its plain top chunks, as search did before. */
async function pick(store: Store, q: string, query: CandidateQuery): Promise<Candidates> {
  try {
    return await store.searchCandidates(q, query);
  } catch (err) {
    if (!/does not implement the method/.test(String((err as Error)?.message ?? err))) throw err;
    const hits = await store.search(q, query.limit);
    return { hits: hits.map((h) => ({ ...h, access: null, ownerId: null })), skipped: [], full: false, strict: false };
  }
}

/**
 * The keyword pool as this member may see it: up to CANDIDATES chunks, best first, each
 * from a source D1 just confirmed. Where the store's record of a source disagreed with D1,
 * the correction lands in `stale`.
 */
async function keywordPool(store: Store, check: AccessCheck, q: string, kinds: SourceKind[] | undefined, stale: Map<string, AccessRecord>): Promise<ChunkHit[]> {
  const exclude = new Set<string>();
  const include = new Set<string>();
  let limit = CANDIDATES;
  for (let round = 1; ; round++) {
    const r = await pick(store, q, { viewer: check.userId, limit, strictMin: CANDIDATES, exclude: [...exclude], include: [...include], kinds });
    const seen = [...r.hits, ...r.skipped];
    await check.lookup(seen);
    for (const s of seen) {
      const f = check.facts.get(s.refId)!;
      if (differs(s, f)) stale.set(s.refId, { refId: s.refId, access: f.access, ownerId: f.ownerId });
    }
    const shown = r.hits.filter((h) => check.canSee(h.refId));
    const hidden = shown.length < r.hits.length;
    const missed = r.skipped.some((s) => check.canSee(s.refId));
    // Settled when D1 agrees with every candidate and every skip — or when the pick fell
    // back to any term and came back short, so dropping hidden candidates frees no room.
    if ((!missed && (!hidden || (!r.full && !r.strict))) || round === MAX_ROUNDS) return shown.slice(0, CANDIDATES);
    for (const refId of check.facts.keys()) (check.canSee(refId) ? include : exclude).add(refId);
    if (hidden) limit = Math.min(limit * 2, MAX_POOL);
  }
}

export async function searchCorpus(
  env: Env,
  workspaceId: string,
  userId: string,
  q: string,
  opts: { limit?: number; full?: boolean; kinds?: SourceKind[]; ctx?: { waitUntil(p: Promise<unknown>): void } } = {},
): Promise<SearchResult> {
  const store = corpusFor(env, workspaceId);
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 30);
  if (!store || !q.trim()) return { mode: 'keyword', hits: [] };

  const check = new AccessCheck(env, workspaceId, userId);
  const stale = new Map<string, AccessRecord>();
  const [keyword, dense] = await Promise.all([keywordPool(store, check, q, opts.kinds, stale), semanticKeys(env, store, workspaceId, userId, q)]);
  const semantic = dense?.keys ?? null;
  const metered = meterKnowledge(env, workspaceId, 'knowledge_search', {
    model: dense ? dense.model.id : 'fts5',
    units: 1,
    unitKind: 'queries',
    costMicroUsd: dense ? queryCostMicroUsd(dense.model, q) : 0,
    userId,
  });
  if (opts.ctx) opts.ctx.waitUntil(metered);
  else await metered;
  const byKey = new Map<string, ChunkHit>(keyword.map((h) => [key(h), h]));
  const missing = (semantic || []).filter((k) => !byKey.has(key(k)));
  if (missing.length) for (const h of await store.chunksByKey(missing)) byKey.set(key(h), h);
  // Semantic candidates get the same D1 check; both lists are ranked as this member sees them.
  const semanticHits = (semantic || []).flatMap((k) => byKey.get(key(k)) ?? []).filter((h) => !opts.kinds?.length || opts.kinds.includes(h.kind));
  await check.lookup(semanticHits);
  // Dense-only sources teach the store too, so its next over-fetch decision starts from D1.
  for (const h of semanticHits as (ChunkHit & Partial<CachedAccess>)[]) {
    const f = check.facts.get(h.refId);
    // A store still on the previous deploy returns chunks without access (undefined): skip.
    if (f && !f.gone && h.access !== undefined && differs({ access: h.access, ownerId: h.ownerId ?? null }, f)) {
      stale.set(h.refId, { refId: h.refId, access: f.access, ownerId: f.ownerId });
    }
  }

  const score = new Map<string, number>();
  const add = (list: { refId: string; ord: number }[]) =>
    list.forEach((h, rank) => score.set(key(h), (score.get(key(h)) ?? 0) + 1 / (RRF_K + rank + 1)));
  add(keyword);
  add(semanticHits.filter((h) => check.canSee(h.refId)).slice(0, CANDIDATES));

  const ranked = [...byKey.values()].filter((h) => score.has(key(h))).sort((a, b) => score.get(key(b))! - score.get(key(a))!);
  // A deleted Asset/page still in the corpus: re-run ingest, which removes it.
  for (const [refId, f] of check.facts) {
    if (f.gone) queueKnowledgeSource(env, opts.ctx, { workspaceId, kind: f.kind, refId }, `gone:${Date.now()}`).catch(() => {});
  }
  if (stale.size) {
    const recorded = store.recordAccess([...stale.values()]).catch(() => {});
    if (opts.ctx) opts.ctx.waitUntil(recorded);
    else await recorded;
  }

  const hits = ranked
    .slice(0, limit)
    .map((h): SearchHit => {
      const src = check.facts.get(h.refId)!;
      return {
        id: key(h),
        text: !opts.full && h.text.length > SNIPPET_CHARS ? `${h.text.slice(0, SNIPPET_CHARS)}…` : h.text,
        locator: h.locator,
        score: Number((score.get(key(h)) ?? 0).toFixed(4)),
        source: { kind: h.kind, id: h.refId, title: src.title, url: src.url },
        cite: h.locator ? `${src.title} — ${h.locator}` : src.title,
        page: h.page ?? null,
        anchor: h.anchor ?? null,
        url: src.slug ? artifactLink(env, src.slug, { page: h.page, section: h.anchor }) : src.url,
      };
    });
  return { mode: semantic ? 'hybrid' : 'keyword', hits };
}

/** Compact markdown for LLM context (`?format=md`). */
export function searchResultMarkdown(q: string, r: SearchResult): string {
  if (!r.hits.length) return `No knowledge found for "${q}".`;
  return r.hits
    .map((h, i) => `[${i + 1}] ${h.cite} (${h.source.kind} ${h.source.id}${h.url ? `, ${h.url}` : ''})\n${h.text}`)
    .join('\n\n');
}
