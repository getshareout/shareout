// Per-workspace knowledge corpus: every learned Asset/page version as cited chunks, with
// FTS5 keyword search. One Durable Object per workspace (idFromName(workspaceId)) keeps
// tenants apart by construction and gives each its own SQLite instead of sharing D1.
import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../../types';
import type { Chunk } from './chunk';
import type { ChunkHit, SourceKind, SourceMeta, SourceRow, SourceStatus } from './client';

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
  `CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
    title, text, content='chunks', content_rowid='id', tokenize='unicode61 remove_diacritics 2'
  )`,
];

/** FTS5 MATCH expression from free text: every word quoted (no operator injection), ORed. */
export function ftsQuery(q: string): string | null {
  const words = (q.match(/[\p{L}\p{N}]+/gu) || []).slice(0, 12);
  return words.length ? words.map((w) => `"${w}"`).join(' OR ') : null;
}

export class KnowledgeStore extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(state: DurableObjectState, env: Env) {
    super(state, env);
    this.sql = state.storage.sql;
    state.blockConcurrencyWhile(async () => {
      for (const stmt of SCHEMA) this.sql.exec(stmt);
    });
  }

  getSource(refId: string): SourceRow | null {
    const r = this.sql.exec('SELECT * FROM sources WHERE ref_id = ?', refId).toArray()[0];
    return r ? toSource(r) : null;
  }

  /** Mark a source in flight (or finished without chunks). Keeps its previous chunks. */
  setStatus(meta: SourceMeta, status: SourceStatus, error: string | null = null): void {
    this.sql.exec(
      `INSERT INTO sources (ref_id, kind, version, title, owner_id, status, error)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(ref_id) DO UPDATE SET kind = excluded.kind, version = excluded.version,
         title = excluded.title, owner_id = excluded.owner_id, status = excluded.status,
         error = excluded.error, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
      meta.refId, meta.kind, meta.version, meta.title, meta.ownerId, status, error,
    );
  }

  /** Swap a source's chunks for a new version in one transaction. Returns the old count
   *  so the caller can drop vectors past the new end. */
  replaceChunks(meta: SourceMeta, chunks: Chunk[]): { previousCount: number } {
    return this.ctx.storage.transactionSync(() => {
      const previousCount = this.deleteChunks(meta.refId);
      for (const c of chunks) {
        const id = this.sql.exec(
          'INSERT INTO chunks (ref_id, ord, locator, title, text) VALUES (?, ?, ?, ?, ?) RETURNING id',
          meta.refId, c.ord, c.locator, meta.title, c.text,
        ).one().id;
        this.sql.exec('INSERT INTO chunks_fts (rowid, title, text) VALUES (?, ?, ?)', id, meta.title, c.text);
      }
      this.setStatus(meta, 'processing');
      this.sql.exec('UPDATE sources SET chunk_count = ? WHERE ref_id = ?', chunks.length, meta.refId);
      return { previousCount };
    });
  }

  removeSource(refId: string): { previousCount: number } {
    return this.ctx.storage.transactionSync(() => {
      const previousCount = this.deleteChunks(refId);
      this.sql.exec('DELETE FROM sources WHERE ref_id = ?', refId);
      return { previousCount };
    });
  }

  chunkTexts(refId: string, offset: number, limit: number): { ord: number; text: string }[] {
    return this.sql
      .exec('SELECT ord, title, locator, text FROM chunks WHERE ref_id = ? AND ord >= ? ORDER BY ord LIMIT ?', refId, offset, limit)
      .toArray()
      .map((r) => ({ ord: r.ord as number, text: `${r.title}\n${r.locator}\n${r.text}`.trim() }));
  }

  search(q: string, limit: number): ChunkHit[] {
    const match = ftsQuery(q);
    if (!match) return [];
    return this.sql
      .exec(
        `SELECT c.ref_id, s.kind, c.title, c.ord, c.locator, c.text
           FROM chunks_fts f JOIN chunks c ON c.id = f.rowid JOIN sources s ON s.ref_id = c.ref_id
          WHERE chunks_fts MATCH ? ORDER BY bm25(chunks_fts, 2.0, 1.0) LIMIT ?`,
        match, limit,
      )
      .toArray()
      .map(toHit);
  }

  chunksByKey(keys: { refId: string; ord: number }[]): ChunkHit[] {
    const out: ChunkHit[] = [];
    for (const k of keys) {
      const r = this.sql
        .exec(
          `SELECT c.ref_id, s.kind, c.title, c.ord, c.locator, c.text
             FROM chunks c JOIN sources s ON s.ref_id = c.ref_id WHERE c.ref_id = ? AND c.ord = ?`,
          k.refId, k.ord,
        )
        .toArray()[0];
      if (r) out.push(toHit(r));
    }
    return out;
  }

  listSources(limit: number): { counts: Record<SourceStatus, number>; chunks: number; sources: SourceRow[] } {
    const counts = { processing: 0, ready: 0, unsupported: 0, failed: 0 } as Record<SourceStatus, number>;
    for (const r of this.sql.exec('SELECT status, COUNT(*) AS n FROM sources GROUP BY status').toArray()) {
      counts[r.status as SourceStatus] = r.n as number;
    }
    const chunks = this.sql.exec('SELECT COUNT(*) AS n FROM chunks').one().n as number;
    const sources = this.sql.exec('SELECT * FROM sources ORDER BY updated_at DESC LIMIT ?', limit).toArray().map(toSource);
    return { counts, chunks, sources };
  }

  /** refId → version/status for every source, so a backfill can skip what's current. */
  versions(): Record<string, { version: string; status: SourceStatus }> {
    const out: Record<string, { version: string; status: SourceStatus }> = {};
    for (const r of this.sql.exec('SELECT ref_id, version, status FROM sources').toArray()) {
      out[r.ref_id as string] = { version: r.version as string, status: r.status as SourceStatus };
    }
    return out;
  }

  private deleteChunks(refId: string): number {
    const rows = this.sql.exec('SELECT id, title, text FROM chunks WHERE ref_id = ?', refId).toArray();
    for (const r of rows) {
      this.sql.exec("INSERT INTO chunks_fts (chunks_fts, rowid, title, text) VALUES ('delete', ?, ?, ?)", r.id, r.title, r.text);
    }
    this.sql.exec('DELETE FROM chunks WHERE ref_id = ?', refId);
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

function toHit(r: Record<string, SqlStorageValue>): ChunkHit {
  return {
    refId: r.ref_id as string,
    kind: r.kind as SourceKind,
    title: r.title as string,
    ord: r.ord as number,
    locator: r.locator as string,
    text: r.text as string,
  };
}
