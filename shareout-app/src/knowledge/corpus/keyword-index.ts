// Keyword search inside a KnowledgeStore (store-do.ts). chunks_fts indexes each chunk's
// words as written; chunks_stem indexes its stemmed shadow (lexical.ts), so
// "presupuestos aprobados" finds "presupuesto aprobado". A word matched as typed adds to
// its stem match, so the exact form ranks first.
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

/** Chunks for one MATCH pass, best first: stem and typed scores summed per chunk. */
function ranked(q: Q, stem: string | null, typed: string | null, requireStem: boolean, limit: number) {
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
  return q(
    `WITH hits AS MATERIALIZED (${parts.join(' UNION ALL ')})
     SELECT c.id, c.ref_id, s.kind, c.title, c.ord, c.locator, c.text, c.page, c.anchor
       FROM (SELECT id, SUM(score) AS score FROM hits GROUP BY id
             ${requireStem ? 'HAVING MAX(stem) = 1' : ''} ORDER BY score, id LIMIT ?) r
       JOIN chunks c ON c.id = r.id JOIN sources s ON s.ref_id = c.ref_id
      ORDER BY r.score, r.id`,
    ...args, limit,
  ).toArray();
}

/**
 * Best `limit` chunks for a free-text query. Chunks holding every term answer it when
 * there are at least `limit` of them; otherwise it falls back to chunks holding any term,
 * where BM25 still ranks the ones holding more of them first. (Putting a lone all-terms
 * chunk on top lost to plain BM25 in the evals: it is usually an overview page that names
 * everything once.) `stemReady` = every chunk is in chunks_stem, so its vocabulary can
 * pick the terms.
 */
export function keywordSearch(q: Q, query: string, limit: number, stemReady: boolean): Record<string, SqlStorageValue>[] {
  const plan = matchPlan(query, stemReady ? stemVocab(q) : null);
  if (!plan) return [];
  if (plan.strict) {
    const all = ranked(q, plan.strict, plan.plain, true, limit);
    if (all.length >= limit) return all;
  }
  return ranked(q, plan.loose, plan.plain, false, limit);
}
