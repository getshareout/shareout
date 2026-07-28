import type { SdkClient } from '../../../core/sdk-client';
import type { PresentationState } from '../types';
import { PresenterLaser } from './presenter-laser';
import { PresenterTimer } from './presenter-timer';

/**
 * Live presentation mode: start/stop, slide navigation, timer, and laser pointer.
 * State is fetched from the presenter REST endpoints and pushed to subscribers.
 */
export class PresenterManager {
  private _state: PresentationState | null = null;
  private _subscribers: Set<(state: PresentationState) => void> = new Set();
  private _currentUserId: string | null = null;

  constructor(
    private sdk: SdkClient,
    private presId: string,
    private totalSlides: number,
  ) {}

  async start(options?: {
    fromSlide?: number;
    countdown?: number;
    autoAdvance?: boolean;
    autoAdvanceInterval?: number;
  }): Promise<void> {
    const result = await this.sdk._internalFetch<{ started: boolean; startedAt: string; userId?: string }>(
      `/slides/${encodeURIComponent(this.presId)}/presenter/start`,
      {
        method: 'POST',
        body: JSON.stringify(options || {}),
      },
    );
    this._currentUserId = result.userId || null;
    await this.refreshState();
  }

  async stop(): Promise<void> {
    await this.sdk._internalFetch(
      `/slides/${encodeURIComponent(this.presId)}/presenter/stop`,
      { method: 'POST' },
    );
    this._state = null;
    this._currentUserId = null;
  }

  async navigate(slideIndex: number): Promise<void> {
    await this.sdk._internalFetch(
      `/slides/${encodeURIComponent(this.presId)}/presenter/navigate`,
      {
        method: 'POST',
        body: JSON.stringify({ slideIndex }),
      },
    );
    if (this._state) {
      this._state.currentSlideIndex = slideIndex;
      this._state.slideStartedAt = new Date().toISOString();
      this.notifySubscribers();
    }
  }

  state(): PresentationState {
    return this._state || {
      isPresenting: false,
      presenterId: null,
      presenterName: null,
      currentSlideIndex: 0,
      totalSlides: this.totalSlides,
      startedAt: null,
      slideStartedAt: null,
      countdown: null,
      laser: { enabled: false, position: null },
    };
  }

  async refreshState(): Promise<PresentationState> {
    this._state = await this.sdk._internalFetch<PresentationState>(
      `/slides/${encodeURIComponent(this.presId)}/presenter/state`,
    );
    this.notifySubscribers();
    return this._state;
  }

  isActive(): boolean {
    return this._state?.isPresenting || false;
  }

  isPresenter(): boolean {
    return this._state?.presenterId === this._currentUserId && this._currentUserId !== null;
  }

  next(): void {
    const state = this.state();
    if (state.currentSlideIndex < state.totalSlides - 1) {
      this.navigate(state.currentSlideIndex + 1);
    }
  }

  previous(): void {
    const state = this.state();
    if (state.currentSlideIndex > 0) {
      this.navigate(state.currentSlideIndex - 1);
    }
  }

  goToSlide(index: number): void {
    this.navigate(index);
  }

  first(): void {
    this.navigate(0);
  }

  last(): void {
    this.navigate(this.totalSlides - 1);
  }

  subscribe(handler: (state: PresentationState) => void): () => void {
    this._subscribers.add(handler);
    return () => this._subscribers.delete(handler);
  }

  private notifySubscribers(): void {
    const state = this.state();
    this._subscribers.forEach((fn) => fn(state));
  }

  get timer(): PresenterTimer {
    return new PresenterTimer(
      this.sdk,
      this.presId,
      () => this._state,
      (s) => {
        this._state = s;
        this.notifySubscribers();
      },
    );
  }

  get laser(): PresenterLaser {
    return new PresenterLaser(
      this.sdk,
      this.presId,
      () => this._state,
      (s) => {
        this._state = s;
        this.notifySubscribers();
      },
    );
  }
}
