import { errorResponse, type DataContext } from '../middleware';
import type { CommentEvent } from './types';
import { getSession } from './auth';

/** Proxy WebSocket upgrade to the per-artifact COMMENTS Durable Object. */
export async function handleWebSocket(request: Request, ctx: DataContext): Promise<Response> {
  if (request.headers.get('Upgrade') !== 'websocket') {
    return errorResponse({ code: 'UPGRADE_REQUIRED', message: 'WebSocket upgrade required', status: 426 });
  }

  // Public (and legacy unlisted) pages may stream anonymously — the page itself is
  // already open. Private/workspace pages require a session so a leaked artifact id
  // alone cannot open a live comment channel.
  const vis = ctx.artifact?.visibility || 'public';
  if (vis === 'private' || vis === 'workspace') {
    const session = await getSession(request, ctx);
    if (!session) {
      return errorResponse({
        code: 'AUTH_REQUIRED',
        message: 'Sign in to subscribe to comments on this page',
        status: 401,
      });
    }
  }

  const id = ctx.env.COMMENTS.idFromName(ctx.artifactId);
  const stub = ctx.env.COMMENTS.get(id);
  return stub.fetch(request);
}

/** Broadcast a typed comment lifecycle event to connected viewers. */
export function broadcastEvent(ctx: DataContext, event: CommentEvent): Promise<void> {
  return broadcastRaw(ctx, event);
}

/** Post an arbitrary payload to the COMMENTS DO broadcast channel. */
export async function broadcastRaw(ctx: DataContext, payload: unknown): Promise<void> {
  try {
    const id = ctx.env.COMMENTS.idFromName(ctx.artifactId);
    const stub = ctx.env.COMMENTS.get(id);
    await stub.fetch(new Request('https://internal/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }));
  } catch {
    // Silently fail if broadcast fails — comments are already persisted.
  }
}
