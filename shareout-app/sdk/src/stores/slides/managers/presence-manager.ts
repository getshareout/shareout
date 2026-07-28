import type { SlidesPresenceState } from '../types';

/** Broadcasts and observes collaborative presence over the slides WebSocket. */
export class SlidesPresenceManager {
  constructor(
    private state: Map<string, SlidesPresenceState>,
    private observers: Set<(users: Map<string, SlidesPresenceState>) => void>,
    private ws: WebSocket | null,
  ) {}

  set(presence: Partial<SlidesPresenceState>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'presence', data: presence }));
    }
  }

  get(): Map<string, SlidesPresenceState> {
    return new Map(this.state);
  }

  subscribe(handler: (users: Map<string, SlidesPresenceState>) => void): () => void {
    this.observers.add(handler);
    return () => this.observers.delete(handler);
  }

  getEditorsOnSlide(slideId: string): SlidesPresenceState[] {
    const editors: SlidesPresenceState[] = [];
    for (const state of this.state.values()) {
      if (state.editingSlideId === slideId || state.viewingSlideId === slideId) {
        editors.push(state);
      }
    }
    return editors;
  }
}
