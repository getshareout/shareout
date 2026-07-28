import type { Env } from '../types';
import { generateId } from '../crypto-utils';

interface CommentEvent {
  type: 'comment:added' | 'comment:updated' | 'comment:deleted' | 'comment:resolved';
  comment: {
    id: string;
    contextId: string | null;
    parentId: string | null;
    authorId: string | null;
    authorName: string;
    content: string;
    createdAt: string;
    updatedAt: string;
  };
}

export class CommentsCoordinator implements DurableObject {
  private state: DurableObjectState;
  private env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/broadcast' && request.method === 'POST') {
      return this.handleBroadcast(request);
    }

    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocketUpgrade();
    }

    return new Response(JSON.stringify({ success: false, error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  private async handleWebSocketUpgrade(): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    const clientId = generateId('cws');
    this.state.acceptWebSocket(server, [clientId]);

    server.send(JSON.stringify({ type: 'connected', clientId }));
    this.broadcastPresence();

    return new Response(null, { status: 101, webSocket: client });
  }

  private broadcastPresence(): void {
    const sockets = this.state.getWebSockets();
    const count = sockets.filter((s) => s.readyState === WebSocket.OPEN).length;
    const message = JSON.stringify({ type: 'presence', count });
    for (const socket of sockets) {
      if (socket.readyState === WebSocket.OPEN) socket.send(message);
    }
  }

  private async handleBroadcast(request: Request): Promise<Response> {
    let event: CommentEvent | Record<string, unknown>;
    try {
      event = await request.json();
    } catch {
      return new Response(JSON.stringify({ success: false, error: 'Invalid JSON' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const message = JSON.stringify(event);
    const sockets = this.state.getWebSockets();

    for (const socket of sockets) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(message);
      }
    }

    return new Response(JSON.stringify({ success: true, clients: sockets.length }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    if (typeof message !== 'string') return;
    let data: { type?: string; name?: string };
    try {
      data = JSON.parse(message);
    } catch {
      return;
    }
    if (data.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }));
      return;
    }
    if (data.type === 'typing') {
      const ids = this.state.getTags(ws);
      const senderId = ids[0];
      const relay = JSON.stringify({ type: 'typing', name: data.name || 'Someone', clientId: senderId });
      for (const socket of this.state.getWebSockets()) {
        if (socket !== ws && socket.readyState === WebSocket.OPEN) socket.send(relay);
      }
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    this.broadcastPresence();
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    // Error disconnect, no action needed
  }
}
