import type { Env } from '../types';

// Per-artifact mini-store backend: SQLite inside a Durable Object (ADR 28 / plan §13.5).
// One DO instance per artifact removes the single-writer bottleneck and shared size
// ceiling of the previous one-shared-D1 design. The schema mirrors the former D1 tables
// so the json/table handlers keep their artifact_id-scoped queries unchanged; the DO is
// reached through createMiniDb(), a D1-compatible client.

const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS artifact_json (
    id TEXT PRIMARY KEY,
    artifact_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(artifact_id, key)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_json_artifact ON artifact_json(artifact_id)`,
  `CREATE INDEX IF NOT EXISTS idx_json_artifact_key ON artifact_json(artifact_id, key)`,
  `CREATE TABLE IF NOT EXISTS artifact_tables (
    id TEXT PRIMARY KEY,
    artifact_id TEXT NOT NULL,
    name TEXT NOT NULL,
    row_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE(artifact_id, name)
  )`,
  `CREATE TABLE IF NOT EXISTS artifact_rows (
    id TEXT PRIMARY KEY,
    table_id TEXT NOT NULL REFERENCES artifact_tables(id) ON DELETE CASCADE,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_tables_artifact ON artifact_tables(artifact_id)`,
  `CREATE INDEX IF NOT EXISTS idx_rows_table ON artifact_rows(table_id)`,
  `CREATE INDEX IF NOT EXISTS idx_rows_created ON artifact_rows(table_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_rows_updated ON artifact_rows(table_id, updated_at)`,
  // Inbound email messages for the artifact's opt-in inbox (migration 0067).
  // attachments_json holds [{filename, contentType, size, r2Key}] — bytes live in R2.
  `CREATE TABLE IF NOT EXISTS inbox_messages (
    id TEXT PRIMARY KEY,
    artifact_id TEXT NOT NULL,
    message_id TEXT UNIQUE,
    from_addr TEXT NOT NULL,
    to_addr TEXT NOT NULL,
    tag TEXT,
    subject TEXT,
    text_body TEXT,
    html_body TEXT,
    spf TEXT,
    dkim TEXT,
    dmarc TEXT,
    attachments_json TEXT,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    received_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_inbox_received ON inbox_messages(received_at)`,
];

interface Statement {
  sql: string;
  bindings?: unknown[];
  mode?: 'first' | 'all' | 'run';
}

interface ExecBody extends Statement {
  batch?: Statement[];
}

export class MiniDB implements DurableObject {
  private sql: SqlStorage;
  private storage: DurableObjectStorage;

  constructor(state: DurableObjectState, _env: Env) {
    this.sql = state.storage.sql;
    this.storage = state.storage;
    state.blockConcurrencyWhile(async () => {
      for (const stmt of SCHEMA) this.sql.exec(stmt);
    });
  }

  async fetch(request: Request): Promise<Response> {
    // Enforce the workspace_id partition invariant: a DO is bound to the first
    // workspace that writes to it and rejects any later cross-workspace access.
    const workspaceId = request.headers.get('X-Workspace-Id');
    if (workspaceId) {
      const bound = await this.storage.get<string>('workspace_id');
      if (bound === undefined) {
        await this.storage.put('workspace_id', workspaceId);
      } else if (bound !== workspaceId) {
        return Response.json({ error: 'workspace mismatch' }, { status: 409 });
      }
    }

    let body: ExecBody;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: 'invalid request' }, { status: 400 });
    }

    if (body.batch) {
      try {
        // All statements run in one synchronous SQLite transaction: any error rolls
        // back the whole batch, which is what gives bulk insert/update atomicity.
        const results = this.storage.transactionSync(() =>
          body.batch!.map((stmt) => this.execOne(stmt)),
        );
        return Response.json({ results });
      } catch (e) {
        return Response.json({ error: (e as Error).message }, { status: 500 });
      }
    }

    try {
      return Response.json(this.execOne(body));
    } catch (e) {
      return Response.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  private execOne({ sql, bindings = [], mode = 'all' }: Statement) {
    const cursor = this.sql.exec(sql, ...bindings);
    if (mode === 'run') {
      cursor.toArray();
      return { meta: { changes: cursor.rowsWritten } };
    }
    const rows = cursor.toArray();
    if (mode === 'first') {
      return { result: rows[0] ?? null };
    }
    return { results: rows };
  }
}
