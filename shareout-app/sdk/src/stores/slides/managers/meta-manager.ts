import type { SdkClient } from '../../../core/sdk-client';
import type { CreatePresentationOptions, PresentationMeta } from '../types';

/** Reads and patches presentation-level metadata via REST. */
export class PresentationMetaManager {
  constructor(
    private sdk: SdkClient,
    private presId: string,
    private cached: PresentationMeta | null,
    private observers: Set<(meta: PresentationMeta) => void>,
    private onUpdate: (meta: PresentationMeta) => void,
  ) {}

  get(): PresentationMeta | null {
    return this.cached;
  }

  async set(changes: Partial<CreatePresentationOptions>): Promise<PresentationMeta> {
    const updated = await this.sdk._internalFetch<PresentationMeta>(
      `/slides/${encodeURIComponent(this.presId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(changes),
      },
    );
    this.cached = updated;
    this.onUpdate(updated);
    return updated;
  }

  observe(handler: (meta: PresentationMeta) => void): () => void {
    this.observers.add(handler);
    return () => this.observers.delete(handler);
  }
}
