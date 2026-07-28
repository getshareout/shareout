import type { SdkClient } from '../core/sdk-client';

export interface QueryOptions {
  cache?: boolean;
  ttl?: number;
  params?: Record<string, unknown>;
}

export interface ProxyOptions {
  method?: string;
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  query?: Record<string, string>;
}

export interface ProxyResult<T = unknown> {
  data: T;
  status: number;
  executionTimeMs: number;
}

export interface QueryResult<T> {
  data: T;
  cached: boolean;
  executionTimeMs: number;
  rowCount?: number;
}

export class Connection {
  constructor(private sdk: SdkClient, private name: string) {}

  async query<T = unknown>(
    query: string | Record<string, unknown>,
    options?: QueryOptions
  ): Promise<QueryResult<T>> {
    return this.sdk._internalFetch<QueryResult<T>>(
      `/connections/${encodeURIComponent(this.name)}/query`,
      {
        method: 'POST',
        body: JSON.stringify({ query, options }),
      }
    );
  }

  async fetch<T = unknown>(
    query: string | Record<string, unknown>,
    options?: QueryOptions
  ): Promise<T> {
    const result = await this.query<T>(query, options);
    return result.data;
  }

  /**
   * Extract once → store durably. Runs the query (or accepts pre-fetched `rows`) and
   * materializes the result into a dataset (R2 file), table (D1 rows), or JSON key
   * so the dashboard reads it offline — no live hit to the source on every view.
   *
   *   conn.materialize({ query: 'SELECT ...', to: 'dataset:shipments' })
   *   conn.materialize({ rows, to: 'table:shipments', mode: 'replace' })
   *   conn.materialize({ rows, to: 'json:snapshot' })
   *   conn.materialize({ rows, to: 'json:dashboard.series' }) // path merge under key
   */
  async materialize(params: {
    query?: string | Record<string, unknown>;
    rows?: unknown[];
    to: string; // "dataset:name" | "table:name" | "json:key" | "json:key.path"
    mode?: 'replace' | 'append';
    format?: 'json' | 'csv';
    options?: QueryOptions;
  }): Promise<MaterializeResult> {
    const [type, ...rest] = params.to.split(':');
    const restJoined = rest.join(':');
    if ((type !== 'dataset' && type !== 'table' && type !== 'json') || !restJoined) {
      throw new Error('`to` must be "dataset:name", "table:name", or "json:key" (optional .path)');
    }
    let name = restJoined;
    let path: string | undefined;
    if (type === 'json' && restJoined.includes('.')) {
      const dot = restJoined.indexOf('.');
      name = restJoined.slice(0, dot);
      path = restJoined.slice(dot + 1);
      if (!name || !path) {
        throw new Error('`to` json target must be "json:key" or "json:key.path"');
      }
    }
    return this.sdk._internalFetch<MaterializeResult>(
      `/connections/${encodeURIComponent(this.name)}/materialize`,
      {
        method: 'POST',
        body: JSON.stringify({
          query: params.query,
          rows: params.rows,
          target: { type, name, path },
          mode: params.mode,
          format: params.format,
          options: params.options,
        }),
      }
    );
  }
}

export interface MaterializeResult {
  target: 'dataset' | 'table' | 'json';
  name: string;
  rowCount: number;
  version?: number;
  sizeBytes?: number;
  mode?: 'replace' | 'append';
  path?: string;
}
