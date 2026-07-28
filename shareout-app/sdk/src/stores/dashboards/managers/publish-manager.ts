import type { SdkClient } from '../../../core/sdk-client';

/** Publishing controls: public URL and visibility via the REST API. */
export class PublishManager {
  constructor(private sdk: SdkClient, private dashboardId: string) {}

  getUrl(): string {
    return `${this.sdk._baseUrl}/p/${this.dashboardId}`;
  }

  async setVisibility(visibility: 'public' | 'private'): Promise<void> {
    await this.sdk._internalFetch(
      `/dashboards/${encodeURIComponent(this.dashboardId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ visibility }),
      },
    );
  }

  async unpublish(): Promise<void> {
    await this.setVisibility('private');
  }

  async republish(): Promise<void> {
    await this.setVisibility('public');
  }
}
