import type { RealtimeDoc } from '../../realtime-doc';
import type { DashboardPresentationState } from '../types';

/** Presentation mode: focus, cycling, countdown timer, and laser pointer. */
export class DashboardPresenterManager {
  constructor(private doc: RealtimeDoc) {}

  async start(options?: {
    focusWidgetId?: string;
    countdown?: number;
    hideFilters?: boolean;
    autoRefresh?: boolean;
  }): Promise<void> {
    const state = this.doc.map<unknown>('presentationState');
    this.doc.transact(() => {
      state.set('isPresenting', true);
      state.set('startedAt', Date.now());
      state.set('focusedWidgetId', options?.focusWidgetId || null);
      if (options?.countdown) {
        state.set('countdown', { total: options.countdown, remaining: options.countdown, paused: false });
      }
    });
  }

  stop(): void {
    const state = this.doc.map<unknown>('presentationState');
    this.doc.transact(() => {
      state.set('isPresenting', false);
      state.set('startedAt', null);
      state.set('focusedWidgetId', null);
      state.set('countdown', null);
      state.set('cycling', null);
    });
  }

  state(): DashboardPresentationState {
    const state = this.doc.map<unknown>('presentationState');
    return state.toJSON() as unknown as DashboardPresentationState;
  }

  isActive(): boolean {
    return this.state().isPresenting;
  }

  isPresenter(): boolean {
    return this.state().presenterId !== null;
  }

  focusWidget(widgetId: string): void {
    const state = this.doc.map<unknown>('presentationState');
    state.set('focusedWidgetId', widgetId);
  }

  clearFocus(): void {
    const state = this.doc.map<unknown>('presentationState');
    state.set('focusedWidgetId', null);
  }

  startCycle(options?: { widgetIds?: string[]; interval?: number; loop?: boolean }): void {
    const state = this.doc.map<unknown>('presentationState');
    state.set('cycling', {
      active: true,
      currentIndex: 0,
      widgetIds: options?.widgetIds || [],
    });
  }

  stopCycle(): void {
    const state = this.doc.map<unknown>('presentationState');
    state.set('cycling', null);
  }

  get timer() {
    return {
      elapsed: (): number => {
        const s = this.state();
        if (!s.startedAt) return 0;
        return Math.floor((Date.now() - s.startedAt) / 1000);
      },
      setCountdown: (seconds: number): void => {
        const state = this.doc.map<unknown>('presentationState');
        state.set('countdown', { total: seconds, remaining: seconds, paused: false });
      },
      remaining: (): number | null => {
        const s = this.state();
        return s.countdown?.remaining ?? null;
      },
      pause: (): void => {
        const state = this.doc.map<unknown>('presentationState');
        const current = this.state().countdown;
        if (current) state.set('countdown', { ...current, paused: true });
      },
      resume: (): void => {
        const state = this.doc.map<unknown>('presentationState');
        const current = this.state().countdown;
        if (current) state.set('countdown', { ...current, paused: false });
      },
    };
  }

  get pointer() {
    return {
      enable: (): void => {
        const state = this.doc.map<unknown>('presentationState');
        state.set('pointer', { enabled: true, position: null });
      },
      disable: (): void => {
        const state = this.doc.map<unknown>('presentationState');
        state.set('pointer', { enabled: false, position: null });
      },
      move: (x: number, y: number): void => {
        const state = this.doc.map<unknown>('presentationState');
        state.set('pointer', { enabled: true, position: { x, y } });
      },
    };
  }

  subscribe(handler: (state: DashboardPresentationState) => void): () => void {
    const state = this.doc.map<unknown>('presentationState');
    const callback = () => handler(this.state());
    state.observe(callback);
    return () => state.unobserve(callback);
  }
}
