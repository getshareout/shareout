import type { Connection } from '../stores/connection';
import type { Dataset } from '../stores/dataset';
import type { RealtimeDoc } from '../stores/realtime-doc';
import type { Table } from '../stores/table-store';

/** Internal API surface used by store modules. */
export interface SdkClient {
  _internalFetch<T>(path: string, options?: RequestInit): Promise<T>;
  _authFetch<T>(path: string, options?: RequestInit): Promise<T>;
  readonly _artifactId: string;
  readonly _baseUrl: string;
  readonly _sessionToken?: string;
  realtime(docId: string): RealtimeDoc;
  table<T extends { id: string } = { id: string }>(name: string): Table<T>;
  connection(name: string): Connection;
  dataset(name: string): Dataset;
}
