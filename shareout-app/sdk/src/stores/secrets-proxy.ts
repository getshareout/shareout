import type { SdkClient } from '../core/sdk-client';
import type { ProxyOptions, ProxyResult } from './connection';

export class SecretsProxy {
  constructor(private sdk: SdkClient) {}

  async proxy<T = unknown>(
    secretName: string,
    options: ProxyOptions
  ): Promise<ProxyResult<T>> {
    return this.sdk._internalFetch<ProxyResult<T>>(
      `/secrets/${encodeURIComponent(secretName)}/proxy`,
      {
        method: 'POST',
        body: JSON.stringify(options),
      }
    );
  }

  async get<T = unknown>(
    secretName: string,
    path: string,
    query?: Record<string, string>
  ): Promise<T> {
    const result = await this.proxy<T>(secretName, { method: 'GET', path, query });
    return result.data;
  }

  async post<T = unknown>(
    secretName: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>
  ): Promise<T> {
    const result = await this.proxy<T>(secretName, { method: 'POST', path, body, headers });
    return result.data;
  }

  async put<T = unknown>(
    secretName: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const result = await this.proxy<T>(secretName, { method: 'PUT', path, body });
    return result.data;
  }

  async delete<T = unknown>(
    secretName: string,
    path: string
  ): Promise<T> {
    const result = await this.proxy<T>(secretName, { method: 'DELETE', path });
    return result.data;
  }
}
