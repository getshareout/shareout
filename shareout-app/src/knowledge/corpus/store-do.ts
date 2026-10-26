// Per-workspace knowledge corpus: every learned Asset/page version as cited chunks, with
// FTS5 keyword search. One Durable Object per workspace (idFromName(workspaceId)) keeps
// tenants apart by construction and gives each its own SQLite instead of sharing D1.
import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../../types';
import type { Chunk } from './chunk';
import type {
  CachedAccess, Candidates, CandidateQuery, ChunkHit, SkippedSource, SourceAccess, SourceKind, SourceMeta, SourceRow, SourceStats, SourceStatus,
} from './client';
import type { Extraction } from './extract';
import * as graphSql from './graph-store';
import { dropStem, keywordSearch, STEM_SCHEMA, writeStem } from './keyword-index';
import { STEM_VERSION } from './lexical';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS sources (
    ref_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    version TEXT NOT NULL,
    title TEXT NOT NULL,
    owner_id TEXT,
    status TEXT NOT NULL,
    error TEXT,
    chunk_count INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`,
  `CREATE TABLE IF NOT EXISTS chunks (
    id INTEGER PRIMARY KEY,
    ref_id TEXT NOT NULL,
    ord INTEGER NOT NULL,
    locator TEXT NOT NULL,
    title TEXT NOT NULL,
    text TEXT NOT NULL,
    UNIQUE(ref_id, ord)
  )`,
  // Metering: this store's own SQLite work per UTC day (knowledge/corpus/usage.ts).
  `CREATE TABLE IF NOT EXISTS usage_daily (
    day TEXT PRIMARY KEY,
    rows_read INTEGER NOT NULL DEFAULT 0,
    rows_written INTEGER NOT NULL DEFAULT 0,
    calls INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
    title, text, content='chunks', content_rowid='id', tokenize='unicode61 remove_diacritics 2'
  )`,
];

/** Chunks stemmed per alarm while a store builds its stemmed index (~0.1 ms each). */
const STEM_BATCH = 500;

export class KnowledgeStore extends DurableObject<Env> {
  private sql: SqlStorage;
  /** Stemmed-index backfill: chunks with a higher id are not in chunks_stem yet (null = all are). */
  private stemCursor: number | null = null;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.sql = state.storage.sql;
    state.blockConcurrencyWhile(async () => {
      for (const stmt of [...SCHEMA, ...graphSql.GRAPH_SCHEMA]) this.sql.exec(stmt);
      // Passage locations (sub-page + heading id) arrived after the first stores were created.
      const cols = new Set(this.sql.exec('PRAGMA table_info(chunks)').toArray().map((r) => r.name as string));
      if (!cols.has('page')) this.sql.exec('ALTER TABLE chunks ADD COLUMN page TEXT');
      if (!cols.has('anchor')) this.sql.exec('ALTER TABLE chunks ADD COLUMN anchor TEXT');
      // Model of the chunk's vector in the v2 index (NULL = none yet): the backfill resumes
      // from it, and reads stay on v1 until the workspace is covered (vectors/v2.ts v2Covers).
      if (!cols.has('embed_model')) this.sql.exec('ALTER TABLE chunks ADD COLUMN embed_model TEXT');
      // Which chunker produced a source's chunks (0 = before versioning), and how many
      // ingests in a row failed — the nightly refresh re-learns stale and failed sources.
      const srcCols = new Set(this.sql.exec('PRAGMA table_info(sources)').toArray().map((r) => r.name as string));
      if (!srcCols.has('chunker_version')) this.sql.exec('ALTER TABLE sources ADD COLUMN chunker_version INTEGER NOT NULL DEFAULT 0');
      if (!srcCols.has('fail_count')) this.sql.exec('ALTER TABLE sources ADD COLUMN fail_count INTEGER NOT NULL DEFAULT 0');
      // Who may see each source, as D1 last said (SourceAccess; NULL = not checked yet).
      // Search uses it to pick candidates per member; D1 still decides every result.
      if (!srcCols.has('access')) this.sql.exec('ALTER TABLE sources ADD COLUMN access TEXT');
      this.stemCursor = this.prepareStemIndex();
      if (this.stemCursor !== null && (await state.storage.getAlarm()) === null) await state.storage.setAlarm(Date.now());
    });
  }

  /**
   * The stemmed index arrived after the first stores were created, and changes with
   * STEM_VERSION. A store without the current one gets it empty and re-stems its stored
   * chunks in batches (alarm) — from `chunks`, so nothing is re-fetched or re-embedded.
   * Until then search still runs on chunks_fts plus whatever is stemmed.
   */
  private prepareStemIndex(): number | null {
    const meta = (key: string) => this.sql.exec('SELECT value FROM meta WHERE key = ?', key).toArray()[0]?.value as string | undefined;
    if (meta('stem_version') !== String(STEM_VERSION)) {
      this.ctx.storage.transactionSync(() => {
        this.sql.exec('DROP TABLE IF EXISTS chunks_stem_vocab');
        this.sql.exec('DROP TABLE IF EXISTS chunks_stem');
        for (const stmt of STEM_SCHEMA) this.sql.exec(stmt);
        this.setMeta('stem_version', String(STEM_VERSION));
        if (this.sql.exec('SELECT 1 FROM chunks LIMIT 1').toArray().length) this.setMeta('stem_cursor', '0');
        else this.sql.exec("DELETE FROM meta WHERE key = 'stem_cursor'");
      });
    }
    const cursor = meta('stem_cursor');
    return cursor === undefined ? null : Number(cursor);
  }

  private setMeta(key: string, value: string) {
    this.sql.exec('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
  }

  /** Stem the next `max` chunks the backfill hasn't reached. True while more remain. */
  private stemNext(max: number): boolean {
    const from = this.stemCursor;
    if (from === null) return false;
    const next = this.ctx.storage.transactionSync(() => {
      const rows = this.q('SELECT id, title, text FROM chunks WHERE id > ? ORDER BY id LIMIT ?', from, max).toArray();
      for (const r of rows) writeStem(this.q.bind(this), r.id as number, r.title as string, r.text as string);
      const last = rows.length < max ? null : (rows[rows.length - 1].id as number);
      if (last === null) this.q("DELETE FROM meta WHERE key = 'stem_cursor'");
      else this.setMeta('stem_cursor', String(last));
      return last;
    });
    this.stemCursor = next;
    return next !== null;
  }

  /** Whether chunk `id` belongs in chunks_stem now (the backfill adds the rest later). */
  private stemmed(id: number): boolean {
    return this.stemCursor === null || id <= this.stemCursor;
  }

  async alarm(): Promise<void> {
    if (this.stemCursor === null) return;
    if (this.metered(() => this.stemNext(STEM_BATCH))) await this.ctx.storage.setAlarm(Date.now());
  }

  // Every statement goes through q() so its rows read/written can be metered.
  private pending: SqlStorageCursor<Record<string, SqlStorageValue>>[] = [];

  private q(query: string, ...bindings: unknown[]) {
    const cursor = this.sql.exec(query, ...bindings);
    this.pending.push(cursor);
    return cursor;
  }

  /** Run one public call and add the SQLite rows it touched to today's usage. */
  private metered<T>(fn: () => T): T {
    try {
      return fn();
    } finally {
      let read = 0, written = 0;
      for (const c of this.pending) { read += c.rowsRead; written += c.rowsWritten; }
      this.pending = [];
      this.sql.exec(
        `INSERT INTO usage_daily (day, rows_read, rows_written, calls) VALUES (date('now'), ?, ?, 1)
         ON CONFLICT(day) DO UPDATE SET rows_read = rows_read + excluded.rows_read,
           rows_written = rows_written + excluded.rows_written, calls = calls + 1`,
        read, written + 1,
      );
    }
  }

  getSource(refId: string): SourceRow | null {
    return this.metered(() => {
      const r = this.q('SELECT * FROM sources WHERE ref_id = ?', refId).toArray()[0];
      return r ? toSource(r) : null;
    });
  }

  /** Mark a source in flight (or finished without chunks). Keeps its previous chunks. */
  /** `chunkerVersion` records that this chunker has seen the source (chunked or unsupported). */
  setStatus(meta: SourceMeta, status: SourceStatus, error: string | null = null, chunkerVersion?: number): void {
    return this.metered(() => this.writeStatus(meta, status, error, chunkerVersion));
  }

  private writeStatus(meta: SourceMeta, status: SourceStatus, error: string | null, chunkerVersion?: number): void {
    this.q(
      `INSERT INTO sources (ref_id, kind, version, title, owner_id, status, error, chunker_version, fail_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, 0), CASE WHEN ? = 'failed' THEN 1 ELSE 0 END)
       ON CONFLICT(ref_id) DO UPDATE SET kind = excluded.kind, version = excluded.version,
         title = excluded.title, owner_id = excluded.owner_id, status = excluded.status,
         error = excluded.error, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
         chunker_version = COALESCE(?, chunker_version),
         fail_count = CASE excluded.status WHEN 'failed' THEN fail_count + 1 WHEN 'processing' THEN fail_count ELSE 0 END`,
      meta.refId, meta.kind, meta.version, meta.title, meta.ownerId, status, error, chunkerVersion ?? null, status, chunkerVersion ?? null,
    );
  }

  /** Mark sources queued for a reindex (status `processing`), keeping their chunks. */
  markQueued(metas: SourceMeta[]): void {
    return this.metered(() => {
      for (const m of metas) this.writeStatus(m, 'processing', null);
    });
  }

  /** At most one reindex per `windowMs`: claims the slot, or says when the next one opens. */
  claimReindex(windowMs: number, now = Date.now()): { ok: true } | { ok: false; retryAfterSec: number } {
    return this.metered(() => {
      const last = Number(this.q("SELECT value FROM meta WHERE key = 'last_reindex'").toArray()[0]?.value ?? 0);
      if (last && now - last < windowMs) return { ok: false as const, retryAfterSec: Math.ceil((windowMs - (now - last)) / 1000) };
      this.q("INSERT INTO meta (key, value) VALUES ('last_reindex', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", String(now));
      return { ok: true as const };
    });
  }

  lastReindexAt(): string | null {
    return this.metered(() => {
      const v = this.q("SELECT value FROM meta WHERE key = 'last_reindex'").toArray()[0]?.value;
      return v ? new Date(Number(v)).toISOString() : null;
    });
  }

  /** Per-source detail for status: chunk count plus how many chunks carry a sub-page / heading anchor. */
  sourceStats(limit: number): SourceStats[] {
    return this.metered(() => this.q(
      `SELECT s.*,
              (SELECT COUNT(*) FROM chunks c WHERE c.ref_id = s.ref_id AND c.page IS NOT NULL) AS with_page,
              (SELECT COUNT(*) FROM chunks c WHERE c.ref_id = s.ref_id AND c.anchor IS NOT NULL) AS with_anchor
         FROM sources s ORDER BY s.updated_at DESC LIMIT ?`, limit,
    ).toArray().map((r) => ({
      ...toSource(r),
      chunkerVersion: r.chunker_version as number,
      failCount: r.fail_count as number,
      withPage: r.with_page as number,
      withAnchor: r.with_anchor as number,
    })));
  }

  /**
   * Sources the nightly refresh should re-learn: chunked by an older chunker, or failed
   * and past their backoff (1, 2, 4, 8 days; gives up after `maxFails`). Oldest first.
   * Sources already in flight (processing in the last day) are left alone.
   */
  staleSources(chunkerVersion: number, limit: number, maxFails: number): { refId: string; kind: SourceKind; reason: 'chunker' | 'failed' }[] {
    return this.metered(() => this.q(
      `SELECT ref_id, kind, CASE WHEN status = 'failed' THEN 'failed' ELSE 'chunker' END AS reason FROM sources
        WHERE (status = 'failed' AND fail_count < ?
               AND updated_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now', '-' || ((1 << MAX(fail_count - 1, 0)) * 24 - 1) || ' hours'))
           OR (status IN ('ready', 'unsupported') AND chunker_version < ?)
           OR (status = 'processing' AND chunker_version < ? AND updated_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now', '-1 day'))
        ORDER BY chunker_version ASC, updated_at ASC LIMIT ?`,
      maxFails, chunkerVersion, chunkerVersion, limit,
    ).toArray().map((r) => ({ refId: r.ref_id as string, kind: r.kind as SourceKind, reason: r.reason as 'chunker' | 'failed' })));
  }

  /** Swap a source's chunks for a new version in one transaction. Returns the old count
   *  so the caller can drop vectors past the new end. */
  replaceChunks(meta: SourceMeta, chunks: Chunk[], chunkerVersion?: number): { previousCount: number } {
    return this.metered(() => {
      return this.ctx.storage.transactionSync(() => {
        const previousCount = this.deleteChunks(meta.refId);
        graphSql.clearSourceGraph(this.q.bind(this), meta.refId);
        for (const c of chunks) {
          const id = this.q(
            'INSERT INTO chunks (ref_id, ord, locator, title, text, page, anchor) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id',
            meta.refId, c.ord, c.locator, meta.title, c.text, c.page ?? null, c.anchor ?? null,
          ).one().id as number;
          this.q('INSERT INTO chunks_fts (rowid, title, text) VALUES (?, ?, ?)', id, meta.title, c.text);
          if (this.stemmed(id)) writeStem(this.q.bind(this), id, meta.title, c.text);
        }
        this.writeStatus(meta, 'processing', null, chunkerVersion);
        this.q('UPDATE sources SET chunk_count = ? WHERE ref_id = ?', chunks.length, meta.refId);
        return { previousCount };
      });
    });
  }

  removeSource(refId: string): { previousCount: number } {
    return this.metered(() => {
      return this.ctx.storage.transactionSync(() => {
        const previousCount = this.deleteChunks(refId);
        graphSql.clearSourceGraph(this.q.bind(this), refId);
        this.q('DELETE FROM sources WHERE ref_id = ?', refId);
        return { previousCount };
      });
    });
  }

  chunkTexts(refId: string, offset: number, limit: number): { ord: number; text: string }[] {
    return this.metered(() => {
      return this.q('SELECT ord, title, locator, text FROM chunks WHERE ref_id = ? AND ord >= ? ORDER BY ord LIMIT ?', refId, offset, limit)
        .toArray()
        .map((r) => ({ ord: r.ord as number, text: `${r.title}\n${r.locator}\n${r.text}`.trim() }));
    });
  }

  // ----- v2 vector index bookkeeping (vectors/v2.ts, vectors/backfill.ts) -----

  /** Record that these chunks' vectors in the v2 index were written with `model`. */
  markEmbedded(model: string, keys: { refId: string; ord: number }[]): void {
    return this.metered(() => this.ctx.storage.transactionSync(() => {
      for (const k of keys) this.q('UPDATE chunks SET embed_model = ? WHERE ref_id = ? AND ord = ?', model, k.refId, k.ord);
    }));
  }

  /** Chunks after row `afterId` whose v2 vector is missing or from another model, oldest first. */
  chunksToEmbed(model: string, afterId: number, limit: number): { id: number; refId: string; kind: SourceKind; ord: number; text: string }[] {
    return this.metered(() => this.q(
      `SELECT c.id, c.ref_id, s.kind, c.ord, c.title, c.locator, c.text FROM chunks c JOIN sources s ON s.ref_id = c.ref_id
        WHERE c.id > ? AND (c.embed_model IS NULL OR c.embed_model != ?) ORDER BY c.id LIMIT ?`,
      afterId, model, limit,
    ).toArray().map((r) => ({
      id: r.id as number,
      refId: r.ref_id as string,
      kind: r.kind as SourceKind,
      ord: r.ord as number,
      text: `${r.title}\n${r.locator}\n${r.text}`.trim(),
    })));
  }

  /** Chunk count per v2 model ('' = no v2 vector) and the finished backfill passes (kind → model). */
  vectorState(): { chunks: Record<string, number>; passes: Record<string, string> } {
    return this.metered(() => {
      const chunks: Record<string, number> = {};
      for (const r of this.q("SELECT COALESCE(embed_model, '') AS m, COUNT(*) AS n FROM chunks GROUP BY 1").toArray()) {
        chunks[r.m as string] = r.n as number;
      }
      const passes: Record<string, string> = {};
      for (const r of this.q("SELECT key, value FROM meta WHERE key LIKE 'vectors:%'").toArray()) {
        passes[(r.key as string).slice('vectors:'.length)] = r.value as string;
      }
      return { chunks, passes };
    });
  }

  /** A backfill pass over `kind` finished with `model`. */
  setVectorPass(kind: string, model: string): void {
    return this.metered(() => this.setMeta(`vectors:${kind}`, model));
  }

  /** Forget every v2 vector record (the index was recreated): the next backfill re-embeds all. */
  resetVectors(): void {
    return this.metered(() => this.ctx.storage.transactionSync(() => {
      this.q('UPDATE chunks SET embed_model = NULL WHERE embed_model IS NOT NULL');
      this.q("DELETE FROM meta WHERE key LIKE 'vectors:%'");
    }));
  }

  /** Best `limit` chunks for a query, whoever may see them. */
  search(q: string, limit: number): ChunkHit[] {
    return this.metered(() => keywordSearch(this.q.bind(this), q, limit, this.stemCursor === null).rows.map(toHit));
  }

  /**
   * Keyword candidates for one member (search.ts): the best chunks from sources this store
   * doesn't know to be hidden from them, plus the hidden sources skipped on the way. The
   * recorded access is a hint — the caller re-checks every source in D1, the ones returned
   * and the ones skipped, and asks again with D1's answers when they disagree.
   */
  searchCandidates(q: string, opts: CandidateQuery): Candidates {
    return this.metered(() => {
      const r = keywordSearch(this.q.bind(this), q, opts.limit, this.stemCursor === null, {
        strictMin: opts.strictMin,
        filter: { viewer: opts.viewer, exclude: opts.exclude ?? [], include: opts.include ?? [], kinds: opts.kinds?.length ? opts.kinds : null },
      });
      const skipped = new Map<string, SkippedSource>();
      for (const s of r.skipped) {
        if (!skipped.has(s.ref_id as string)) skipped.set(s.ref_id as string, { refId: s.ref_id as string, kind: s.kind as SourceKind, ...cachedAccess(s) });
      }
      return {
        hits: r.rows.map((row) => ({ ...toHit(row), ...cachedAccess(row) })),
        skipped: [...skipped.values()],
        full: r.rows.length >= opts.limit,
        strict: r.strict,
      };
    });
  }

  /** Remember who may see these sources, as D1 just said (search.ts, when it disagreed). */
  recordAccess(facts: { refId: string; access: SourceAccess; ownerId: string | null }[]): void {
    return this.metered(() => {
      for (const f of facts) {
        if (!ACCESS.has(f.access)) continue;
        this.q('UPDATE sources SET access = ?, owner_id = COALESCE(?, owner_id) WHERE ref_id = ?', f.access, f.ownerId, f.refId);
      }
    });
  }

  chunksByKey(keys: { refId: string; ord: number }[]): ChunkHit[] {
    return this.metered(() => {
      const out: ChunkHit[] = [];
      for (const k of keys) {
        const r = this.q(
            `SELECT c.ref_id, s.kind, c.title, c.ord, c.locator, c.text, c.page, c.anchor
               FROM chunks c JOIN sources s ON s.ref_id = c.ref_id WHERE c.ref_id = ? AND c.ord = ?`,
            k.refId, k.ord,
          )
          .toArray()[0];
        if (r) out.push(toHit(r));
      }
      return out;
    });
  }

  listSources(limit: number): { counts: Record<SourceStatus, number>; chunks: number; sources: SourceRow[] } {
    return this.metered(() => {
      const counts = { processing: 0, ready: 0, unsupported: 0, failed: 0 } as Record<SourceStatus, number>;
      for (const r of this.q('SELECT status, COUNT(*) AS n FROM sources GROUP BY status').toArray()) {
        counts[r.status as SourceStatus] = r.n as number;
      }
      const chunks = this.q('SELECT COUNT(*) AS n FROM chunks').one().n as number;
      const sources = this.q('SELECT * FROM sources ORDER BY updated_at DESC LIMIT ?', limit).toArray().map(toSource);
      return { counts, chunks, sources };
    });
  }

  /** refId → version/status for every source, so a backfill can skip what's current. */
  versions(): Record<string, { kind: SourceKind; version: string; status: SourceStatus }> {
    return this.metered(() => {
      const out: Record<string, { kind: SourceKind; version: string; status: SourceStatus }> = {};
      for (const r of this.q('SELECT ref_id, kind, version, status FROM sources').toArray()) {
        out[r.ref_id as string] = { kind: r.kind as SourceKind, version: r.version as string, status: r.status as SourceStatus };
      }
      return out;
    });
  }

  // ----- knowledge graph (graph-store.ts) -----

  knownEntities(limit: number) {
    return this.metered(() => graphSql.knownEntities(this.q.bind(this), limit));
  }

  applyExtraction(refId: string, x: Extraction) {
    return this.metered(() => this.ctx.storage.transactionSync(() => graphSql.applyExtraction(this.q.bind(this), refId, x)));
  }

  listEntities(opts: { type?: string; q?: string; limit: number }) {
    return this.metered(() => ({ types: graphSql.entityTypes(this.q.bind(this)), entities: graphSql.listEntities(this.q.bind(this), opts) }));
  }

  getEntity(id: string) {
    return this.metered(() => graphSql.getEntity(this.q.bind(this), id));
  }

  graph(opts: { focus?: string; depth: number; limit: number }) {
    return this.metered(() => graphSql.graph(this.q.bind(this), opts));
  }

  /** This store's SQLite work over the last `days` days, plus its current size. */
  usage(days: number): { bytes: number; sources: number; chunks: number; rowsRead: number; rowsWritten: number } {
    const u = this.sql.exec(
      `SELECT COALESCE(SUM(rows_read), 0) AS r, COALESCE(SUM(rows_written), 0) AS w FROM usage_daily WHERE day >= date('now', ?)`,
      `-${days} days`,
    ).one();
    return {
      bytes: this.sql.databaseSize,
      sources: this.sql.exec('SELECT COUNT(*) AS n FROM sources').one().n as number,
      chunks: this.sql.exec('SELECT COUNT(*) AS n FROM chunks').one().n as number,
      rowsRead: u.r as number,
      rowsWritten: u.w as number,
    };
  }

  private deleteChunks(refId: string): number {
    const rows = this.q('SELECT id, title, text FROM chunks WHERE ref_id = ?', refId).toArray();
    for (const r of rows) {
      this.q("INSERT INTO chunks_fts (chunks_fts, rowid, title, text) VALUES ('delete', ?, ?, ?)", r.id, r.title, r.text);
      if (this.stemmed(r.id as number)) dropStem(this.q.bind(this), r.id as number);
    }
    this.q('DELETE FROM chunks WHERE ref_id = ?', refId);
    return rows.length;
  }
}

function toSource(r: Record<string, SqlStorageValue>): SourceRow {
  return {
    refId: r.ref_id as string,
    kind: r.kind as SourceKind,
    version: r.version as string,
    title: r.title as string,
    ownerId: (r.owner_id as string | null) ?? null,
    status: r.status as SourceStatus,
    error: (r.error as string | null) ?? null,
    chunkCount: r.chunk_count as number,
    updatedAt: r.updated_at as string,
  };
}

const ACCESS = new Set<string>(['all', 'owner', 'none'] satisfies SourceAccess[]);

function cachedAccess(r: Record<string, SqlStorageValue>): CachedAccess {
  const access = r.access as string | null;
  return { access: access && ACCESS.has(access) ? (access as SourceAccess) : null, ownerId: (r.owner_id as string | null) ?? null };
}

function toHit(r: Record<string, SqlStorageValue>): ChunkHit {
  return {
    refId: r.ref_id as string,
    kind: r.kind as SourceKind,
    title: r.title as string,
    ord: r.ord as number,
    locator: r.locator as string,
    text: r.text as string,
    page: (r.page as string | null) ?? null,
    anchor: (r.anchor as string | null) ?? null,
  };
}
