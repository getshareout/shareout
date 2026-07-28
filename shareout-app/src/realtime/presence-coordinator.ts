// PresenceCoordinator — live concurrent-viewer count, one DO per artifact.
//
// Every served artifact injects a presence beacon (src/serve/presence-beacon.ts)
// that POSTs /v1/presence every ~20s while the tab is visible. The endpoint resolves
// a coarse viewer id (visitor hash / no cookie) and forwards a `beat` here. We hold
// viewerId -> lastSeenMs in memory and expire entries past a 45s TTL (>2 missed beats).
//
// alarm() is the self-cleaning loop: while any viewer is
// present it reschedules every 30s and prunes stale ids; when the room empties it
// stops, so an idle artifact's DO goes dormant. State is in-memory only — if the DO is
// evicted between beats the count momentarily resets to 0 and repopulates within one
// heartbeat. That's acceptable for a live, best-effort gauge.

import type { Env } from '../types';

const TTL_MS = 45_000;      // drop a viewer after ~2 missed 20s beats
const SWEEP_MS = 30_000;    // alarm cadence while viewers remain

export class PresenceCoordinator implements DurableObject {
  private storage: DurableObjectStorage;
  private viewers = new Map<string, number>();

  constructor(state: DurableObjectState, _env: Env) {
    this.storage = state.storage;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/beat') {
      const { viewerId } = (await request.json()) as { viewerId?: string };
      if (viewerId) {
        this.viewers.set(viewerId, Date.now());
        // Arm the sweeper if it isn't already running.
        if ((await this.storage.getAlarm()) === null) {
          await this.storage.setAlarm(Date.now() + SWEEP_MS);
        }
      }
      return new Response(null, { status: 204 });
    }

    if (url.pathname === '/count') {
      return Response.json({ count: this.prune() });
    }

    return new Response('not found', { status: 404 });
  }

  async alarm(): Promise<void> {
    // Reschedule only while someone is still here; otherwise let the DO go dormant.
    if (this.prune() > 0) {
      await this.storage.setAlarm(Date.now() + SWEEP_MS);
    }
  }

  /** Drop expired viewers and return the live count. */
  private prune(): number {
    const cutoff = Date.now() - TTL_MS;
    for (const [id, seen] of this.viewers) {
      if (seen < cutoff) this.viewers.delete(id);
    }
    return this.viewers.size;
  }
}
