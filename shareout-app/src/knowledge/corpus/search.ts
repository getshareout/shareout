// Hybrid corpus search: FTS5 keyword hits + Vectorize semantic hits, fused by reciprocal
// rank, then re-checked against D1 for access (Vectorize and the DO are never trusted
// for access). Every hit carries a citation an agent can quote.
import type { Env } from '../../types';
import { getPlatformOrigin } from '../../config/origins';
import { corpusFor, type ChunkHit, type SourceKind } from './client';
import { queueKnowledgeSource } from './ingest';

const EMBED_MODEL = '@cf/baai/bge-base-en-v1.5';
const CANDIDATES = 30;
const RRF_K = 60;
const SNIPPET_CHARS = 700;

export interface SearchHit {
  id: string;
  text: string;
  locator: string;
  score: number;
  source: { kind: SourceKind; id: string; title: string; url: string | null };
  cite: string;
}

export interface SearchResult {
  mode: 'hybrid' | 'keyword';
  hits: SearchHit[];
}

const key = (h: { refId: string; ord: number }) => `${h.refId}:${h.ord}`;

async function semanticKeys(env: Env, workspaceId: string, q: string): Promise<{ refId: string; ord: number }[] | null> {
  if (!env.AI || !env.KNOWLEDGE_VECTORS) return null;
  try {
    const res = (await env.AI.run(EMBED_MODEL, { text: [q.slice(0, 2000)] })) as { data?: number[][] };
    if (!res.data?.[0]) return null;
    const out = await env.KNOWLEDGE_VECTORS.query(res.data[0], { topK: CANDIDATES, namespace: workspaceId });
    return (out.matches || []).map((m) => {
      const i = m.id.lastIndexOf(':');
      return { refId: m.id.slice(0, i), ord: Number(m.id.slice(i + 1)) };
    });
  } catch {
    return null;
  }
}

interface Visible { title: string; url: string | null }

/** Which sources this member may see right now: the source still exists in the workspace
 *  and is not someone else's private page/file. */
async function visibleSources(env: Env, workspaceId: string, userId: string, hits: ChunkHit[]) {
  const visible = new Map<string, Visible>();
  const gone = new Map<string, SourceKind>();
  const ids = (kind: SourceKind) => [...new Set(hits.filter((h) => h.kind === kind).map((h) => h.refId))];
  const origin = getPlatformOrigin(env);

  const pages = ids('page');
  if (pages.length) {
    const rows = (await env.DB.prepare(
      `SELECT a.id, a.name, a.slug, a.owner_id, a.visibility FROM artifacts a
         LEFT JOIN artifact_moderation m ON m.artifact_id = a.id
        WHERE a.workspace_id = ? AND a.deleted_at IS NULL AND COALESCE(m.status, 'approved') = 'approved'
          AND a.id IN (${pages.map(() => '?').join(',')})`,
    ).bind(workspaceId, ...pages).all<{ id: string; name: string; slug: string; owner_id: string; visibility: string }>()).results || [];
    for (const r of rows) {
      if (r.visibility !== 'private' || r.owner_id === userId) visible.set(r.id, { title: r.name, url: `${origin}/a/${r.slug}/` });
    }
    // Pages awaiting moderation stay in the corpus but out of results until approved.
    const live = new Set(((await env.DB.prepare(
      `SELECT id FROM artifacts WHERE workspace_id = ? AND deleted_at IS NULL AND id IN (${pages.map(() => '?').join(',')})`,
    ).bind(workspaceId, ...pages).all<{ id: string }>()).results || []).map((r) => r.id));
    for (const id of pages) if (!live.has(id)) gone.set(id, 'page');
  }

  const assets = ids('asset');
  if (assets.length) {
    const rows = (await env.DB.prepare(
      `SELECT id, name, owner_id, visibility FROM asset_deliverables
        WHERE workspace_id = ? AND deleted_at IS NULL AND id IN (${assets.map(() => '?').join(',')})`,
    ).bind(workspaceId, ...assets).all<{ id: string; name: string; owner_id: string; visibility: string }>()).results || [];
    for (const r of rows) {
      if (r.visibility !== 'private' || r.owner_id === userId) visible.set(r.id, { title: r.name, url: null });
    }
    for (const id of assets) if (!rows.some((r) => r.id === id)) gone.set(id, 'asset');
  }
  return { visible, gone };
}

export async function searchCorpus(
  env: Env,
  workspaceId: string,
  userId: string,
  q: string,
  opts: { limit?: number; ctx?: { waitUntil(p: Promise<unknown>): void } } = {},
): Promise<SearchResult> {
  const store = corpusFor(env, workspaceId);
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 30);
  if (!store || !q.trim()) return { mode: 'keyword', hits: [] };

  const [keyword, semantic] = await Promise.all([store.search(q, CANDIDATES), semanticKeys(env, workspaceId, q)]);
  const byKey = new Map(keyword.map((h) => [key(h), h]));
  const missing = (semantic || []).filter((k) => !byKey.has(key(k)));
  if (missing.length) for (const h of await store.chunksByKey(missing)) byKey.set(key(h), h);

  const score = new Map<string, number>();
  const add = (list: { refId: string; ord: number }[]) =>
    list.forEach((h, rank) => score.set(key(h), (score.get(key(h)) ?? 0) + 1 / (RRF_K + rank + 1)));
  add(keyword);
  add(semantic || []);

  const ranked = [...byKey.values()].sort((a, b) => (score.get(key(b)) ?? 0) - (score.get(key(a)) ?? 0));
  const { visible, gone } = await visibleSources(env, workspaceId, userId, ranked);
  // A deleted Asset/page still in the corpus: re-run ingest, which removes it.
  for (const [refId, kind] of gone) {
    queueKnowledgeSource(env, opts.ctx, { workspaceId, kind, refId }, `gone:${Date.now()}`).catch(() => {});
  }

  const hits = ranked
    .filter((h) => visible.has(h.refId))
    .slice(0, limit)
    .map((h): SearchHit => {
      const src = visible.get(h.refId)!;
      return {
        id: key(h),
        text: h.text.length > SNIPPET_CHARS ? `${h.text.slice(0, SNIPPET_CHARS)}…` : h.text,
        locator: h.locator,
        score: Number((score.get(key(h)) ?? 0).toFixed(4)),
        source: { kind: h.kind, id: h.refId, title: src.title, url: src.url },
        cite: h.locator ? `${src.title} — ${h.locator}` : src.title,
      };
    });
  return { mode: semantic ? 'hybrid' : 'keyword', hits };
}

/** Compact markdown for LLM context (`?format=md`). */
export function searchResultMarkdown(q: string, r: SearchResult): string {
  if (!r.hits.length) return `No knowledge found for "${q}".`;
  return r.hits
    .map((h, i) => `[${i + 1}] ${h.cite} (${h.source.kind} ${h.source.id}${h.source.url ? `, ${h.source.url}` : ''})\n${h.text}`)
    .join('\n\n');
}
