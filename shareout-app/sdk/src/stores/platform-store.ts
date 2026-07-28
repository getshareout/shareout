import type { SdkClient } from '../core/sdk-client';

/** Listed platform connection (owner-only list; secrets never returned). */
export interface PlatformConnectionInfo {
  id: string;
  name: string;
  provider: string;
  preferredMode?: string;
  config?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export interface PlatformProviderConfig {
  id: string;
  name: string;
  version?: string;
  [key: string]: unknown;
}

export interface PlatformEndpointInfo {
  id: string;
  method?: string;
  path?: string;
  description?: string;
  [key: string]: unknown;
}

/** Body for POST …/platform/{provider}/{endpoint}/execute */
export interface PlatformExecuteOptions {
  connectionId: string;
  params?: {
    pathParams?: Record<string, string>;
    queryParams?: Record<string, string | number | boolean | undefined>;
    body?: Record<string, unknown>;
    headers?: Record<string, string>;
  };
  proxyToken?: string;
}

/**
 * Result of a platform execute. Shape mirrors PlatformEngine.execute envelope
 * (provider payload usually under `.data`; check `.success` / `.error` when present).
 */
export interface PlatformExecuteResult<T = unknown> {
  success?: boolean;
  data?: T;
  error?: { message?: string; code?: string; httpStatus?: number };
  cached?: boolean;
  pagination?: { hasMore?: boolean; cursor?: string | null };
  [key: string]: unknown;
}

/**
 * One registered provider (bigquery, snowflake, google-sheets, …).
 * Prefer this over raw `_internalFetch('/platform/…')`.
 */
export class PlatformProvider {
  constructor(
    private sdk: SdkClient,
    readonly id: string,
  ) {}

  /** Provider config + endpoint catalog. */
  async info(): Promise<{ config: PlatformProviderConfig; endpoints: PlatformEndpointInfo[] }> {
    return this.sdk._internalFetch(`/platform/${encodeURIComponent(this.id)}`);
  }

  /**
   * Execute a provider endpoint.
   *
   * @example
   * ```ts
   * const result = await sdk.platform.provider('bigquery').execute('jobs.query', {
   *   connectionId: bq.id,
   *   params: {
   *     pathParams: { projectId: 'my-gcp-project' },
   *     body: { query: 'SELECT 1', useLegacySql: false, maxResults: 1000 },
   *   },
   * });
   * ```
   */
  async execute<T = unknown>(
    endpointId: string,
    options: PlatformExecuteOptions,
  ): Promise<PlatformExecuteResult<T>> {
    if (!options?.connectionId && !options?.proxyToken) {
      throw new Error('platform.execute requires connectionId (or proxyToken)');
    }
    const path =
      `/platform/${encodeURIComponent(this.id)}/${endpointId.split('/').map(encodeURIComponent).join('/')}/execute`;
    return this.sdk._internalFetch<PlatformExecuteResult<T>>(path, {
      method: 'POST',
      body: JSON.stringify({
        connectionId: options.connectionId,
        proxyToken: options.proxyToken,
        params: options.params,
      }),
    });
  }

  /** Mint short-lived credentials for browser-direct mode when the provider supports it. */
  async prepare(options: { connectionId: string; endpoint: string }): Promise<unknown> {
    return this.sdk._internalFetch(`/platform/${encodeURIComponent(this.id)}/prepare`, {
      method: 'POST',
      body: JSON.stringify(options),
    });
  }
}

/**
 * Platform data plane — OAuth/warehouse providers (BigQuery, Snowflake, GA, Shopify, …).
 *
 * Replaces ad-hoc `sdk._internalFetch('/platform/…')` with a stable public surface.
 */
export class PlatformStore {
  constructor(private sdk: SdkClient) {}

  /** Registry of providers available on this instance. */
  async providers(): Promise<PlatformProviderConfig[]> {
    const result = await this.sdk._internalFetch<{ providers: PlatformProviderConfig[] }>(
      '/platform/providers',
    );
    return result.providers ?? [];
  }

  /**
   * Artifact platform connections (owner-only).
   * Use `connectionId` from here when calling `provider(id).execute(…)`.
   */
  async connections(): Promise<PlatformConnectionInfo[]> {
    const result = await this.sdk._internalFetch<{ connections: PlatformConnectionInfo[] }>(
      '/platform/connections',
    );
    return result.connections ?? [];
  }

  /** Look up a connection by display name (owner-only). */
  async connectionByName(name: string): Promise<PlatformConnectionInfo | null> {
    const list = await this.connections();
    return list.find((c) => c.name === name) ?? null;
  }

  /** Handle for one provider id (`bigquery`, `snowflake`, `google-analytics`, …). */
  provider(providerId: string): PlatformProvider {
    if (!providerId || typeof providerId !== 'string') {
      throw new Error('platform.provider(id) requires a non-empty provider id');
    }
    return new PlatformProvider(this.sdk, providerId);
  }

  /**
   * Shortcut: `sdk.platform.execute('bigquery', 'jobs.query', opts)`
   * ≡ `sdk.platform.provider('bigquery').execute('jobs.query', opts)`.
   */
  execute<T = unknown>(
    providerId: string,
    endpointId: string,
    options: PlatformExecuteOptions,
  ): Promise<PlatformExecuteResult<T>> {
    return this.provider(providerId).execute<T>(endpointId, options);
  }
}
