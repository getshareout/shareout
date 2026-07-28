import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RealtimeCoordinator } from '../../../src/realtime/coordinator';
import type { Env } from '../../../src/types';

const SYNC_STEP1 = 0;
const SYNC_STEP2 = 1;
const UPDATE = 2;

function makeDbMock(handlers: {
  first?: (sql: string, ...bindArgs: unknown[]) => unknown;
  all?: (sql: string, ...bindArgs: unknown[]) => unknown;
  run?: (sql: string, ...bindArgs: unknown[]) => unknown;
  batch?: (statements: unknown[]) => unknown;
} = {}): Env['DB'] {
  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...bindArgs: unknown[]) => ({
        first: vi.fn(async () => handlers.first?.(sql, ...bindArgs) ?? null),
        all: vi.fn(async () => handlers.all?.(sql, ...bindArgs) ?? { results: [] }),
        run: vi.fn(async () => handlers.run?.(sql, ...bindArgs) ?? { success: true }),
      })),
    })),
    batch: vi.fn(async (statements: unknown[]) => handlers.batch?.(statements)),
  } as unknown as Env['DB'];
}

interface MetaRow {
  snapshot: ArrayBuffer | null;
  snapshot_sv: ArrayBuffer | null;
  update_count: number;
  version: number;
}
interface SqlStore {
  meta: MetaRow | null;
  updates: Array<{ seq: number; update_data: ArrayBuffer }>;
  failWrites: boolean;
}

// In-memory stand-in for the DO's own SQLite (state.storage.sql). It pattern-matches
// the fixed set of statements the coordinator issues — the same shape makeDbMock uses.
function makeSqlStore(): { store: SqlStore; sql: SqlStorage } {
  const store: SqlStore = { meta: null, updates: [], failWrites: false };
  const sql = {
    exec(query: string, ...args: unknown[]) {
      let rows: unknown[] = [];
      if (query.startsWith('SELECT snapshot, snapshot_sv, update_count, version FROM doc_meta')) {
        rows = store.meta ? [store.meta] : [];
      } else if (query.startsWith('SELECT seq, update_data FROM doc_updates')) {
        rows = [...store.updates].sort((a, b) => a.seq - b.seq);
      } else if (query.startsWith('INSERT OR IGNORE INTO doc_meta')) {
        if (!store.meta) store.meta = { snapshot: null, snapshot_sv: null, update_count: 0, version: 0 };
      } else if (query.startsWith('INSERT OR REPLACE INTO doc_meta')) {
        store.meta = {
          snapshot: (args[1] ?? null) as ArrayBuffer | null,
          snapshot_sv: (args[2] ?? null) as ArrayBuffer | null,
          update_count: args[3] as number,
          version: args[4] as number,
        };
      } else if (query.startsWith('INSERT INTO doc_updates')) {
        store.updates.push({ seq: args[0] as number, update_data: args[1] as ArrayBuffer });
      } else if (query.startsWith('UPDATE doc_meta SET update_count = update_count +')) {
        if (store.meta) store.meta.update_count += args[0] as number;
      } else if (query.startsWith('UPDATE doc_meta SET snapshot')) {
        store.meta = {
          snapshot: args[0] as ArrayBuffer,
          snapshot_sv: args[1] as ArrayBuffer,
          update_count: 0,
          version: (store.meta?.version ?? 0) + 1,
        };
      } else if (query.startsWith('DELETE FROM doc_updates')) {
        store.updates = [];
      }
      // CREATE TABLE ... and anything else: no-op.
      return { toArray: () => rows };
    },
  } as unknown as SqlStorage;
  return { store, sql };
}

function makePersistence(): { store: SqlStore; sql: SqlStorage; kv: Map<string, unknown> } {
  return { ...makeSqlStore(), kv: new Map<string, unknown>() };
}

function makeDoStateMock(persist = makePersistence()): DurableObjectState & {
  accepted: Array<{ ws: WebSocket; tags: string[] }>;
  alarmFn: ReturnType<typeof vi.fn>;
  persist: ReturnType<typeof makePersistence>;
} {
  const accepted: Array<{ ws: WebSocket; tags: string[] }> = [];
  const tagMap = new WeakMap<WebSocket, string[]>();
  const alarmFn = vi.fn();

  return {
    accepted,
    persist,
    acceptWebSocket: vi.fn((ws: WebSocket, tags: string[]) => {
      (ws as WebSocket & { accept?: () => void }).accept?.();
      accepted.push({ ws, tags });
      tagMap.set(ws, tags);
    }),
    getWebSockets: vi.fn(() => accepted.map((entry) => entry.ws)),
    getTags: vi.fn((ws: WebSocket) => tagMap.get(ws) ?? ['ws_test']),
    getWebSocketAutoResponseTimestamp: vi.fn(),
    blockConcurrencyWhile: (fn: () => unknown) => fn(),
    storage: {
      setAlarm: alarmFn,
      sql: persist.sql,
      transactionSync: (fn: () => unknown) => {
        if (persist.store.failWrites) throw new Error('local write failed');
        return fn();
      },
      get: async (k: string) => persist.kv.get(k),
      put: async (k: string, v: unknown) => { persist.kv.set(k, v); },
    } as unknown as DurableObjectStorage,
    alarmFn,
  } as unknown as DurableObjectState & {
    accepted: Array<{ ws: WebSocket; tags: string[] }>;
    alarmFn: ReturnType<typeof vi.fn>;
    persist: ReturnType<typeof makePersistence>;
  };
}

function makeYUpdateRows(count: number, startSeq = 1): Array<{ seq: number; update_data: Uint8Array }> {
  const src = new Y.Doc();
  const updates: Uint8Array[] = [];
  src.on('update', (u: Uint8Array) => updates.push(u));
  for (let i = 0; i < count; i++) {
    src.getMap('m').set(`k${startSeq + i}`, startSeq + i);
  }
  return updates.map((update_data, i) => ({ seq: startSeq + i, update_data }));
}

function makeCapturingDbMock(handlers: {
  first?: (sql: string, ...bindArgs: unknown[]) => unknown;
  all?: (sql: string, ...bindArgs: unknown[]) => unknown;
} = {}): { db: Env['DB']; prepared: Array<{ sql: string; args: unknown[] }>; batches: Array<Array<{ sql: string; args: unknown[] }>> } {
  const prepared: Array<{ sql: string; args: unknown[] }> = [];
  const batches: Array<Array<{ sql: string; args: unknown[] }>> = [];
  const db = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => {
        const stmt = { sql, args };
        prepared.push(stmt);
        return {
          ...stmt,
          first: async () => handlers.first?.(sql, ...args) ?? null,
          all: async () => handlers.all?.(sql, ...args) ?? { results: [] },
          run: async () => ({ success: true }),
        };
      },
    }),
    batch: async (statements: Array<{ sql: string; args: unknown[] }>) => {
      batches.push(statements);
    },
  } as unknown as Env['DB'];
  return { db, prepared, batches };
}

function mockWebSocket(overrides: Partial<WebSocket> = {}): WebSocket {
  return {
    readyState: WebSocket.OPEN,
    send: vi.fn(),
    ...overrides,
  } as unknown as WebSocket;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('RealtimeCoordinator', () => {
  let state: ReturnType<typeof makeDoStateMock>;
  let env: Env;
  let coordinator: RealtimeCoordinator;

  beforeEach(() => {
    state = makeDoStateMock();
    env = { DB: makeDbMock() } as Env;
    coordinator = new RealtimeCoordinator(state, env);
  });

  it('returns 400 for invalid path', async () => {
    const response = await coordinator.fetch(new Request('http://do/only-one-segment'));
    expect(response.status).toBe(400);
    expect((await response.json() as { error: string }).error).toBe('Invalid path');
  });

  it('returns 500 when document initialization fails', async () => {
    env.DB = makeDbMock({
      first: () => {
        throw new Error('db down');
      },
    });
    coordinator = new RealtimeCoordinator(state, env);

    const response = await coordinator.fetch(new Request('http://do/art_1/default'));
    expect(response.status).toBe(500);
    expect((await response.json() as { error: string }).error).toBe('Failed to initialize document');
  });

  it('creates a new doc purely DO-local — no D1 writes, no D1 reads after first touch', async () => {
    const persist = makePersistence();
    const { db, prepared, batches } = makeCapturingDbMock(); // first() returns null → brand-new doc
    const coord1 = new RealtimeCoordinator(makeDoStateMock(persist), { DB: db } as Env);

    const r1 = await coord1.fetch(new Request('http://do/art_new/default'));
    expect(r1.status).toBe(200);
    expect(batches.length).toBe(0);                 // never writes central D1
    expect(persist.kv.get('migrated')).toBe(true);
    expect(persist.store.meta).not.toBeNull();
    const afterFirst = prepared.length;             // one probing SELECT to rule out legacy history

    const coord2 = new RealtimeCoordinator(makeDoStateMock(persist), { DB: db } as Env);
    await coord2.fetch(new Request('http://do/art_new/default'));
    expect(prepared.length).toBe(afterFirst);       // zero D1 statements on reopen
    expect(batches.length).toBe(0);
  });

  it('loads existing document snapshot and updates from D1', async () => {
    const doc = new Y.Doc();
    const ymap = doc.getMap('test');
    ymap.set('key', 'value');
    const snapshot = Y.encodeStateAsUpdate(doc);

    env.DB = makeDbMock({
      first: (sql) => {
        if (sql.includes('artifact_docs')) {
          return { id: 'doc_1', snapshot, snapshot_sv: null };
        }
        return null;
      },
      all: () => ({ results: [] }),
    });
    coordinator = new RealtimeCoordinator(state, env);

    const response = await coordinator.fetch(new Request('http://do/art_1/default'));
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(response.headers.get('X-Awareness')).toBe('{}');
  });

  it('returns 405 for unsupported HTTP methods', async () => {
    const response = await coordinator.fetch(new Request('http://do/art_1/default', { method: 'POST' }));
    expect(response.status).toBe(405);
  });

  it('accepts websocket upgrade', async () => {
    const response = await coordinator.fetch(new Request('http://do/art_1/default', {
      headers: { Upgrade: 'websocket' },
    }));

    expect(response.status).toBe(101);
    expect(response.webSocket).toBeDefined();
    expect(state.acceptWebSocket).toHaveBeenCalledTimes(1);
    expect(state.accepted[0].tags[0]).toMatch(/^ws_/);
  });

  it('handles Yjs sync step 1 and step 2 over websocket', async () => {
    await coordinator.fetch(new Request('http://do/art_1/default'));
    const ws = mockWebSocket();

    const remoteDoc = new Y.Doc();
    remoteDoc.getMap('shared').set('from-remote', true);
    const stateVector = Y.encodeStateVector(remoteDoc);
    await coordinator.webSocketMessage(ws, new Uint8Array([SYNC_STEP1, ...stateVector]).buffer);

    expect(ws.send).toHaveBeenCalled();
    const calls = vi.mocked(ws.send).mock.calls.map((c) => c[0]);
    const step2 = calls.find((msg) => msg instanceof Uint8Array && msg[0] === SYNC_STEP2);
    expect(step2).toBeDefined();

    const remoteUpdate = Y.encodeStateAsUpdate(remoteDoc);
    await coordinator.webSocketMessage(ws, new Uint8Array([SYNC_STEP2, ...remoteUpdate]).buffer);

    const getResponse = await coordinator.fetch(new Request('http://do/art_1/default'));
    const stateUpdate = new Uint8Array(await getResponse.arrayBuffer());
    const verifyDoc = new Y.Doc();
    Y.applyUpdate(verifyDoc, stateUpdate);
    expect(verifyDoc.getMap('shared').get('from-remote')).toBe(true);
  });

  it('serves current doc state to a late joiner via the sync handshake', async () => {
    await coordinator.fetch(new Request('http://do/art_1/default'));

    // An earlier client seeds an edit.
    const seed = new Y.Doc();
    seed.getMap('elements').set('x', 'seeded');
    await coordinator.webSocketMessage(
      mockWebSocket(),
      new Uint8Array([UPDATE, ...Y.encodeStateAsUpdate(seed)]).buffer
    );

    // A late joiner advertises its (empty) state vector.
    const latecomer = mockWebSocket();
    const emptySv = Y.encodeStateVector(new Y.Doc());
    await coordinator.webSocketMessage(latecomer, new Uint8Array([SYNC_STEP1, ...emptySv]).buffer);

    // It receives SYNC_STEP2 carrying the seeded edit.
    const step2 = vi.mocked(latecomer.send).mock.calls
      .map((c) => c[0])
      .find((m) => m instanceof Uint8Array && m[0] === SYNC_STEP2) as Uint8Array;
    expect(step2).toBeDefined();
    const verify = new Y.Doc();
    Y.applyUpdate(verify, step2.subarray(1));
    expect(verify.getMap('elements').get('x')).toBe('seeded');
  });

  it('persists and broadcasts a SYNC_STEP2 carrying new edits (reconnect flush)', async () => {
    await coordinator.fetch(new Request('http://do/art_1/default'));

    const sender = mockWebSocket();
    const peer = mockWebSocket();
    state.getWebSockets = vi.fn(() => [sender, peer]);

    const offlineDoc = new Y.Doc();
    offlineDoc.getMap('elements').set('offline', 'edit');
    const diff = Y.encodeStateAsUpdate(offlineDoc);

    await coordinator.webSocketMessage(sender, new Uint8Array([SYNC_STEP2, ...diff]).buffer);

    const peerMsg = vi.mocked(peer.send).mock.calls
      .map((c) => c[0])
      .find((m) => m instanceof Uint8Array && m[0] === UPDATE) as Uint8Array;
    expect(peerMsg).toBeDefined();
    const verify = new Y.Doc();
    Y.applyUpdate(verify, peerMsg.subarray(1));
    expect(verify.getMap('elements').get('offline')).toBe('edit');
    expect(state.alarmFn).toHaveBeenCalled();
  });

  it('ignores the empty SYNC_STEP2 every handshake produces (no junk persistence)', async () => {
    await coordinator.fetch(new Request('http://do/art_1/default'));

    const sender = mockWebSocket();
    const peer = mockWebSocket();
    state.getWebSockets = vi.fn(() => [sender, peer]);

    const emptyDiff = Y.encodeStateAsUpdate(new Y.Doc());
    await coordinator.webSocketMessage(sender, new Uint8Array([SYNC_STEP2, ...emptyDiff]).buffer);

    expect(peer.send).not.toHaveBeenCalled();
    expect(state.alarmFn).not.toHaveBeenCalled();
  });

  it('broadcasts binary updates to other clients and schedules save', async () => {
    await coordinator.fetch(new Request('http://do/art_1/default'));

    const sender = mockWebSocket();
    const peer = mockWebSocket();
    state.getWebSockets = vi.fn(() => [sender, peer]);

    const updateDoc = new Y.Doc();
    updateDoc.getMap('data').set('x', 1);
    const update = Y.encodeStateAsUpdate(updateDoc);

    await coordinator.webSocketMessage(sender, new Uint8Array([UPDATE, ...update]).buffer);

    expect(peer.send).toHaveBeenCalled();
    const peerMsg = vi.mocked(peer.send).mock.calls[0]?.[0] as Uint8Array;
    expect(peerMsg[0]).toBe(UPDATE);
    expect(state.alarmFn).toHaveBeenCalled();
  });

  it('handles JSON awareness, lock, html-update, and element-update messages', async () => {
    await coordinator.fetch(new Request('http://do/art_1/default'));
    const sender = mockWebSocket();
    const peer = mockWebSocket();
    state.getWebSockets = vi.fn(() => [sender, peer]);

    await coordinator.webSocketMessage(sender, JSON.stringify({
      type: 'awareness',
      state: { cursor: { x: 1, y: 2 } },
    }));
    let peerMsg = vi.mocked(peer.send).mock.calls.at(-1)?.[0] as string;
    expect(JSON.parse(peerMsg).type).toBe('awareness');

    await coordinator.webSocketMessage(sender, JSON.stringify({
      type: 'lock',
      selector: '#main',
      lock: true,
      userId: 'usr_1',
      userName: 'Alice',
    }));
    peerMsg = vi.mocked(peer.send).mock.calls.at(-1)?.[0] as string;
    expect(JSON.parse(peerMsg)).toMatchObject({ type: 'lock', selector: '#main' });

    await coordinator.webSocketMessage(sender, JSON.stringify({
      type: 'html-update',
      html: '<div>hi</div>',
      version: 2,
    }));
    peerMsg = vi.mocked(peer.send).mock.calls.at(-1)?.[0] as string;
    expect(JSON.parse(peerMsg)).toMatchObject({ type: 'html-update', version: 2 });

    await coordinator.webSocketMessage(sender, JSON.stringify({
      type: 'element-update',
      ops: [{ op: 'setStyle' }],
      version: 3,
    }));
    peerMsg = vi.mocked(peer.send).mock.calls.at(-1)?.[0] as string;
    expect(JSON.parse(peerMsg)).toMatchObject({ type: 'element-update', clientId: 'ws_test' });
  });

  it('clears awareness on null state and ignores invalid JSON', async () => {
    await coordinator.fetch(new Request('http://do/art_1/default'));
    const ws = mockWebSocket();
    const peer = mockWebSocket();
    state.getWebSockets = vi.fn(() => [ws, peer]);

    await coordinator.webSocketMessage(ws, JSON.stringify({ type: 'awareness', state: { user: 'a' } }));
    await coordinator.webSocketMessage(ws, JSON.stringify({ type: 'awareness', state: null }));
    await coordinator.webSocketMessage(ws, 'not-json');
    expect(ws.send).not.toHaveBeenCalled();
  });

  it('stores disconnected client awareness for grace period reconnect', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));

    await coordinator.fetch(new Request('http://do/art_1/default'));
    const ws = mockWebSocket();
    state.getTags = vi.fn(() => ['client_reconnect']);

    await coordinator.webSocketMessage(ws, JSON.stringify({
      type: 'awareness',
      state: { name: 'Alice' },
    }));

    await coordinator.webSocketClose(ws, 1000, 'disconnect', true);

    vi.setSystemTime(new Date('2024-01-01T00:00:05Z'));
    const response = await coordinator.fetch(new Request('http://do/art_1/default', {
      headers: { Upgrade: 'websocket' },
    }));

    expect(response.status).toBe(101);
    expect(state.acceptWebSocket).toHaveBeenCalled();
  });

  it('broadcasts presence leave on websocket close and error', async () => {
    await coordinator.fetch(new Request('http://do/art_1/default'));
    const ws = mockWebSocket();
    const peer = mockWebSocket();
    state.getWebSockets = vi.fn(() => [ws, peer]);

    await coordinator.webSocketMessage(ws, JSON.stringify({ type: 'awareness', state: { user: 'a' } }));
    await coordinator.webSocketClose(ws, 1000, 'bye', true);

    const leaveMsg = vi.mocked(peer.send).mock.calls.at(-1)?.[0] as string;
    expect(JSON.parse(leaveMsg)).toMatchObject({ type: 'presence', event: 'leave' });

    await coordinator.webSocketMessage(ws, JSON.stringify({ type: 'awareness', state: { user: 'b' } }));
    await coordinator.webSocketError(ws, new Error('socket error'));
    const errorLeave = vi.mocked(peer.send).mock.calls.at(-1)?.[0] as string;
    expect(JSON.parse(errorLeave).event).toBe('leave');
  });

  it('persists pending updates to DO-local storage on alarm', async () => {
    const batch = vi.fn();
    env.DB = makeDbMock({ batch }); // first() null → new local doc
    coordinator = new RealtimeCoordinator(state, env);
    await coordinator.fetch(new Request('http://do/art_1/default'));

    const ws = mockWebSocket();
    const updateDoc = new Y.Doc();
    updateDoc.getMap('persist').set('v', 1);
    const update = Y.encodeStateAsUpdate(updateDoc);
    await coordinator.webSocketMessage(ws, new Uint8Array([UPDATE, ...update]).buffer);

    await coordinator.alarm();

    expect(batch).not.toHaveBeenCalled();               // central D1 untouched
    expect(state.persist.store.updates.length).toBe(1);
    expect(state.persist.store.meta?.update_count).toBe(1);
  });

  it('compacts to a local snapshot once pending updates reach the threshold', async () => {
    const batch = vi.fn();
    env.DB = makeDbMock({ batch }); // first() null → new local doc
    coordinator = new RealtimeCoordinator(state, env);
    await coordinator.fetch(new Request('http://do/art_1/default'));

    const ws = mockWebSocket();
    for (let i = 0; i < 100; i++) {
      const d = new Y.Doc();
      d.getMap('compact').set(`k${i}`, i);
      await coordinator.webSocketMessage(ws, new Uint8Array([UPDATE, ...Y.encodeStateAsUpdate(d)]).buffer);
    }

    await coordinator.alarm();

    expect(batch).not.toHaveBeenCalled();
    expect(state.persist.store.meta?.snapshot).not.toBeNull();
    expect(state.persist.store.updates.length).toBe(0);  // update log cleared on compaction
    expect(state.persist.store.meta?.version).toBe(1);
  });

  it('ignores empty binary websocket messages', async () => {
    await coordinator.fetch(new Request('http://do/art_1/default'));
    const ws = mockWebSocket();
    await coordinator.webSocketMessage(ws, new Uint8Array([]).buffer);
    expect(ws.send).not.toHaveBeenCalled();
  });

  it('reuses initialized doc for same artifact and doc name', async () => {
    const prepare = vi.fn((sql: string) => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => {
          if (sql.includes('artifact_docs')) return { id: 'doc_1', snapshot: null, snapshot_sv: null };
          return null;
        }),
        all: vi.fn(async () => ({ results: [] })),
        run: vi.fn(async () => ({ success: true })),
      })),
    }));
    env.DB = { prepare, batch: vi.fn() } as unknown as Env['DB'];
    coordinator = new RealtimeCoordinator(state, env);

    await coordinator.fetch(new Request('http://do/art_1/default'));
    await coordinator.fetch(new Request('http://do/art_1/default'));

    const docQueries = prepare.mock.calls.filter(([sql]) => String(sql).includes('artifact_docs'));
    expect(docQueries.length).toBe(1);
  });

  it('flushes locally with gap-free seq and never writes central D1', async () => {
    const { db, prepared, batches } = makeCapturingDbMock(); // new doc → local only
    coordinator = new RealtimeCoordinator(state, { DB: db } as Env);
    await coordinator.fetch(new Request('http://do/art_1/default'));
    const afterImport = prepared.length; // single probing SELECT

    const sendUpdate = async (map: string) => {
      const d = new Y.Doc();
      d.getMap(map).set('v', map);
      await coordinator.webSocketMessage(mockWebSocket(), new Uint8Array([UPDATE, ...Y.encodeStateAsUpdate(d)]).buffer);
    };

    await sendUpdate('a');
    await sendUpdate('b');
    await coordinator.alarm();
    await sendUpdate('c');
    await coordinator.alarm();

    expect(prepared.length).toBe(afterImport); // no further D1 statements
    expect(batches.length).toBe(0);
    expect(state.persist.store.updates.map((u) => u.seq)).toEqual([1, 2, 3]);
  });

  it('round-trips locally and re-derives seq across eviction, never re-reading D1', async () => {
    const persist = makePersistence();
    const { db } = makeCapturingDbMock(); // new doc → local only
    const coord1 = new RealtimeCoordinator(makeDoStateMock(persist), { DB: db } as Env);
    await coord1.fetch(new Request('http://do/art_1/default'));

    for (let i = 0; i < 3; i++) {
      const d = new Y.Doc();
      d.getMap('m').set(`k${i}`, i);
      await coord1.webSocketMessage(mockWebSocket(), new Uint8Array([UPDATE, ...Y.encodeStateAsUpdate(d)]).buffer);
    }
    await coord1.alarm();

    // Evict + reload: fresh coordinator sharing the same DO storage.
    const { db: db2, prepared: prepared2, batches: batches2 } = makeCapturingDbMock();
    const coord2 = new RealtimeCoordinator(makeDoStateMock(persist), { DB: db2 } as Env);
    const response = await coord2.fetch(new Request('http://do/art_1/default'));

    expect(prepared2.length).toBe(0); // reload reads only DO-local storage
    expect(batches2.length).toBe(0);

    // Yjs state survived the round-trip.
    const stateUpdate = new Uint8Array(await response.arrayBuffer());
    const verify = new Y.Doc();
    Y.applyUpdate(verify, stateUpdate);
    expect(verify.getMap('m').get('k0')).toBe(0);
    expect(verify.getMap('m').get('k2')).toBe(2);

    // Post-eviction flush continues the seq without collision.
    const d = new Y.Doc();
    d.getMap('m').set('after', true);
    await coord2.webSocketMessage(mockWebSocket(), new Uint8Array([UPDATE, ...Y.encodeStateAsUpdate(d)]).buffer);
    await coord2.alarm();
    expect(persist.store.updates.map((u) => u.seq)).toEqual([1, 2, 3, 4]);
  });

  it('imports legacy D1 history exactly once, then reads only DO-local on reopen', async () => {
    const persist = makePersistence();
    const seed = new Y.Doc();
    seed.getMap('t').set('k', 'v');
    const snapshot = Y.encodeStateAsUpdate(seed);
    const { db, prepared } = makeCapturingDbMock({
      first: (sql) => (sql.includes('artifact_docs') ? { id: 'doc_1', snapshot, snapshot_sv: null, version: 0 } : null),
      all: () => ({ results: [] }),
    });

    const coord1 = new RealtimeCoordinator(makeDoStateMock(persist), { DB: db } as Env);
    await coord1.fetch(new Request('http://do/art_1/default'));
    const importCalls = prepared.length;
    expect(importCalls).toBeGreaterThan(0);
    expect(persist.kv.get('migrated')).toBe(true);
    expect(persist.store.meta?.snapshot).not.toBeNull();

    const coord2 = new RealtimeCoordinator(makeDoStateMock(persist), { DB: db } as Env);
    await coord2.fetch(new Request('http://do/art_1/default'));
    expect(prepared.length).toBe(importCalls); // no new D1 statements on reopen
  });

  it('pages the D1 import, applies every update, and compacts a large backlog locally', async () => {
    const rows = makeYUpdateRows(1500);
    const pageSizes: number[] = [];
    const db = makeDbMock({
      first: (sql) => (sql.includes('artifact_docs') ? { id: 'doc_1', snapshot: null, snapshot_sv: null, version: 0 } : null),
      all: (_sql, _docId, lastSeq, limit) => {
        const page = rows.filter((r) => r.seq > (lastSeq as number)).slice(0, limit as number);
        pageSizes.push(page.length);
        return { results: page };
      },
    });
    coordinator = new RealtimeCoordinator(state, { DB: db } as Env);
    const response = await coordinator.fetch(new Request('http://do/art_1/default'));

    expect(pageSizes).toEqual([1000, 500]);
    // Imported into DO-local, then compacted locally: snapshot present, log emptied.
    expect(state.persist.store.meta?.snapshot).not.toBeNull();
    expect(state.persist.store.updates.length).toBe(0);

    const stateUpdate = new Uint8Array(await response.arrayBuffer());
    const verify = new Y.Doc();
    Y.applyUpdate(verify, stateUpdate);
    expect(verify.getMap('m').get('k1')).toBe(1);
    expect(verify.getMap('m').get('k1500')).toBe(1500);
  });

  it('falls back to the D1 path when the DO-local import write fails, without losing history', async () => {
    const persist = makePersistence();
    persist.store.failWrites = true; // transactionSync throws → local import write fails
    const seed = new Y.Doc();
    seed.getMap('t').set('k', 'v');
    const snapshot = Y.encodeStateAsUpdate(seed);
    const batch = vi.fn();
    const db = makeDbMock({
      first: (sql) => (sql.includes('artifact_docs') ? { id: 'doc_1', snapshot, snapshot_sv: null, version: 0 } : null),
      all: () => ({ results: [] }),
      batch,
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    coordinator = new RealtimeCoordinator(makeDoStateMock(persist), { DB: db } as Env);

    const response = await coordinator.fetch(new Request('http://do/art_1/default'));
    expect(response.status).toBe(200);

    // Doc still served from the D1 snapshot — no history lost.
    const stateUpdate = new Uint8Array(await response.arrayBuffer());
    const verify = new Y.Doc();
    Y.applyUpdate(verify, stateUpdate);
    expect(verify.getMap('t').get('k')).toBe('v');

    // Not marked migrated, so the next open retries the import.
    expect(persist.kv.get('migrated')).toBeUndefined();

    // Subsequent flush uses the legacy D1 write path.
    const d = new Y.Doc();
    d.getMap('x').set('n', 1);
    await coordinator.webSocketMessage(mockWebSocket(), new Uint8Array([UPDATE, ...Y.encodeStateAsUpdate(d)]).buffer);
    await coordinator.alarm();
    expect(batch).toHaveBeenCalled();
  });

  it('schedules awareness cleanup with stale entry removal', async () => {
    vi.useFakeTimers();
    await coordinator.fetch(new Request('http://do/art_1/default'));

    const ws = mockWebSocket();
    state.getWebSockets = vi.fn(() => [ws]);

    for (let i = 0; i < 3; i++) {
      state.getTags = vi.fn(() => [`client_${i}`]);
      await coordinator.webSocketMessage(ws, JSON.stringify({
        type: 'awareness',
        state: { idx: i },
      }));
    }

    vi.advanceTimersByTime(31000);
    await Promise.resolve();

    const getResponse = await coordinator.fetch(new Request('http://do/art_1/default'));
    expect(getResponse.status).toBe(200);
  });
});
