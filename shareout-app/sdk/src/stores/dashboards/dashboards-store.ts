import { ShareOutError } from '../../shareout-error';
import type { SdkClient } from '../../core/sdk-client';
import { Dashboard } from './dashboard';
import { DashboardHelpers } from './helpers';
import type {
  DashboardCreateOptions,
  DashboardCreateResult,
  DashboardInfo,
} from './types';

/**
 * Top-level SDK namespace for dashboards (`sdk.dashboards`).
 * Handles REST CRUD and opens live {@link Dashboard} sessions over realtime.
 */
export class DashboardsStore {
  constructor(private sdk: SdkClient) {}

  async create(options: DashboardCreateOptions): Promise<DashboardCreateResult> {
    return this.sdk._internalFetch<DashboardCreateResult>('/dashboards', {
      method: 'POST',
      body: JSON.stringify(options),
    });
  }

  async open(id: string): Promise<Dashboard> {
    const dashboard = new Dashboard(this.sdk, id, 'edit');
    await dashboard.connect();
    return dashboard;
  }

  async view(id: string): Promise<Dashboard> {
    const dashboard = new Dashboard(this.sdk, id, 'view');
    await dashboard.connect();
    return dashboard;
  }

  async list(): Promise<DashboardInfo[]> {
    const result = await this.sdk._internalFetch<{ dashboards: DashboardInfo[]; count: number }>('/dashboards');
    return result.dashboards;
  }

  async delete(id: string): Promise<boolean> {
    try {
      await this.sdk._internalFetch(`/dashboards/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      return true;
    } catch (e) {
      if (e instanceof ShareOutError && e.code === 'NOT_FOUND') {
        return false;
      }
      throw e;
    }
  }

  get helpers(): DashboardHelpers {
    return new DashboardHelpers();
  }
}
