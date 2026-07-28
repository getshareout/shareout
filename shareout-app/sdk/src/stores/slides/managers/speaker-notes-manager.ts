import type { SdkClient } from '../../../core/sdk-client';

/** Per-slide speaker notes stored separately from slide HTML content. */
export class SpeakerNotesManager {
  constructor(
    private sdk: SdkClient,
    private presId: string,
  ) {}

  async get(slideId: string): Promise<string> {
    const result = await this.sdk._internalFetch<{ notes: string }>(
      `/slides/${encodeURIComponent(this.presId)}/slides/${encodeURIComponent(slideId)}/notes`,
    );
    return result.notes;
  }

  async set(slideId: string, content: string): Promise<void> {
    await this.sdk._internalFetch(
      `/slides/${encodeURIComponent(this.presId)}/slides/${encodeURIComponent(slideId)}/notes`,
      {
        method: 'PUT',
        body: JSON.stringify({ content }),
      },
    );
  }
}
