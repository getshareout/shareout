import type { SdkClient } from '../core/sdk-client';

// Files (asset deliverables) are first-class, workspace-level artifacts you can reference
// across artifacts by their stable `dlv_` id — unlike blobs, which are scoped to one
// artifact. `getUrl` returns the deliverable-keyed content endpoint that resolves to the
// latest version and enforces per-file visibility (private files require an authorized
// viewer; workspace files are embeddable).
export class FilesStore {
  constructor(private sdk: SdkClient) {}

  /** Content URL for a File by its `dlv_` id (latest version). Embeddable for
   *  workspace-visible files; private files serve only to an authorized viewer. */
  getUrl(deliverableId: string): string {
    return `${this.sdk._baseUrl}/v1/files/${encodeURIComponent(deliverableId)}/content`;
  }
}
