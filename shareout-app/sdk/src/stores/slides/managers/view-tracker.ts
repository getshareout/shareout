import type { SdkClient } from '../../../core/sdk-client';

/**
 * Slides B2B P0 — viewer-side analytics capture.
 *
 * The read-only deck viewer drives this: call {@link start} once, then {@link enter}
 * on every slide change. The tracker accumulates per-slide dwell (visibility-aware),
 * heartbeats every ~10s, and flushes a final beat via `sendBeacon` on page hide.
 * No-ops outside a browser so it is safe to construct anywhere.
 */
export class ViewTracker {
  private sessionId: string | null = null;
  private totalSlides = 0;
  private currentIndex = 0;
  private currentSlideId: string | null = null;
  private slideDwell = new Map<number, number>();
  private slideEnteredAt = 0;
  private sessionStart = 0;
  private visible = true;
  private timer: ReturnType<typeof setInterval> | null = null;
  private started = false;
  private onVisibility = (): void => this.handleVisibility();
  private onHide = (): void => { void this.stop(); };

  constructor(
    private sdk: SdkClient,
    private presId: string,
  ) {}

  /**
   * Begin a view session at the current slide. Idempotent.
   * Pass `sessionId` from a tracked-link `access()` grant to attribute the
   * session to a named recipient (viewer email + link id already on the row).
   */
  start(totalSlides: number, startIndex = 0, startSlideId: string | null = null, sessionId: string | null = null): void {
    if (this.started || typeof window === 'undefined') return;
    this.started = true;
    if (sessionId) this.sessionId = sessionId;
    this.totalSlides = totalSlides;
    this.currentIndex = startIndex;
    this.currentSlideId = startSlideId;
    this.sessionStart = Date.now();
    this.slideEnteredAt = Date.now();
    this.visible = typeof document === 'undefined' || document.visibilityState !== 'hidden';

    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('pagehide', this.onHide);
    this.timer = setInterval(() => void this.beat(), 10_000);
    void this.beat();
  }

  /** Record a slide change. Flushes dwell on the slide being left. */
  enter(slideIndex: number, slideId: string | null = null): void {
    if (!this.started) return;
    this.accumulate();
    this.currentIndex = slideIndex;
    this.currentSlideId = slideId;
    this.slideEnteredAt = Date.now();
    void this.beat();
  }

  /** Final flush + teardown. Safe to call more than once. */
  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility);
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', this.onHide);
    this.accumulate();
    this.sendBeaconBeat();
  }

  private handleVisibility(): void {
    const hidden = document.visibilityState === 'hidden';
    if (hidden) {
      this.accumulate();
      this.visible = false;
      this.sendBeaconBeat();
    } else {
      this.visible = true;
      this.slideEnteredAt = Date.now();
    }
  }

  private accumulate(): void {
    if (!this.visible) return;
    const elapsed = Date.now() - this.slideEnteredAt;
    if (elapsed <= 0) return;
    this.slideDwell.set(this.currentIndex, (this.slideDwell.get(this.currentIndex) ?? 0) + elapsed);
    this.slideEnteredAt = Date.now();
  }

  private payload(): Record<string, unknown> {
    this.accumulate();
    return {
      sessionId: this.sessionId,
      slideIndex: this.currentIndex,
      slideId: this.currentSlideId,
      slideDwellMs: this.slideDwell.get(this.currentIndex) ?? 0,
      sessionDurationMs: Date.now() - this.sessionStart,
      totalSlides: this.totalSlides,
      completed: this.totalSlides > 0 && this.currentIndex >= this.totalSlides - 1,
    };
  }

  private beatUrl(): string {
    return `${this.sdk._baseUrl}/v1/data/${this.sdk._artifactId}/slides/${encodeURIComponent(this.presId)}/analytics/beat`;
  }

  private async beat(): Promise<void> {
    try {
      const res = await fetch(this.beatUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        keepalive: true,
        body: JSON.stringify(this.payload()),
      });
      const json = (await res.json()) as { success?: boolean; data?: { sessionId?: string } };
      if (json?.data?.sessionId) this.sessionId = json.data.sessionId;
    } catch {
      // Analytics is best-effort; never disrupt the viewer.
    }
  }

  private sendBeaconBeat(): void {
    try {
      const blob = new Blob([JSON.stringify(this.payload())], { type: 'application/json' });
      if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
        navigator.sendBeacon(this.beatUrl(), blob);
      }
    } catch {
      // ignore
    }
  }
}
