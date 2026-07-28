import type { RealtimeDoc } from '../../realtime-doc';
import type { DashboardPresenceState } from '../types';

/** Collaborative presence: cursors, selection, and edit mode per user. */
export class PresenceManager {
  constructor(private doc: RealtimeDoc) {}

  set(state: Partial<DashboardPresenceState>): void {
    this.doc.presence.set(state as Record<string, unknown>);
  }

  get(): Map<string, DashboardPresenceState> {
    const raw = this.doc.presence.get();
    const result = new Map<string, DashboardPresenceState>();
    for (const [key, value] of raw.entries()) {
      result.set(key, value as unknown as DashboardPresenceState);
    }
    return result;
  }

  subscribe(handler: (users: Map<string, DashboardPresenceState>) => void): () => void {
    return this.doc.presence.subscribe((users) => {
      const mapped = new Map<string, DashboardPresenceState>();
      for (const [key, value] of users.entries()) {
        mapped.set(key, value as unknown as DashboardPresenceState);
      }
      handler(mapped);
    });
  }
}
