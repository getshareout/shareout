// Keyword search inside a KnowledgeStore (store-do.ts). chunks_fts indexes each chunk's
// words as written; chunks_stem indexes its stemmed shadow (lexical.ts), so
// "presupuestos aprobados" finds "presupuesto aprobado". A word matched as typed adds to
// its stem match, so the exact form ranks first.
import type { SourceKind } from './client';
import { matchPlan, stemmedChunk, type StemVocab } from './lexical';

type Q = (query: string, ...bindings: unknown[]) => SqlStorageCursor<Record<string, SqlStorageValue>>;

/** Contentless: the text lives in `chunks`; contentless_delete lets a chunk go by rowid. */
export const STEM_SCHEMA = [
  `CREATE VIRTUAL TABLE IF NOT EXISTS chunks_stem USING fts5(
    title, text, content='', contentless_delete=1, tokenize='unicode61 remove_diacritics 2'
  )`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS chunks_stem_vocab USING fts5vocab(chunks_stem, 'row')`,
];

/** What a word matched as typed is worth next to the same word matched by its stem. */
const TYPED_WEIGHT = 0.5;

export function writeStem(q: Q, id: number, title: string, text: string): void {
  const s = stemmedChunk(title, text);
  q('INSERT INTO chunks_stem (rowid, title, text) VALUES (?, ?, ?)', id, s.title, s.text);
}

export function dropStem(q: Q, id: number): void {
  q('DELETE FROM chunks_stem WHERE rowid = ?', id);
}

function stemVocab(q: Q): StemVocab {
  return {
    docs(stems) {
      const list = [...new Set(stems)];
      const out = new Map<string, number>();
      if (!list.length) return out;
      const rows = q(`SELECT term, doc FROM chunks_stem_vocab WHERE term IN (${list.map(() => '?').join(', ')})`, ...list).toArray();
      for (const r of rows) out.set(r.term as string, r.doc as number);
      return out;
    },
    hasPrefix: (prefix) =>
      q('SELECT 1 FROM chunks_stem_vocab WHERE term >= ? AND term < ? LIMIT 1', prefix, `${prefix}\u{10FFFF}`).toArray().length > 0,
  };
}

/**
 * Picking candidates for one member (store-do.ts searchCandidates): sources the store last
 * saw as hidden from them are left out (and reported), `exclude` is dropped and `include`
 * kept whatever the store recorded — both are D1's answers from earlier in the same search.
 */
export interface CandidateFilter {
  viewer: string;
  exclude: readonly string[];
  include: readonly string[];
  kinds: readonly SourceKind[] | null;
}

/** Hidden matches one pass reports at most, best first: the ones the caller re-checks. */
const SKIPPED_MAX = 120;
/** A filtered pass first places only the best `limit × PLACED` matches (as cheap as an
 *  unfiltered one); it places every match only when those hold too few candidates. */
const PLACED = 8;

type Row = Record<string, SqlStorageValue>;

/** Chunks for one MATCH pass, best first: stem and typed scores summed per chunk. */
function ranked(q: Q, stem: string | null, typed: string | null, requireStem: boolean, limit: number, filter: CandidateFilter | null): Row[] {
  const parts: string[] = [];
  const args: unknown[] = [];
  if (stem) {
    parts.push('SELECT rowid AS id, bm25(chunks_stem, 2.0, 1.0) AS score, 1 AS stem FROM chunks_stem WHERE chunks_stem MATCH ?');
    args.push(stem);
  }
  if (typed) {
    parts.push(`SELECT rowid AS id, bm25(chunks_fts, 2.0, 1.0) * ${TYPED_WEIGHT} AS score, 0 AS stem FROM chunks_fts WHERE chunks_fts MATCH ?`);
    args.push(typed);
  }
  if (!parts.length) return [];
  // MATERIALIZED: flattened into the GROUP BY, bm25() would leave its MATCH and fail.
  const hits = `WITH hits AS MATERIALIZED (${parts.join(' UNION ALL ')})`;
  const scored = `SELECT id, SUM(score) AS score FROM hits GROUP BY id ${requireStem ? 'HAVING MAX(stem) = 1' : ''}`;
  if (!filter) {
    return q(
      `${hits}
       SELECT c.id, c.ref_id, s.kind, c.title, c.ord, c.locator, c.text, c.page, c.anchor
         FROM (${scored} ORDER BY score, id LIMIT ?) r
         JOIN chunks c ON c.id = r.id JOIN sources s ON s.ref_id = c.ref_id
        ORDER BY r.score, r.id`,
      ...args, limit,
    ).toArray();
  }
  // Matches are placed before the cut: `seen` counts the candidates ranked at or above each
  // one, so the pool is the first `limit` candidates and a hidden match ranked above the
  // last of them comes back as skipped (without its text) for the caller to re-check.
  // Placing only the best `bound` matches gives the same answer whenever they hold `limit`
  // candidates: anything below them ranks below every one of them.
  const kinds = filter.kinds ? ' AND s.kind IN (SELECT value FROM json_each(?))' : '';
  const place = (bound: number | null) => q(
    `${hits},
     top AS (${scored}${bound ? ' ORDER BY score, id LIMIT ?' : ''}),
     cand AS (
       SELECT t.id, t.score, c.ref_id, s.kind, s.access, s.owner_id,
              CASE WHEN c.ref_id IN (SELECT value FROM json_each(?)) THEN 0
                   WHEN s.access = 'none' OR (s.access = 'owner' AND s.owner_id IS NOT ?) THEN 1
                   ELSE 0 END AS hidden
         FROM top t JOIN chunks c ON c.id = t.id JOIN sources s ON s.ref_id = c.ref_id
        WHERE c.ref_id NOT IN (SELECT value FROM json_each(?))${kinds}
     ),
     placed AS (
       SELECT *, SUM(1 - hidden) OVER w AS seen, SUM(hidden) OVER w AS behind FROM cand
       WINDOW w AS (ORDER BY score, id ROWS UNBOUNDED PRECEDING)
     )
     SELECT p.hidden, p.access, p.owner_id, p.kind, c.id, c.ref_id, c.title, c.ord, c.locator,
            CASE WHEN p.hidden = 1 THEN NULL ELSE c.text END AS text, c.page, c.anchor
       FROM placed p JOIN chunks c ON c.id = p.id
      WHERE CASE WHEN p.hidden = 1 THEN p.seen < ? AND p.behind <= ? ELSE p.seen <= ? END
      ORDER BY p.score, p.id`,
    ...args, ...(bound ? [bound] : []),
    JSON.stringify(filter.include), filter.viewer, JSON.stringify(filter.exclude),
    ...(filter.kinds ? [JSON.stringify(filter.kinds)] : []),
    limit, SKIPPED_MAX, limit,
  ).toArray();
  const first = place(limit * PLACED);
  return first.filter((r) => r.hidden !== 1).length >= limit ? first : place(null);
}

export interface KeywordResult {
  /** Best first: the candidates (with a filter, the ones not known to be hidden). */
  rows: Row[];
  /** With a filter: hidden matches ranked above the last candidate, best first, no text. */
  skipped: Row[];
  /** Answered by chunks holding every term. */
  strict: boolean;
}

/**
 * Best `limit` chunks for a free-text query. Chunks holding every term answer it when
 * there are at least `strictMin` (default `limit`) of them; otherwise it falls back to
 * chunks holding any term, where BM25 still ranks the ones holding more of them first.
 * (Putting a lone all-terms chunk on top lost to plain BM25 in the evals: it is usually an
 * overview page that names everything once.) With a filter, only candidates count toward
 * `strictMin` — chunks the member can't see never decide what they get. `stemReady` =
 * every chunk is in chunks_stem, so its vocabulary can pick the terms.
 */
export function keywordSearch(
  q: Q, query: string, limit: number, stemReady: boolean,
  opts: { strictMin?: number; filter?: CandidateFilter } = {},
): KeywordResult {
  const plan = matchPlan(query, stemReady ? stemVocab(q) : null);
  if (!plan) return { rows: [], skipped: [], strict: false };
  const filter = opts.filter ?? null;
  const strictMin = opts.strictMin ?? limit;
  const split = (rows: Row[]) => (filter
    ? { shown: rows.filter((r) => r.hidden !== 1), skipped: rows.filter((r) => r.hidden === 1) }
    : { shown: rows, skipped: [] });
  let skipped: Row[] = [];
  if (plan.strict) {
    const all = split(ranked(q, plan.strict, plan.plain, true, Math.max(limit, strictMin), filter));
    if (all.shown.length >= strictMin) return { rows: all.shown.slice(0, limit), skipped: all.skipped, strict: true };
    // What the all-terms pass skipped decided the fallback too: the caller re-checks it.
    skipped = all.skipped;
  }
  const any = split(ranked(q, plan.loose, plan.plain, false, limit, filter));
  return { rows: any.shown, skipped: [...skipped, ...any.skipped], strict: false };
}
