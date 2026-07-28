import type { SdkClient } from '../core/sdk-client';
import { Table } from './table-store';

export type SharedAccess = 'read' | 'readwrite';

export interface SharedTableInfo {
  sharedName: string;
  access: SharedAccess;
  ownerArtifactId: string;
  sourceTable: string;
  ownedByCaller: boolean;
}

// Workspace-shared data. A table stays owned by, and stored in, the artifact that
// created it; the owner opts into sharing it with the workspace (read or read/write).
// Any artifact in the same workspace then reaches it by its shared name.
export class WorkspaceStore {
  constructor(private sdk: SdkClient) {}

  // Read/write a table another artifact shared into this workspace. Same API as
  // sdk.table(), resolved server-side to the owning artifact's store.
  table<T extends { id: string } = { id: string }>(sharedName: string): Table<T> {
    return new Table<T>(this.sdk, sharedName, '/workspace/tables');
  }

  // Owner action: expose one of THIS artifact's tables to the workspace.
  // `as` defaults to the table name; must be unique within the workspace.
  async shareTable(
    table: string,
    opts: { as?: string; access?: SharedAccess } = {}
  ): Promise<{ sharedName: string; table: string; access: SharedAccess }> {
    return this.sdk._internalFetch('/workspace/_share', {
      method: 'POST',
      body: JSON.stringify({ table, as: opts.as, access: opts.access ?? 'read' }),
    });
  }

  // Owner action: stop sharing a table this artifact published.
  async unshareTable(sharedName: string): Promise<{ unshared: boolean; sharedName: string }> {
    return this.sdk._internalFetch(`/workspace/_share/${encodeURIComponent(sharedName)}`, {
      method: 'DELETE',
    });
  }

  // List every shared table visible in this workspace (with ownedByCaller flag).
  async listShares(): Promise<SharedTableInfo[]> {
    const result = await this.sdk._internalFetch<{ shares: SharedTableInfo[] }>('/workspace/_shares');
    return result.shares;
  }
}
