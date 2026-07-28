import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommentsCoordinator } from '../../../src/realtime/comments-coordinator';
import type { Env } from '../../../src/types';

function makeDoStateMock(): DurableObjectState & {
  accepted: Array<{ ws: WebSocket; tags: string[] }>;
} {
  const accepted: Array<{ ws: WebSocket; tags: string[] }> = [];
  const tagMap = new WeakMap<WebSocket, string[]>();

  return {
    accepted,
    acceptWebSocket: vi.fn((ws: WebSocket, tags: string[]) => {
      (ws as WebSocket & { accept?: () => void }).accept?.();
      accepted.push({ ws, tags });
      tagMap.set(ws, tags);
    }),
    getWebSockets: vi.fn(() => accepted.map((entry) => entry.ws)),
    getTags: vi.fn((ws: WebSocket) => tagMap.get(ws) ?? []),
    getWebSocketAutoResponseTimestamp: vi.fn(),
    storage: { setAlarm: vi.fn() } as unknown as DurableObjectStorage,
  } as unknown as DurableObjectState & { accepted: Array<{ ws: WebSocket; tags: string[] }> };
}

const baseEnv = {} as Env;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CommentsCoordinator', () => {
  let state: ReturnType<typeof makeDoStateMock>;
  let coordinator: CommentsCoordinator;

  beforeEach(() => {
    state = makeDoStateMock();
    coordinator = new CommentsCoordinator(state, baseEnv);
  });

  it('returns 404 for unknown routes', async () => {
    const response = await coordinator.fetch(new Request('http://do/unknown'));
    expect(response.status).toBe(404);
    const body = await response.json() as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toBe('Not found');
  });

  it('upgrades websocket connection', async () => {
    const response = await coordinator.fetch(new Request('http://do/', {
      headers: { Upgrade: 'websocket' },
    }));

    expect(response.status).toBe(101);
    expect(response.webSocket).toBeDefined();
    expect(state.acceptWebSocket).toHaveBeenCalledTimes(1);
    expect(state.accepted[0].tags[0]).toMatch(/^cws_/);
  });

  it('broadcasts comment events to connected clients', async () => {
    const ws1 = { readyState: WebSocket.OPEN, send: vi.fn() } as unknown as WebSocket;
    const ws2 = { readyState: WebSocket.OPEN, send: vi.fn() } as unknown as WebSocket;
    state.getWebSockets = vi.fn(() => [ws1, ws2]);

    const event = {
      type: 'comment:added' as const,
      comment: {
        id: 'cmt_1',
        contextId: null,
        parentId: null,
        authorId: 'usr_1',
        authorName: 'Alice',
        content: 'Hello',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      },
    };

    const response = await coordinator.fetch(new Request('http://do/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    }));

    expect(response.status).toBe(200);
    const body = await response.json() as { success: boolean; clients: number };
    expect(body.success).toBe(true);
    expect(body.clients).toBe(2);
    expect(ws1.send).toHaveBeenCalledWith(JSON.stringify(event));
    expect(ws2.send).toHaveBeenCalledWith(JSON.stringify(event));
  });

  it('returns 400 for invalid broadcast JSON', async () => {
    const response = await coordinator.fetch(new Request('http://do/broadcast', {
      method: 'POST',
      body: '{invalid',
    }));
    expect(response.status).toBe(400);
    expect((await response.json() as { error: string }).error).toBe('Invalid JSON');
  });

  it('responds to ping with pong', async () => {
    const ws = { send: vi.fn() } as unknown as WebSocket;
    await coordinator.webSocketMessage(ws, JSON.stringify({ type: 'ping' }));
    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: 'pong' }));
  });

  it('ignores invalid websocket JSON messages', async () => {
    const ws = { send: vi.fn() } as unknown as WebSocket;
    await coordinator.webSocketMessage(ws, 'not-json');
    expect(ws.send).not.toHaveBeenCalled();
  });

  it('handles websocket close and error without throwing', async () => {
    const ws = {} as WebSocket;
    await expect(coordinator.webSocketClose(ws, 1000, 'bye', true)).resolves.toBeUndefined();
    await expect(coordinator.webSocketError(ws, new Error('fail'))).resolves.toBeUndefined();
  });

  it('broadcasts presence count on websocket close', async () => {
    const ws1 = { readyState: WebSocket.OPEN, send: vi.fn() } as unknown as WebSocket;
    const ws2 = { readyState: WebSocket.OPEN, send: vi.fn() } as unknown as WebSocket;
    state.getWebSockets = vi.fn(() => [ws1, ws2]);

    await coordinator.webSocketClose({} as WebSocket, 1000, 'bye', true);

    const expected = JSON.stringify({ type: 'presence', count: 2 });
    expect(ws1.send).toHaveBeenCalledWith(expected);
    expect(ws2.send).toHaveBeenCalledWith(expected);
  });

  it('relays typing to other clients but not the sender', async () => {
    const sender = { readyState: WebSocket.OPEN, send: vi.fn() } as unknown as WebSocket;
    const other = { readyState: WebSocket.OPEN, send: vi.fn() } as unknown as WebSocket;
    state.getWebSockets = vi.fn(() => [sender, other]);
    state.getTags = vi.fn(() => ['cws_sender']);

    await coordinator.webSocketMessage(sender, JSON.stringify({ type: 'typing', name: 'Alice' }));

    expect(sender.send).not.toHaveBeenCalled();
    expect(other.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'typing', name: 'Alice', clientId: 'cws_sender' })
    );
  });

  it('skips closed sockets during broadcast', async () => {
    const openWs = { readyState: WebSocket.OPEN, send: vi.fn() } as unknown as WebSocket;
    const closedWs = { readyState: WebSocket.CLOSED, send: vi.fn() } as unknown as WebSocket;
    state.getWebSockets = vi.fn(() => [openWs, closedWs]);

    await coordinator.fetch(new Request('http://do/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'comment:deleted',
        comment: {
          id: 'cmt_1',
          contextId: null,
          parentId: null,
          authorId: null,
          authorName: 'Alice',
          content: '',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      }),
    }));

    expect(openWs.send).toHaveBeenCalled();
    expect(closedWs.send).not.toHaveBeenCalled();
  });
});
