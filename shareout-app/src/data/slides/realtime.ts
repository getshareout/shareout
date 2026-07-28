import type { DataContext } from '../middleware';
import type { SlideEvent } from './types';

export async function broadcastEvent(ctx: DataContext, presId: string, event: SlideEvent): Promise<void> {
  try {
    const id = ctx.env.REALTIME.idFromName(`slides:${ctx.artifactId}`);
    const stub = ctx.env.REALTIME.get(id);
    await stub.fetch(
      new Request('https://internal/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ presId, ...event }),
      })
    );
  } catch {
    // Silently fail broadcast
  }
}

