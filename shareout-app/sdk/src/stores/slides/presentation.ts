import { ShareOutError } from '../../shareout-error';
import type { SdkClient } from '../../core/sdk-client';
import { PresentationMetaManager } from './managers/meta-manager';
import { PresenterManager } from './managers/presenter-manager';
import { PresentationPublishManager } from './managers/publish-manager';
import { SlidesPresenceManager } from './managers/presence-manager';
import { SlidesManager } from './managers/slides-manager';
import { SpeakerNotesManager } from './managers/speaker-notes-manager';
import { UndoManager } from './managers/undo-manager';
import { PresentationVersionsManager } from './managers/versions-manager';
import { ViewTracker } from './managers/view-tracker';
import { LinksManager } from './managers/links-manager';
import type {
  PresentationMeta,
  Slide,
  SlideEvent,
  SlideEventListener,
  SlidesEventType,
  SlidesPresenceState,
  ViewAnalytics,
} from './types';

/**
 * A live presentation session backed by REST and a slides WebSocket channel.
 * Returned by {@link SlidesStore.open} (edit) or {@link SlidesStore.view} (read-only).
 *
 * Sub-managers are exposed as getters — each owns a slice of deck functionality:
 * meta, slides, speakerNotes, presenter, versions, publish, undo, presence.
 */
export class Presentation {
  private connected = false;
  private ws: WebSocket | null = null;
  private listeners: Set<SlideEventListener> = new Set();
  private eventListeners: Map<SlidesEventType, Set<(...args: unknown[]) => void>> = new Map();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private _data: { meta: PresentationMeta; slides: Slide[] } | null = null;
  private _metaObservers: Set<(meta: PresentationMeta) => void> = new Set();
  private _slidesObservers: Set<(slides: Slide[]) => void> = new Set();
  private _presenceState: Map<string, SlidesPresenceState> = new Map();
  private _presenceObservers: Set<(users: Map<string, SlidesPresenceState>) => void> = new Set();
  private _undoStack: Slide[][] = [];
  private _redoStack: Slide[][] = [];
  private _inTransaction = false;
  private _tracker: ViewTracker | null = null;

  constructor(
    private sdk: SdkClient,
    private id: string,
    private accessMode: 'edit' | 'view',
    private autoTrack = true,
  ) {}

  async connect(): Promise<void> {
    if (this.connected) return;

    const data = await this.sdk._internalFetch<{ slides: Slide[] } & PresentationMeta>(
      `/slides/${encodeURIComponent(this.id)}`,
    );

    const { slides, ...meta } = data;
    this._data = { meta, slides };
    this.connected = true;
    this._undoStack = [];
    this._redoStack = [];

    if (this.accessMode === 'edit') {
      this.ensureWebSocket();
    } else if (this.autoTrack) {
      // Read-only viewer: capture engagement automatically so every deck flows
      // analytics with zero template changes. Per-slide dwell still needs the
      // template to call trackSlide() on navigation.
      await this.startTracking().catch(() => {});
    }
  }

  /**
   * Begin view-analytics capture. Called automatically by `slides.view()` unless
   * disabled with `{ track: false }`. If the URL carries a tracked link (`?l=`)
   * with an open gate, the session is auto-attributed; challenge gates
   * (email/password) must run `links.access()` in your UI, then pass the
   * resulting sessionId here.
   */
  async startTracking(sessionId: string | null = null): Promise<void> {
    if (typeof window === 'undefined' || !this._data) return;

    if (!sessionId) {
      try {
        const lnk = new URL(window.location.href).searchParams.get('l');
        if (lnk) {
          const gate = await this.links.gate(lnk);
          if (!gate.revoked && !gate.expired && gate.gate === 'none') {
            sessionId = (await this.links.access(lnk)).sessionId;
          }
        }
      } catch {
        // No tracked link / gate failed — fall back to anonymous capture.
      }
    }

    const slides = this._data.slides;
    this.tracker.start(slides.length, 0, slides[0]?.id ?? null, sessionId);
  }

  /** Record a slide change during viewing (per-slide dwell + drop-off). */
  trackSlide(index: number): void {
    const slideId = this._data?.slides?.[index]?.id ?? null;
    this.tracker.enter(index, slideId);
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 10;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.listeners.clear();
    this.eventListeners.clear();
    this._metaObservers.clear();
    this._slidesObservers.clear();
    this._presenceObservers.clear();
    this.connected = false;
  }

  destroy(): void {
    this.disconnect();
    if (this._tracker) { void this._tracker.stop(); this._tracker = null; }
    this._data = null;
    this._undoStack = [];
    this._redoStack = [];
    this._presenceState.clear();
  }

  get meta(): PresentationMetaManager {
    return new PresentationMetaManager(
      this.sdk,
      this.id,
      this._data?.meta || null,
      this._metaObservers,
      (meta) => {
        if (this._data) this._data.meta = meta;
        this._metaObservers.forEach((fn) => fn(meta));
      },
    );
  }

  get slides(): SlidesManager {
    return new SlidesManager(
      this.sdk,
      this.id,
      this._data?.slides || [],
      this._slidesObservers,
      (slides) => {
        if (!this._inTransaction) this.saveUndoState();
        if (this._data) this._data.slides = slides;
        this._slidesObservers.forEach((fn) => fn(slides));
      },
    );
  }

  get speakerNotes(): SpeakerNotesManager {
    return new SpeakerNotesManager(this.sdk, this.id);
  }

  get presenter(): PresenterManager {
    return new PresenterManager(this.sdk, this.id, this._data?.slides?.length || 0);
  }

  get versions(): PresentationVersionsManager {
    return new PresentationVersionsManager(this.sdk, this.id);
  }

  /** URL that renders this deck (pdf) or a slide (png) via server-side browser rendering. */
  exportUrl(format: 'pdf' | 'png' = 'pdf', slideId?: string): string {
    const q = new URLSearchParams({ format });
    if (slideId) q.set('slide', slideId);
    return `${this.sdk._baseUrl}/v1/data/${this.sdk._artifactId}/slides/${encodeURIComponent(this.id)}/export?${q.toString()}`;
  }

  /** Fetch the deck as a PDF Blob, or a single slide as a PNG Blob. */
  async export(format: 'pdf' | 'png' = 'pdf', slideId?: string): Promise<Blob> {
    const res = await fetch(this.exportUrl(format, slideId), { credentials: 'include' });
    if (!res.ok) {
      throw new ShareOutError(`Export failed: ${res.status}`, 'EXPORT_FAILED', res.status);
    }
    return res.blob();
  }

  get publish(): PresentationPublishManager {
    return new PresentationPublishManager(this.sdk, this.id);
  }

  get undo(): UndoManager {
    return new UndoManager(this._undoStack, this._redoStack, () => {
      if (this._data) {
        this._slidesObservers.forEach((fn) => fn(this._data!.slides));
      }
    });
  }

  get presence(): SlidesPresenceManager {
    return new SlidesPresenceManager(this._presenceState, this._presenceObservers, this.ws);
  }

  /**
   * Viewer-analytics capture (Slides B2B P0). Drive from a read-only viewer:
   * `tracker.start(totalSlides)` once, then `tracker.enter(index, slideId)` per
   * slide change. Heartbeats + dwell + completion are handled internally. No-op
   * outside a browser. One tracker per Presentation instance.
   */
  get tracker(): ViewTracker {
    if (!this._tracker) this._tracker = new ViewTracker(this.sdk, this.id);
    return this._tracker;
  }

  /** Tracked & gated share links (Slides B2B P1) — owner CRUD + public gate/access. */
  get links(): LinksManager {
    return new LinksManager(this.sdk, this.id);
  }

  /** Owner-only engagement readout: summary, per-slide drop-off, recent sessions. */
  async analytics(): Promise<ViewAnalytics> {
    return this.sdk._internalFetch<ViewAnalytics>(
      `/slides/${encodeURIComponent(this.id)}/analytics`,
    );
  }

  /** Batch slide mutations into a single undo checkpoint. */
  transact(fn: () => void): void {
    this.saveUndoState();
    this._inTransaction = true;
    try {
      fn();
    } finally {
      this._inTransaction = false;
    }
  }

  on(event: SlidesEventType, handler: (...args: unknown[]) => void): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(handler);
  }

  off(event: SlidesEventType, handler: (...args: unknown[]) => void): void {
    this.eventListeners.get(event)?.delete(handler);
  }

  private emit(event: SlidesEventType, ...args: unknown[]): void {
    this.eventListeners.get(event)?.forEach((fn) => fn(...args));
  }

  private saveUndoState(): void {
    if (this._data) {
      this._undoStack.push(JSON.parse(JSON.stringify(this._data.slides)));
      if (this._undoStack.length > 50) this._undoStack.shift();
      this._redoStack = [];
    }
  }

  subscribe(handler: SlideEventListener): () => void {
    this.listeners.add(handler);
    this.ensureWebSocket();
    return () => {
      this.listeners.delete(handler);
      this.maybeDisconnectWs();
    };
  }

  private ensureWebSocket(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    if (this.ws && this.ws.readyState === WebSocket.CONNECTING) return;

    const wsUrl = this.sdk._baseUrl
      .replace('https://', 'wss://')
      .replace('http://', 'ws://');

    const url = `${wsUrl}/v1/data/${this.sdk._artifactId}/slides/ws`;

    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.emit('status', 'connected');
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as SlideEvent | { type: string; users?: Record<string, SlidesPresenceState> };
        if (data.type === 'connected' || data.type === 'pong') return;

        if (data.type === 'presence' && 'users' in data) {
          this._presenceState.clear();
          for (const [userId, state] of Object.entries(data.users || {})) {
            this._presenceState.set(userId, state);
          }
          this._presenceObservers.forEach((fn) => fn(this._presenceState));
          return;
        }

        const slideEvent = data as SlideEvent;
        this.notifyListeners(slideEvent);
        this.emit(slideEvent.type as SlidesEventType, slideEvent.data);

        if (
          slideEvent.type === 'slide:added'
          || slideEvent.type === 'slide:updated'
          || slideEvent.type === 'slide:deleted'
          || slideEvent.type === 'slide:reordered'
        ) {
          this.slides.refresh().then((slides) => {
            this._slidesObservers.forEach((fn) => fn(slides));
          });
        }
      } catch {
        // Ignore malformed WebSocket payloads.
      }
    };

    this.ws.onclose = () => {
      this.ws = null;
      this.emit('status', 'disconnected');
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {};
  }

  private notifyListeners(event: SlideEvent): void {
    this.listeners.forEach((fn) => fn(event));
  }

  private maybeDisconnectWs(): void {
    if (this.listeners.size === 0 && this.ws) {
      this.ws.close();
      this.ws = null;
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    if (this.listeners.size === 0) return;
    if (this.reconnectAttempts >= 10) return;

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), 30000);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ensureWebSocket();
    }, delay);
  }
}
