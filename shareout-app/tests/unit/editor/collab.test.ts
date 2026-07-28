/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getCollabClientScript,
  handleEditorWebSocket,
} from '../../../src/editor/collab/index';
import type { EditorContext } from '../../../src/editor/index';
import type { Env } from '../../../src/types';
import { loadEditorClass } from './helpers/load-editor-script';

function makeRealtimeMock(): {
  fetchMock: ReturnType<typeof vi.fn>;
  idFromName: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  realtime: Env['REALTIME'];
} {
  const fetchMock = vi.fn(async () => new Response('upgraded', { status: 101 }));
  const stub = { fetch: fetchMock };
  const idFromName = vi.fn(() => ({ toString: () => 'do-id' }));
  const get = vi.fn(() => stub);
  return {
    fetchMock,
    idFromName,
    get,
    realtime: { idFromName, get } as unknown as Env['REALTIME'],
  };
}

function baseCtx(overrides: Partial<EditorContext> = {}): EditorContext {
  const { realtime } = makeRealtimeMock();

  return {
    artifactId: 'art_1',
    userId: 'usr_1',
    userName: 'Test User',
    userAvatar: 'https://example.com/avatar.png',
    role: 'owner',
    env: { REALTIME: realtime } as unknown as Env,
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('handleEditorWebSocket', () => {
  it('forwards upgrade to the editor durable object with user headers', async () => {
    const { fetchMock, idFromName, get, realtime } = makeRealtimeMock();
    const ctx = baseCtx({ env: { REALTIME: realtime } as unknown as Env });

    const req = new Request('https://shareout.test/v1/artifacts/art_1/editor/ws', {
      headers: { 'X-Extra': 'keep' },
    });
    const res = await handleEditorWebSocket(req, ctx);

    expect(idFromName).toHaveBeenCalledWith('editor:art_1');
    expect(get).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const forwarded = fetchMock.mock.calls[0][0] as Request;
    expect(forwarded.method).toBe('GET');
    expect(forwarded.url).toContain('/art_1/editor');
    expect(forwarded.headers.get('X-User-Id')).toBe('usr_1');
    expect(forwarded.headers.get('X-User-Name')).toBe('Test User');
    expect(forwarded.headers.get('X-User-Avatar')).toBe('https://example.com/avatar.png');
    expect(forwarded.headers.get('X-Extra')).toBe('keep');
    expect(res.status).toBe(101);
  });

  it('omits avatar header when not provided', async () => {
    const { fetchMock, realtime } = makeRealtimeMock();
    const ctx = baseCtx({ userAvatar: undefined, env: { REALTIME: realtime } as unknown as Env });

    await handleEditorWebSocket(new Request('https://shareout.test/ws'), ctx);

    const forwarded = fetchMock.mock.calls[0][0] as Request;
    expect(forwarded.headers.get('X-User-Avatar')).toBeNull();
  });
});

interface EditorCollabInstance {
  artifactId: string;
  userId: string;
  awareness: Map<string, Record<string, unknown>>;
  softLocks: Map<string, Record<string, unknown>>;
  userColor: string | null;
  reconnectAttempts: number;
  ws: { readyState: number; send: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> } | null;
  handlers: Record<string, (...args: unknown[]) => void>;
  connect: () => void;
  handleMessage: (data: string) => void;
  getPresences: () => Array<Record<string, unknown>>;
  sendAwareness: (state: Record<string, unknown>) => void;
  updateCursor: (x: number, y: number) => void;
  updateSelection: (selector: string) => void;
  setTyping: (isTyping: boolean) => void;
  acquireLock: (selector: string) => void;
  releaseLock: (selector: string) => void;
  canEdit: (selector: string) => boolean;
  broadcastHtmlUpdate: (html: string, version: number) => void;
  scheduleReconnect: () => void;
  disconnect: () => void;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
}

describe('getCollabClientScript / EditorCollab', () => {
  let EditorCollab: new (
    artifactId: string,
    userId: string,
    userName: string,
    userAvatar?: string,
  ) => EditorCollabInstance;
  let collab: EditorCollabInstance;
  let send: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    send = vi.fn();
    EditorCollab = loadEditorClass(getCollabClientScript(), 'EditorCollab');
    collab = new EditorCollab('art_1', 'usr_1', 'Alice', 'https://a.png');
    collab.ws = {
      readyState: WebSocket.OPEN,
      send,
      close: vi.fn(),
    };
  });

  it('registers EditorCollab on window', () => {
    expect(typeof (globalThis as { EditorCollab?: unknown }).EditorCollab).toBe('function');
  });

  it('handles awareness batch updates and ignores self', () => {
    const onPresenceUpdate = vi.fn();
    collab.on('presenceUpdate', onPresenceUpdate);

    collab.handleMessage(JSON.stringify({
      type: 'awareness',
      states: {
        client_a: { userId: 'usr_2', userName: 'Bob', userColor: '#22c55e', isTyping: false },
        client_b: { userId: 'usr_1', userName: 'Alice', userColor: '#ef4444', isTyping: false },
      },
    }));

    expect(collab.userColor).toBe('#ef4444');
    expect(collab.awareness.size).toBe(1);
    expect(onPresenceUpdate).toHaveBeenCalledWith([
      expect.objectContaining({ userId: 'usr_2', clientId: 'client_a' }),
    ]);
  });

  it('handles single awareness update and presence leave', () => {
    const onPresenceUpdate = vi.fn();
    collab.on('presenceUpdate', onPresenceUpdate);
    collab.awareness.set('client_a', { userId: 'usr_2', userName: 'Bob', isTyping: false });

    collab.handleMessage(JSON.stringify({
      type: 'awareness',
      clientId: 'client_b',
      state: { userId: 'usr_3', userName: 'Carol', isTyping: true },
    }));
    expect(collab.awareness.has('client_b')).toBe(true);

    collab.handleMessage(JSON.stringify({
      type: 'presence',
      event: 'leave',
      clientId: 'client_a',
    }));
    expect(collab.awareness.has('client_a')).toBe(false);
    expect(onPresenceUpdate).toHaveBeenCalled();
  });

  it('handles lock acquire/release and html-update events', () => {
    const onLockUpdate = vi.fn();
    const onHtmlUpdate = vi.fn();
    collab.on('lockUpdate', onLockUpdate);
    collab.on('htmlUpdate', onHtmlUpdate);

    collab.handleMessage(JSON.stringify({
      type: 'lock',
      selector: '#title',
      lock: true,
      userId: 'usr_2',
      userName: 'Bob',
    }));
    expect(collab.softLocks.has('#title')).toBe(true);
    expect(onLockUpdate).toHaveBeenCalledWith(collab.softLocks);

    collab.handleMessage(JSON.stringify({
      type: 'lock',
      selector: '#title',
      lock: false,
      userId: 'usr_2',
    }));
    expect(collab.softLocks.has('#title')).toBe(false);

    collab.handleMessage(JSON.stringify({
      type: 'html-update',
      html: '<h1>Hi</h1>',
      version: 2,
    }));
    expect(onHtmlUpdate).toHaveBeenCalledWith('<h1>Hi</h1>', 2);
  });

  it('ignores malformed websocket payloads', () => {
    expect(() => collab.handleMessage('{')).not.toThrow();
  });

  it('sends awareness, cursor, selection, typing, lock, and html messages', () => {
    collab.userColor = '#3b82f6';
    collab.sendAwareness({ isTyping: false });
    collab.updateCursor(5, 10);
    collab.updateSelection('#title');
    collab.setTyping(true);
    collab.acquireLock('#title');
    collab.releaseLock('#title');
    collab.broadcastHtmlUpdate('<p>x</p>', 1);

    expect(send).toHaveBeenCalled();
    const payloads = send.mock.calls.map(([raw]) => JSON.parse(raw as string));
    expect(payloads.some((p) => p.type === 'awareness')).toBe(true);
    expect(payloads.some((p) => p.type === 'lock' && p.lock === true)).toBe(true);
    expect(payloads.some((p) => p.type === 'lock' && p.lock === false)).toBe(true);
    expect(payloads.some((p) => p.type === 'html-update')).toBe(true);
  });

  it('canEdit respects local soft locks', () => {
    collab.softLocks.set('#title', {
      selector: '#title',
      userId: 'usr_2',
      userName: 'Bob',
      lockedAt: Date.now(),
      expiresAt: Date.now() + 5000,
    });
    expect(collab.canEdit('#title')).toBe(false);
    expect(collab.canEdit('#other')).toBe(true);

    collab.softLocks.set('#title', {
      selector: '#title',
      userId: 'usr_1',
      userName: 'Alice',
      lockedAt: Date.now(),
      expiresAt: Date.now() + 5000,
    });
    expect(collab.canEdit('#title')).toBe(true);
  });

  it('scheduleReconnect backs off until max attempts', () => {
    const connectSpy = vi.spyOn(collab, 'connect').mockImplementation(() => {});
    collab.reconnectAttempts = 0;
    collab.scheduleReconnect();
    vi.runAllTimers();
    expect(connectSpy).toHaveBeenCalledTimes(1);

    collab.reconnectAttempts = 5;
    connectSpy.mockClear();
    collab.scheduleReconnect();
    vi.runAllTimers();
    expect(connectSpy).not.toHaveBeenCalled();
  });

  it('disconnect closes websocket', () => {
    collab.disconnect();
    expect(collab.ws).toBeNull();
  });

  it('connect wires websocket lifecycle handlers', () => {
    const WebSocketMock = vi.fn(function WebSocketMock(this: {
      onopen: (() => void) | null;
      onmessage: ((event: { data: string }) => void) | null;
      onclose: (() => void) | null;
      onerror: (() => void) | null;
      readyState: number;
      send: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
    }) {
      this.onopen = null;
      this.onmessage = null;
      this.onclose = null;
      this.onerror = null;
      this.readyState = WebSocket.OPEN;
      this.send = vi.fn();
      this.close = vi.fn();
    });
    vi.stubGlobal('WebSocket', WebSocketMock as unknown as typeof WebSocket);

    collab.ws = null;
    collab.connect();
    expect(WebSocketMock).toHaveBeenCalledWith(expect.stringContaining('/v1/artifacts/art_1/editor/ws'));

    const ws = WebSocketMock.mock.instances[0] as {
      onopen: (() => void) | null;
      onmessage: ((event: { data: string }) => void) | null;
      onclose: (() => void) | null;
      onerror: (() => void) | null;
      send: ReturnType<typeof vi.fn>;
    };
    ws.onopen?.();
    expect(ws.send).toHaveBeenCalled();

    const handleSpy = vi.spyOn(collab, 'handleMessage');
    ws.onmessage?.({ data: JSON.stringify({ type: 'html-update', html: '<p>a</p>', version: 1 }) });
    expect(handleSpy).toHaveBeenCalled();

    const reconnectSpy = vi.spyOn(collab, 'scheduleReconnect');
    ws.onclose?.();
    expect(reconnectSpy).toHaveBeenCalled();
    expect(() => ws.onerror?.()).not.toThrow();
  });
});
