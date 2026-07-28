import { ShareOutError } from '../shareout-error';
import type { SdkClient } from '../core/sdk-client';

interface SheetConnection {
  name: string;
  spreadsheetId: string;
  sheetName?: string;
  targetTable: string;
  syncDirection: 'import' | 'export' | 'bidirectional';
  syncSchedule?: string;
  lastSyncedAt?: string;
  rowCount: number;
  createdAt: string;
}

interface SheetsStatus {
  connected: boolean;
  userId?: string;
  reason?: string;
}

interface ImportResult {
  imported: number;
  targetTable: string;
  columns: string[];
}

interface ExportResult {
  exported: number;
  spreadsheetId: string;
  columns: string[];
}

export class SheetsStore {
  constructor(private sdk: SdkClient) {}

  async status(): Promise<SheetsStatus> {
    return this.sdk._internalFetch<SheetsStatus>('/sheets/status');
  }

  getConnectUrl(returnUrl?: string): string {
    const params = returnUrl ? `?return=${encodeURIComponent(returnUrl)}` : '';
    return `${this.sdk._baseUrl}/v1/data/${this.sdk._artifactId}/sheets/connect${params}`;
  }

  connect(returnUrl?: string): void {
    if (typeof window !== 'undefined') {
      window.location.href = this.getConnectUrl(returnUrl);
    }
  }

  async disconnect(): Promise<void> {
    await this.sdk._internalFetch('/sheets/disconnect', { method: 'POST' });
  }

  async list(): Promise<SheetConnection[]> {
    const result = await this.sdk._internalFetch<{
      connections: SheetConnection[];
      count: number;
    }>('/sheets');
    return result.connections;
  }

  async get(name: string): Promise<SheetConnection | null> {
    try {
      return await this.sdk._internalFetch<SheetConnection>(
        `/sheets/${encodeURIComponent(name)}`
      );
    } catch (e) {
      if (e instanceof ShareOutError && e.code === 'NOT_FOUND') {
        return null;
      }
      throw e;
    }
  }

  async create(options: {
    name: string;
    spreadsheetId: string;
    sheetName?: string;
    targetTable: string;
    syncDirection?: 'import' | 'export' | 'bidirectional';
    syncSchedule?: string;
  }): Promise<SheetConnection> {
    return this.sdk._internalFetch<SheetConnection>('/sheets', {
      method: 'POST',
      body: JSON.stringify(options),
    });
  }

  async delete(name: string): Promise<boolean> {
    try {
      await this.sdk._internalFetch(`/sheets/${encodeURIComponent(name)}`, {
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

  async import(connectionName: string): Promise<ImportResult> {
    return this.sdk._internalFetch<ImportResult>(
      `/sheets/import/${encodeURIComponent(connectionName)}`,
      { method: 'POST' }
    );
  }

  async export(connectionName: string): Promise<ExportResult> {
    return this.sdk._internalFetch<ExportResult>(
      `/sheets/export/${encodeURIComponent(connectionName)}`,
      { method: 'POST' }
    );
  }

  // === Simplified OAuth Flow ===
  // These methods work without requiring ShareOut login first

  /**
   * Get the OAuth URL to authorize Google Sheets access for this artifact.
   * Open this URL in a browser/popup for the user to complete authorization.
   * @param returnUrl - Optional URL to redirect after OAuth completes
   */
  async getAuthUrl(returnUrl?: string): Promise<{ authUrl: string; message: string }> {
    const params = returnUrl ? `?return=${encodeURIComponent(returnUrl)}` : '';
    return this.sdk._internalFetch<{ authUrl: string; message: string }>(
      `/sheets/auth-url${params}`
    );
  }

  /**
   * Opens OAuth popup window for user authorization.
   * Returns a promise that resolves when OAuth completes.
   * @param returnUrl - Optional URL embedded in state
   */
  async authorize(returnUrl?: string): Promise<boolean> {
    const { authUrl } = await this.getAuthUrl(returnUrl);

    return new Promise((resolve) => {
      const width = 500;
      const height = 600;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;

      const popup = window.open(
        authUrl,
        'shareout_sheets_auth',
        `width=${width},height=${height},left=${left},top=${top}`
      );

      const handleMessage = (event: MessageEvent) => {
        if (event.data?.type === 'shareout_sheets_connected') {
          window.removeEventListener('message', handleMessage);
          popup?.close();
          resolve(true);
        } else if (event.data?.type === 'shareout_sheets_error') {
          window.removeEventListener('message', handleMessage);
          popup?.close();
          resolve(false);
        }
      };

      window.addEventListener('message', handleMessage);

      // Fallback: poll for popup close
      const checkClosed = setInterval(() => {
        if (popup?.closed) {
          clearInterval(checkClosed);
          window.removeEventListener('message', handleMessage);
          // Check if connected after popup closed
          this.isConnected().then(resolve);
        }
      }, 500);
    });
  }

  /**
   * Check if Google Sheets is connected for this artifact (simplified flow).
   */
  async isConnected(): Promise<boolean> {
    const result = await this.sdk._internalFetch<{ connected: boolean }>(
      '/sheets/token-status'
    );
    return result.connected;
  }

  /**
   * Fetch data directly from a Google Sheet.
   * Uses caching by default (5 min TTL) to reduce API calls.
   * @param options - Spreadsheet URL or ID and optional range
   */
  async fetch<T = Record<string, unknown>>(options: {
    spreadsheetUrl?: string;
    spreadsheetId?: string;
    range?: string;
    headers?: boolean;
    cache?: boolean;
    forceRefresh?: boolean;
  }): Promise<{ data: T[]; headers?: string[]; rowCount: number; cached?: boolean; cachedAt?: string }> {
    return this.sdk._internalFetch<{ data: T[]; headers?: string[]; rowCount: number; cached?: boolean; cachedAt?: string }>(
      '/sheets/fetch',
      {
        method: 'POST',
        body: JSON.stringify(options),
      }
    );
  }

  // === Write Operations (Owner Only) ===

  /**
   * Update cells in a Google Sheet.
   * Requires artifact owner authentication.
   * @param options - Spreadsheet, range, and values to write
   */
  async update(options: {
    spreadsheetUrl?: string;
    spreadsheetId?: string;
    range: string;
    values: unknown[][];
  }): Promise<{ updated: boolean; updatedCells: number; updatedRows: number }> {
    return this.sdk._internalFetch<{ updated: boolean; updatedCells: number; updatedRows: number }>(
      '/sheets/update',
      {
        method: 'POST',
        body: JSON.stringify(options),
      }
    );
  }

  /**
   * Append rows to a Google Sheet.
   * Requires artifact owner authentication.
   * @param options - Spreadsheet and values to append
   */
  async append(options: {
    spreadsheetUrl?: string;
    spreadsheetId?: string;
    range?: string;
    values: unknown[][];
  }): Promise<{ appended: boolean; appendedRows: number; appendedCells: number }> {
    return this.sdk._internalFetch<{ appended: boolean; appendedRows: number; appendedCells: number }>(
      '/sheets/append',
      {
        method: 'POST',
        body: JSON.stringify(options),
      }
    );
  }

  // === Cache Management ===

  /**
   * Get status of cached sheet data for this artifact.
   */
  async cacheStatus(): Promise<{ caches: Array<{ key: string; cachedAt: string; rowCount: number }>; count: number }> {
    return this.sdk._internalFetch<{ caches: Array<{ key: string; cachedAt: string; rowCount: number }>; count: number }>(
      '/sheets/cache'
    );
  }

  /**
   * Clear cached sheet data.
   * @param spreadsheetId - Optional: clear cache for specific spreadsheet only
   */
  async clearCache(spreadsheetId?: string): Promise<{ cleared: boolean }> {
    const params = spreadsheetId ? `?spreadsheetId=${encodeURIComponent(spreadsheetId)}` : '';
    return this.sdk._internalFetch<{ cleared: boolean }>(
      `/sheets/cache${params}`,
      { method: 'DELETE' }
    );
  }

  /**
   * Refresh data from Google Sheets, bypassing cache.
   * Shorthand for fetch with forceRefresh: true.
   */
  async refresh<T = Record<string, unknown>>(options: {
    spreadsheetUrl?: string;
    spreadsheetId?: string;
    range?: string;
    headers?: boolean;
  }): Promise<{ data: T[]; headers?: string[]; rowCount: number }> {
    return this.fetch<T>({ ...options, forceRefresh: true });
  }
}
