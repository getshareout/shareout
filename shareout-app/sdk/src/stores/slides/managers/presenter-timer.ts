import type { SdkClient } from '../../../core/sdk-client';
import type { PresentationState } from '../types';

/** Countdown timer controls during live presentation mode. */
export class PresenterTimer {
  constructor(
    private sdk: SdkClient,
    private presId: string,
    private getState: () => PresentationState | null,
    private updateState: (state: PresentationState) => void,
  ) {}

  elapsed(): number {
    const state = this.getState();
    if (!state?.startedAt) return 0;
    return Math.floor((Date.now() - new Date(state.startedAt).getTime()) / 1000);
  }

  slideElapsed(): number {
    const state = this.getState();
    if (!state?.slideStartedAt) return 0;
    return Math.floor((Date.now() - new Date(state.slideStartedAt).getTime()) / 1000);
  }

  async setCountdown(seconds: number): Promise<void> {
    await this.sdk._internalFetch(
      `/slides/${encodeURIComponent(this.presId)}/presenter/timer`,
      {
        method: 'POST',
        body: JSON.stringify({ action: 'setCountdown', seconds }),
      },
    );
    const state = this.getState();
    if (state) {
      state.countdown = { total: seconds, remaining: seconds, paused: false };
      this.updateState(state);
    }
  }

  remaining(): number | null {
    const state = this.getState();
    return state?.countdown?.remaining ?? null;
  }

  async pause(): Promise<void> {
    await this.sdk._internalFetch(
      `/slides/${encodeURIComponent(this.presId)}/presenter/timer`,
      {
        method: 'POST',
        body: JSON.stringify({ action: 'pause' }),
      },
    );
    const state = this.getState();
    if (state?.countdown) {
      state.countdown.paused = true;
      this.updateState(state);
    }
  }

  async resume(): Promise<void> {
    await this.sdk._internalFetch(
      `/slides/${encodeURIComponent(this.presId)}/presenter/timer`,
      {
        method: 'POST',
        body: JSON.stringify({ action: 'resume' }),
      },
    );
    const state = this.getState();
    if (state?.countdown) {
      state.countdown.paused = false;
      this.updateState(state);
    }
  }

  async reset(): Promise<void> {
    await this.sdk._internalFetch(
      `/slides/${encodeURIComponent(this.presId)}/presenter/timer`,
      {
        method: 'POST',
        body: JSON.stringify({ action: 'reset' }),
      },
    );
    const state = this.getState();
    if (state?.countdown) {
      state.countdown.remaining = state.countdown.total;
      state.countdown.paused = false;
      this.updateState(state);
    }
  }
}
