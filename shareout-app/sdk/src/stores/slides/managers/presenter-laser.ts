import type { SdkClient } from '../../../core/sdk-client';
import type { PresentationState } from '../types';

/** Laser pointer overlay during live presentation mode. */
export class PresenterLaser {
  constructor(
    private sdk: SdkClient,
    private presId: string,
    private getState: () => PresentationState | null,
    private updateState: (state: PresentationState) => void,
  ) {}

  async enable(): Promise<void> {
    await this.sdk._internalFetch(
      `/slides/${encodeURIComponent(this.presId)}/presenter/laser`,
      {
        method: 'POST',
        body: JSON.stringify({ enabled: true }),
      },
    );
    const state = this.getState();
    if (state) {
      state.laser = { enabled: true, position: null };
      this.updateState(state);
    }
  }

  async disable(): Promise<void> {
    await this.sdk._internalFetch(
      `/slides/${encodeURIComponent(this.presId)}/presenter/laser`,
      {
        method: 'POST',
        body: JSON.stringify({ enabled: false }),
      },
    );
    const state = this.getState();
    if (state) {
      state.laser = { enabled: false, position: null };
      this.updateState(state);
    }
  }

  async move(x: number, y: number): Promise<void> {
    await this.sdk._internalFetch(
      `/slides/${encodeURIComponent(this.presId)}/presenter/laser`,
      {
        method: 'POST',
        body: JSON.stringify({ enabled: true, x, y }),
      },
    );
    const state = this.getState();
    if (state) {
      state.laser = { enabled: true, position: { x, y } };
      this.updateState(state);
    }
  }

  isEnabled(): boolean {
    return this.getState()?.laser?.enabled || false;
  }
}
