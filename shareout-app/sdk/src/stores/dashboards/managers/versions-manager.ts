import type { SdkClient } from '../../../core/sdk-client';
import type { DashboardVersion } from '../types';

/** Server-backed dashboard version snapshots (list, create, restore, diff). */
export class VersionsManager {
  constructor(private sdk: SdkClient, private dashboardId: string) {}

  async list(): Promise<DashboardVersion[]> {
    const result = await this.sdk._internalFetch<{ versions: DashboardVersion[] }>(
      `/dashboards/${encodeURIComponent(this.dashboardId)}/versions`,
    );
    return result.versions;
  }

  async create(name: string, description?: string): Promise<DashboardVersion> {
    return this.sdk._internalFetch<DashboardVersion>(
      `/dashboards/${encodeURIComponent(this.dashboardId)}/versions`,
      {
        method: 'POST',
        body: JSON.stringify({ name, description }),
      },
    );
  }

  async restore(versionId: string): Promise<void> {
    await this.sdk._internalFetch(
      `/dashboards/${encodeURIComponent(this.dashboardId)}/versions/${encodeURIComponent(versionId)}/restore`,
      { method: 'POST' },
    );
  }

  async diff(fromId: string, toId: string): Promise<unknown> {
    return this.sdk._internalFetch(
      `/dashboards/${encodeURIComponent(this.dashboardId)}/versions/diff?from=${encodeURIComponent(fromId)}&to=${encodeURIComponent(toId)}`,
    );
  }
}
