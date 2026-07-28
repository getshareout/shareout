import type { SdkClient } from '../../../core/sdk-client';

/** Publishing and visibility controls for a presentation deck. */
export class PresentationPublishManager {
  constructor(
    private sdk: SdkClient,
    private presId: string,
  ) {}

  async getUrl(): Promise<string> {
    const result = await this.sdk._internalFetch<{ publishedUrl: string }>(
      `/slides/${encodeURIComponent(this.presId)}/publish/status`,
    );
    return result.publishedUrl;
  }

  async setVisibility(visibility: 'public' | 'private'): Promise<void> {
    await this.sdk._internalFetch(
      `/slides/${encodeURIComponent(this.presId)}/publish/visibility`,
      {
        method: 'PUT',
        body: JSON.stringify({ visibility }),
      },
    );
  }

  async unpublish(): Promise<void> {
    await this.sdk._internalFetch(
      `/slides/${encodeURIComponent(this.presId)}/publish/unpublish`,
      { method: 'POST' },
    );
  }

  async republish(): Promise<void> {
    await this.sdk._internalFetch(
      `/slides/${encodeURIComponent(this.presId)}/publish/republish`,
      { method: 'POST' },
    );
  }
}
