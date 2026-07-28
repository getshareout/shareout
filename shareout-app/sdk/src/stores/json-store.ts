import { ShareOutError } from '../shareout-error';
import type { SdkClient } from '../core/sdk-client';

export interface JsonEntry<T = unknown> {
  key: string;
  value: T;
  updatedAt: string;
}

export interface JsonSetResult {
  key: string;
  created: boolean;
  updatedAt: string;
}

export interface JsonSetOptions {
  /**
   * Compare-and-swap: only write if the stored `updatedAt` equals this value.
   * Send the `updatedAt` from a prior `getEntry()` / `get()`.
   */
  ifMatch?: string;
  /**
   * Only create if the key does not exist (HTTP If-None-Match: *).
   * Used by `update()` for the first write so two creators cannot both "win" silently.
   */
  ifNoneMatch?: '*';
}

export interface JsonUpdateOptions {
  /** CAS retries on VERSION_CONFLICT (default 8). */
  retries?: number;
}

export class JsonStore {
  constructor(private sdk: SdkClient) {}

  /** Value only — null when the key is missing. */
  async get<T = unknown>(key: string): Promise<T | null> {
    const entry = await this.getEntry<T>(key);
    return entry ? entry.value : null;
  }

  /** Value + version token for compare-and-swap writes. */
  async getEntry<T = unknown>(key: string): Promise<JsonEntry<T> | null> {
    try {
      const result = await this.sdk._internalFetch<{ key: string; value: T; updatedAt: string }>(
        `/json/${encodeURIComponent(key)}`,
      );
      return { key: result.key, value: result.value, updatedAt: result.updatedAt };
    } catch (e) {
      if (e instanceof ShareOutError && e.code === 'KEY_NOT_FOUND') {
        return null;
      }
      throw e;
    }
  }

  /**
   * Write a value. Pass `ifMatch` / `ifNoneMatch` for atomic updates
   * (see `update()`).
   */
  async set<T = unknown>(
    key: string,
    value: T,
    options?: JsonSetOptions,
  ): Promise<JsonSetResult> {
    const headers: Record<string, string> = {};
    if (options?.ifMatch) headers['If-Match'] = options.ifMatch;
    if (options?.ifNoneMatch === '*') headers['If-None-Match'] = '*';

    return this.sdk._internalFetch<JsonSetResult>(`/json/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(value),
    });
  }

  async delete(key: string): Promise<boolean> {
    try {
      await this.sdk._internalFetch(`/json/${encodeURIComponent(key)}`, {
        method: 'DELETE',
      });
      return true;
    } catch (e) {
      if (e instanceof ShareOutError && e.code === 'KEY_NOT_FOUND') {
        return false;
      }
      throw e;
    }
  }

  async list(): Promise<string[]> {
    const result = await this.sdk._internalFetch<{ keys: string[]; count: number }>('/json');
    return result.keys;
  }

  /**
   * Read-modify-write with compare-and-swap. Retries on concurrent writers
   * so counters and small state stay correct under parallel viewers/editors.
   *
   * @example
   * ```ts
   * const n = await sdk.json.update('counter', (prev) => (prev ?? 0) + 1);
   * ```
   */
  async update<T = unknown>(
    key: string,
    fn: (prev: T | null) => T,
    options?: JsonUpdateOptions,
  ): Promise<T> {
    const retries = options?.retries ?? 8;
    let lastErr: unknown;

    for (let attempt = 0; attempt < retries; attempt++) {
      const entry = await this.getEntry<T>(key);
      const next = fn(entry ? entry.value : null);
      try {
        if (entry) {
          await this.set(key, next, { ifMatch: entry.updatedAt });
        } else {
          await this.set(key, next, { ifNoneMatch: '*' });
        }
        return next;
      } catch (e) {
        lastErr = e;
        if (
          e instanceof ShareOutError
          && (e.code === 'VERSION_CONFLICT' || e.status === 409)
          && attempt < retries - 1
        ) {
          continue;
        }
        throw e;
      }
    }

    throw lastErr instanceof Error
      ? lastErr
      : new ShareOutError('JSON update failed after retries', 'VERSION_CONFLICT', 409);
  }

  async exists(key: string): Promise<boolean> {
    const url = `${this.sdk._baseUrl}/v1/data/${this.sdk._artifactId}/json/${encodeURIComponent(key)}`;
    // Cookies don't reach the cross-origin CDN iframe; carry the viewer session
    // token or every private artifact reports false.
    const headers: Record<string, string> = {};
    if (this.sdk._sessionToken) headers['Authorization'] = `Bearer ${this.sdk._sessionToken}`;
    const response = await fetch(url, {
      method: 'HEAD',
      credentials: 'include',
      headers,
    });
    if (response.ok) return true;
    // Only a real 404 means "absent". A 401/403/5xx must NOT read as false — that
    // would let a caller treat auth-denied or a server error as "key doesn't exist"
    // and overwrite live data. Surface it instead.
    if (response.status === 404) return false;
    throw new ShareOutError(
      `Could not check if "${key}" exists (HTTP ${response.status})`,
      response.status === 401 || response.status === 403 ? 'FORBIDDEN' : 'HTTP_ERROR',
      response.status,
    );
  }

  async clear(): Promise<void> {
    await this.sdk._internalFetch('/json', { method: 'DELETE' });
  }
}
