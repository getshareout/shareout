import * as Y from 'yjs';
import type { Env } from '../types';
import { generateId } from '../crypto-utils';

const SYNC_STEP1 = 0;
const SYNC_STEP2 = 1;
const UPDATE = 2;

const COMPACTION_THRESHOLD = 100;
const COLD_LOAD_BATCH = 1000;
const MAX_PENDING_UPDATES = 500;
const MAX_PENDING_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_AWARENESS_ENTRIES = 1000;
const AWARENESS_TTL_MS = 30000; // 30s TTL for awareness entries
const RECONNECT_GRACE_MS = 10000; // 10s grace period for reconnection

// DO-local SQLite mirror of the former central-D1 doc tables (work/014 Stage B).
// The DO id already encodes (artifact, doc), so the store holds a single meta row
// (k = 'doc') and its own seq-ordered update log — no artifact_id/doc_id columns.
const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS doc_meta (k TEXT PRIMARY KEY, snapshot BLOB, snapshot_sv BLOB, update_count INTEGER, version INTEGER)`,
  `CREATE TABLE IF NOT EXISTS doc_updates (seq INTEGER PRIMARY KEY, update_data BLOB NOT NULL)`,
];

function toArrayBuffer(u: Uint8Array): ArrayBuffer {
  return (u.byteOffset === 0 && u.byteLength === u.buffer.byteLength ? u.buffer : u.slice().buffer) as ArrayBuffer;
}

interface AwarenessState {
  [key: string]: unknown;
}

interface AwarenessEntry {
  state: AwarenessState;
  lastSeen: number;
}

interface DisconnectedClient {
  state: AwarenessState;
  disconnectedAt: number;
}

export class RealtimeCoordinator implements DurableObject {
  private state: DurableObjectState;
  private env: Env;
  private sql: SqlStorage;
  private doc: Y.Doc | null = null;
  // Only set when a DO-local import failed and we fall back to serving/writing the
  // legacy central-D1 rows for this doc (work/014 Stage B fail-closed path).
  private d1DocId: string | null = null;
  private useD1Fallback = false;
  private artifactId: string | null = null;
  private docName: string | null = null;
  private awareness: Map<string, AwarenessEntry> = new Map();
  private disconnectedClients: Map<string, DisconnectedClient> = new Map();
  private pendingUpdates: Uint8Array[] = [];
  private pendingBytes = 0;
  // The DO is the single writer of its own doc, so seq/update-count live in
  // memory instead of being re-read from D1 on every flush (work/014 Stage A).
  private nextSeq = 1;
  private updateCount = 0;
  private saveScheduled = false;
  private cleanupScheduled = false;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.sql = state.storage.sql;
    state.blockConcurrencyWhile(async () => {
      for (const stmt of SCHEMA) this.sql.exec(stmt);
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/([^/]+)\/([^/]+)$/);

    if (!match) {
      return new Response(JSON.stringify({ success: false, error: 'Invalid path' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const [, artifactId, docName] = match;

    try {
      await this.initializeDoc(artifactId, docName);
    } catch (err) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Failed to initialize document'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (request.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      const clientId = generateId('ws');
      this.state.acceptWebSocket(server, [clientId]);

      this.sendInitialSync(server, clientId);
      this.broadcastPresence('join', clientId, server);

      return new Response(null, { status: 101, webSocket: client });
    }

    if (request.method === 'GET') {
      const state = Y.encodeStateAsUpdate(this.doc!);
      // Build awareness states from entries
      const awarenessStates: Record<string, AwarenessState> = {};
      for (const [id, entry] of this.awareness) {
        awarenessStates[id] = entry.state;
      }
      return new Response(state, {
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-Awareness': JSON.stringify(awarenessStates)
        }
      });
    }

    return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    const tags = this.state.getWebSocketAutoResponseTimestamp(ws);
    const clientId = this.getClientId(ws);

    if (typeof message === 'string') {
      try {
        const data = JSON.parse(message);
        switch (data.type) {
          case 'awareness':
            this.handleAwareness(clientId, data.state, ws);
            break;
          case 'lock':
            this.handleEditorLock(clientId, data, ws);
            break;
          case 'html-update':
            this.handleEditorHtmlUpdate(clientId, data, ws);
            break;
          case 'element-update':
            this.handleEditorElementUpdate(clientId, data, ws);
            break;
        }
      } catch {}
      return;
    }

    const msg = new Uint8Array(message);
    if (msg.length === 0) return;

    const messageType = msg[0];
    const payload = msg.slice(1);

    switch (messageType) {
      case SYNC_STEP1:
        this.handleSyncStep1(ws, payload);
        break;
      case SYNC_STEP2:
        // A client's STEP2 reply carries edits we don't have (e.g. offline edits
        // flushed on reconnect) — persist and fan out like any UPDATE. Skip the
        // empty diff ([0,0]) every handshake produces.
        if (payload.length === 2 && payload[0] === 0 && payload[1] === 0) break;
        this.handleUpdate(ws, clientId, payload);
        break;
      case UPDATE:
        this.handleUpdate(ws, clientId, payload);
        break;
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    const clientId = this.getClientId(ws);
    const entry = this.awareness.get(clientId);

    // Store in disconnected clients with grace period instead of immediate delete
    if (entry) {
      this.disconnectedClients.set(clientId, {
        state: entry.state,
        disconnectedAt: Date.now(),
      });
    }
    this.awareness.delete(clientId);
    this.broadcastPresence('leave', clientId);
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    const clientId = this.getClientId(ws);
    const entry = this.awareness.get(clientId);

    if (entry) {
      this.disconnectedClients.set(clientId, {
        state: entry.state,
        disconnectedAt: Date.now(),
      });
    }
    this.awareness.delete(clientId);
    this.broadcastPresence('leave', clientId);
  }

  async alarm(): Promise<void> {
    this.saveScheduled = false;
    await this.persistUpdates();
  }

  private async initializeDoc(artifactId: string, docName: string): Promise<void> {
    if (this.doc && this.artifactId === artifactId && this.docName === docName) {
      return;
    }

    this.artifactId = artifactId;
    this.docName = docName;
    this.doc = new Y.Doc();
    this.nextSeq = 1;
    this.updateCount = 0;
    this.d1DocId = null;
    this.useD1Fallback = false;

    // 1. Prefer DO-local SQLite — the steady state after import.
    const meta = this.sql
      .exec('SELECT snapshot, snapshot_sv, update_count, version FROM doc_meta WHERE k = ?', 'doc')
      .toArray()[0] as { snapshot: ArrayBuffer | null; update_count: number | null } | undefined;
    if (meta) {
      this.loadLocal(meta);
      return;
    }

    // 2. Local is empty but we already imported/created this doc — it is a
    //    brand-new doc with no history, nothing to load.
    const migrated = await this.state.storage.get<boolean>('migrated');
    if (migrated) {
      this.sql.exec("INSERT OR IGNORE INTO doc_meta (k, update_count, version) VALUES ('doc', 0, 0)");
      return;
    }

    // 3. First touch: lazily import any legacy central-D1 history exactly once.
    await this.importFromD1(artifactId, docName);
  }

  private loadLocal(meta: { snapshot: ArrayBuffer | null; update_count: number | null }): void {
    if (meta.snapshot) {
      Y.applyUpdate(this.doc!, new Uint8Array(meta.snapshot));
    }
    const rows = this.sql
      .exec('SELECT seq, update_data FROM doc_updates ORDER BY seq ASC')
      .toArray() as Array<{ seq: number; update_data: ArrayBuffer }>;
    let lastSeq = 0;
    for (const { seq, update_data } of rows) {
      Y.applyUpdate(this.doc!, new Uint8Array(update_data));
      lastSeq = seq;
    }
    this.updateCount = meta.update_count ?? rows.length;
    this.nextSeq = lastSeq + 1;
  }

  // Read-on-first-touch backfill from the legacy central-D1 tables into DO-local
  // SQLite. If the D1 read throws it propagates (fetch → 500, 'migrated' left unset
  // so the next open retries — fail closed). If the read succeeds but the local
  // write fails, we keep serving/writing D1 for this doc so history is never lost.
  private async importFromD1(artifactId: string, docName: string): Promise<void> {
    const row = await this.env.DB.prepare(
      'SELECT id, snapshot, snapshot_sv, version FROM artifact_docs WHERE artifact_id = ? AND name = ?'
    ).bind(artifactId, docName).first<{
      id: string;
      snapshot: ArrayBuffer | null;
      snapshot_sv: ArrayBuffer | null;
      version: number | null;
    }>();

    if (!row) {
      // Brand-new doc: no legacy history, and never touch central D1 again.
      this.sql.exec("INSERT OR IGNORE INTO doc_meta (k, update_count, version) VALUES ('doc', 0, 0)");
      await this.state.storage.put('migrated', true);
      return;
    }

    if (row.snapshot) {
      Y.applyUpdate(this.doc!, new Uint8Array(row.snapshot));
    }

    // Paged so a pathological backlog (compaction lagging) can't load unbounded
    // rows into memory in one query.
    const collected: Array<{ seq: number; update_data: ArrayBuffer }> = [];
    let lastSeq = 0;
    for (;;) {
      const updates = await this.env.DB.prepare(
        'SELECT seq, update_data FROM artifact_doc_updates WHERE doc_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?'
      ).bind(row.id, lastSeq, COLD_LOAD_BATCH).all<{ seq: number; update_data: ArrayBuffer }>();

      for (const { seq, update_data } of updates.results) {
        Y.applyUpdate(this.doc!, new Uint8Array(update_data));
        collected.push({ seq, update_data });
        lastSeq = seq;
      }
      if (updates.results.length < COLD_LOAD_BATCH) break;
    }

    this.updateCount = collected.length;
    this.nextSeq = lastSeq + 1;

    try {
      this.state.storage.transactionSync(() => {
        this.sql.exec(
          'INSERT OR REPLACE INTO doc_meta (k, snapshot, snapshot_sv, update_count, version) VALUES (?, ?, ?, ?, ?)',
          'doc', row.snapshot, row.snapshot_sv, collected.length, row.version ?? 0
        );
        for (const { seq, update_data } of collected) {
          this.sql.exec('INSERT INTO doc_updates (seq, update_data) VALUES (?, ?)', seq, update_data);
        }
      });
      await this.state.storage.put('migrated', true);
      // A large imported backlog compacts immediately (local, single transaction)
      // so cold reads stay a snapshot + small tail.
      this.maybeCompactSnapshot();
    } catch (err) {
      // Local write failed — the doc already holds the full D1 state, so fall
      // back to the legacy D1 path (do NOT mark migrated; retry on next open).
      console.warn(`RealtimeCoordinator: DO-local import failed for ${artifactId}/${docName}, serving from D1`, err);
      this.useD1Fallback = true;
      this.d1DocId = row.id;
    }
  }

  private getClientId(ws: WebSocket): string {
    const tags = this.state.getTags(ws);
    return tags[0] || 'unknown';
  }

  private sendInitialSync(ws: WebSocket, clientId?: string): void {
    const stateVector = Y.encodeStateVector(this.doc!);
    const msg = new Uint8Array([SYNC_STEP1, ...stateVector]);
    ws.send(msg);

    // Build awareness states from entries
    const awarenessStates: Record<string, AwarenessState> = {};
    for (const [id, entry] of this.awareness) {
      awarenessStates[id] = entry.state;
    }

    const awarenessMsg = JSON.stringify({
      type: 'awareness',
      states: awarenessStates
    });
    ws.send(awarenessMsg);

    // Check if this is a reconnecting client with saved state
    if (clientId) {
      const disconnected = this.disconnectedClients.get(clientId);
      if (disconnected && Date.now() - disconnected.disconnectedAt < RECONNECT_GRACE_MS) {
        // Restore their previous awareness state
        ws.send(JSON.stringify({
          type: 'awareness-restore',
          state: disconnected.state
        }));
        this.disconnectedClients.delete(clientId);
      }
    }
  }

  private handleSyncStep1(ws: WebSocket, stateVector: Uint8Array): void {
    const diff = Y.encodeStateAsUpdate(this.doc!, stateVector);
    const response = new Uint8Array([SYNC_STEP2, ...diff]);
    ws.send(response);

    const clientStateVector = Y.encodeStateVector(this.doc!);
    const request = new Uint8Array([SYNC_STEP1, ...clientStateVector]);
    ws.send(request);
  }

  private handleUpdate(ws: WebSocket, clientId: string, update: Uint8Array): void {
    Y.applyUpdate(this.doc!, update);

    // Enforce memory bounds on pending updates
    if (this.pendingUpdates.length < MAX_PENDING_UPDATES &&
        this.pendingBytes + update.length < MAX_PENDING_BYTES) {
      this.pendingUpdates.push(update);
      this.pendingBytes += update.length;
    } else {
      // Force immediate save if limits reached
      this.persistUpdates();
      this.pendingUpdates.push(update);
      this.pendingBytes = update.length;
    }
    this.scheduleSave();

    const msg = new Uint8Array([UPDATE, ...update]);
    const sockets = this.state.getWebSockets();
    for (const socket of sockets) {
      if (socket !== ws && socket.readyState === WebSocket.OPEN) {
        socket.send(msg);
      }
    }
  }

  private handleAwareness(clientId: string, state: AwarenessState, exclude?: WebSocket): void {
    if (state === null) {
      this.awareness.delete(clientId);
    } else {
      // Enforce awareness entry limit
      if (this.awareness.size >= MAX_AWARENESS_ENTRIES && !this.awareness.has(clientId)) {
        this.cleanupStaleAwareness();
      }
      this.awareness.set(clientId, { state, lastSeen: Date.now() });
    }

    // Schedule periodic cleanup
    this.scheduleCleanup();

    const msg = JSON.stringify({
      type: 'awareness',
      clientId,
      state
    });

    const sockets = this.state.getWebSockets();
    for (const socket of sockets) {
      if (socket !== exclude && socket.readyState === WebSocket.OPEN) {
        socket.send(msg);
      }
    }
  }

  private handleEditorLock(clientId: string, data: { selector: string; lock: boolean; userId: string; userName: string }, exclude?: WebSocket): void {
    const msg = JSON.stringify({
      type: 'lock',
      selector: data.selector,
      lock: data.lock,
      userId: data.userId,
      userName: data.userName,
    });

    const sockets = this.state.getWebSockets();
    for (const socket of sockets) {
      if (socket !== exclude && socket.readyState === WebSocket.OPEN) {
        socket.send(msg);
      }
    }
  }

  private handleEditorHtmlUpdate(clientId: string, data: { html: string; version: number }, exclude?: WebSocket): void {
    const msg = JSON.stringify({
      type: 'html-update',
      html: data.html,
      version: data.version,
    });

    const sockets = this.state.getWebSockets();
    for (const socket of sockets) {
      if (socket !== exclude && socket.readyState === WebSocket.OPEN) {
        socket.send(msg);
      }
    }
  }

  private handleEditorElementUpdate(clientId: string, data: { ops: unknown[]; version?: number }, exclude?: WebSocket): void {
    const msg = JSON.stringify({
      type: 'element-update',
      ops: data.ops,
      version: data.version,
      clientId,
    });

    const sockets = this.state.getWebSockets();
    for (const socket of sockets) {
      if (socket !== exclude && socket.readyState === WebSocket.OPEN) {
        socket.send(msg);
      }
    }
  }

  private cleanupStaleAwareness(): void {
    const now = Date.now();
    for (const [clientId, entry] of this.awareness) {
      if (now - entry.lastSeen > AWARENESS_TTL_MS) {
        this.awareness.delete(clientId);
      }
    }
    // Also cleanup expired disconnected clients
    for (const [clientId, client] of this.disconnectedClients) {
      if (now - client.disconnectedAt > RECONNECT_GRACE_MS) {
        this.disconnectedClients.delete(clientId);
      }
    }
  }

  private scheduleCleanup(): void {
    if (this.cleanupScheduled) return;
    this.cleanupScheduled = true;
    setTimeout(() => {
      this.cleanupScheduled = false;
      this.cleanupStaleAwareness();
    }, AWARENESS_TTL_MS);
  }

  private broadcastPresence(event: 'join' | 'leave', clientId: string, exclude?: WebSocket): void {
    const msg = JSON.stringify({
      type: 'presence',
      event,
      clientId
    });

    const sockets = this.state.getWebSockets();
    for (const socket of sockets) {
      if (socket !== exclude && socket.readyState === WebSocket.OPEN) {
        socket.send(msg);
      }
    }
  }

  private scheduleSave(): void {
    if (this.saveScheduled) return;
    this.saveScheduled = true;
    this.state.storage.setAlarm(Date.now() + 1000);
  }

  private async persistUpdates(): Promise<void> {
    if (this.pendingUpdates.length === 0 || !this.doc) return;
    if (this.useD1Fallback) {
      await this.persistUpdatesD1();
      return;
    }

    const updates = [...this.pendingUpdates];
    this.pendingUpdates = [];
    this.pendingBytes = 0;

    // Claim the seq range up front so an overlapping flush (the forced save in
    // handleUpdate is not awaited) can never reuse a seq.
    let seq = this.nextSeq;
    this.state.storage.transactionSync(() => {
      for (const update of updates) {
        this.sql.exec('INSERT INTO doc_updates (seq, update_data) VALUES (?, ?)', seq++, toArrayBuffer(update));
      }
      this.sql.exec("UPDATE doc_meta SET update_count = update_count + ? WHERE k = 'doc'", updates.length);
    });
    this.nextSeq = seq;
    this.updateCount += updates.length;

    this.maybeCompactSnapshot();
  }

  private maybeCompactSnapshot(): void {
    if (!this.doc || this.updateCount < COMPACTION_THRESHOLD) return;

    const snapshot = Y.encodeStateAsUpdate(this.doc);
    const stateVector = Y.encodeStateVector(this.doc);

    this.state.storage.transactionSync(() => {
      this.sql.exec(
        "UPDATE doc_meta SET snapshot = ?, snapshot_sv = ?, update_count = 0, version = version + 1 WHERE k = 'doc'",
        toArrayBuffer(snapshot), toArrayBuffer(stateVector)
      );
      this.sql.exec('DELETE FROM doc_updates');
    });

    this.updateCount = 0;
    this.nextSeq = 1;
  }

  // Legacy central-D1 persistence — only reached when a DO-local import failed and
  // we fell back to serving this doc from D1 (work/014 Stage B fail-closed path).
  private async persistUpdatesD1(): Promise<void> {
    if (this.pendingUpdates.length === 0 || !this.d1DocId) return;

    const updates = [...this.pendingUpdates];
    this.pendingUpdates = [];
    this.pendingBytes = 0;

    let seq = this.nextSeq;
    const statements = [];
    for (const update of updates) {
      statements.push(
        this.env.DB.prepare(
          'INSERT INTO artifact_doc_updates (id, doc_id, update_data, seq) VALUES (?, ?, ?, ?)'
        ).bind(generateId('upd'), this.d1DocId, update, seq++)
      );
    }
    this.nextSeq = seq;

    statements.push(
      this.env.DB.prepare(
        `UPDATE artifact_docs SET update_count = update_count + ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
      ).bind(updates.length, this.d1DocId)
    );

    await this.env.DB.batch(statements);
    this.updateCount += updates.length;

    await this.maybeCompactSnapshotD1();
  }

  private async maybeCompactSnapshotD1(): Promise<void> {
    if (!this.d1DocId || this.updateCount < COMPACTION_THRESHOLD) return;

    const snapshot = Y.encodeStateAsUpdate(this.doc!);
    const stateVector = Y.encodeStateVector(this.doc!);

    await this.env.DB.batch([
      this.env.DB.prepare(
        `UPDATE artifact_docs SET snapshot = ?, snapshot_sv = ?, update_count = 0, version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`
      ).bind(snapshot, stateVector, this.d1DocId),
      this.env.DB.prepare(
        'DELETE FROM artifact_doc_updates WHERE doc_id = ?'
      ).bind(this.d1DocId)
    ]);

    this.updateCount = 0;
    this.nextSeq = 1;
  }
}
