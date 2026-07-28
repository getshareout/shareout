import type { SdkClient } from '../../../core/sdk-client';
import type { RealtimeDoc } from '../../realtime-doc';
import type { DataSource, FilterState } from '../types';
import { SHAREOUT_TABLE_QUERY_LIMIT } from '../types';

/**
 * Manages dashboard data sources: CRUD in the realtime doc, fetch/refresh,
 * in-memory cache, auto-refresh timers, and filter-aware data reads.
 */
export class DataSourcesManager {
  private dataCache = new Map<string, unknown[]>();
  private refreshTimers = new Map<string, ReturnType<typeof setInterval>>();
  private dataListeners = new Map<string, Set<(data: unknown[]) => void>>();
  private autoRefreshEnabled = true;

  constructor(
    private doc: RealtimeDoc,
    private sdk: SdkClient,
    private dashboardId: string,
  ) {}

  list(): DataSource[] {
    const sources = this.doc.map<DataSource>('dataSources');
    return Object.values(sources.toJSON() as unknown as Record<string, DataSource>);
  }

  get(id: string): DataSource | null {
    const sources = this.doc.map<DataSource>('dataSources');
    return (sources.get(id) as unknown as DataSource) || null;
  }

  add(config: Omit<DataSource, 'id'>): DataSource {
    const id = `ds-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const source: DataSource = { id, ...config };
    const sources = this.doc.map<DataSource>('dataSources');
    sources.set(id, source as unknown as DataSource);

    if (source.refreshInterval && this.autoRefreshEnabled) {
      this.startAutoRefresh(id, source.refreshInterval);
    }
    return source;
  }

  update(id: string, changes: Partial<DataSource>): void {
    const sources = this.doc.map<DataSource>('dataSources');
    const existing = sources.get(id) as unknown as DataSource;
    if (existing) {
      const updated = { ...existing, ...changes };
      sources.set(id, updated as unknown as DataSource);

      if (changes.refreshInterval !== undefined) {
        this.stopAutoRefresh(id);
        if (changes.refreshInterval && this.autoRefreshEnabled) {
          this.startAutoRefresh(id, changes.refreshInterval);
        }
      }
    }
  }

  delete(id: string): boolean {
    const sources = this.doc.map<DataSource>('dataSources');
    const existed = sources.has(id);
    if (existed) {
      sources.delete(id);
      this.stopAutoRefresh(id);
      this.dataCache.delete(id);
      this.dataListeners.delete(id);
    }
    return existed;
  }

  async refresh(id: string): Promise<void> {
    const source = this.get(id);
    if (!source) return;

    let data: unknown[] = [];
    let truncated = false;
    let lastWarning: string | null = null;
    const label = source.name || id;

    try {
      switch (source.type) {
        case 'static':
          data = source.config.data || [];
          break;
        case 'api':
          if (source.config.url) {
            const response = await fetch(source.config.url, {
              method: source.config.method || 'GET',
              headers: source.config.headers,
              body: source.config.body ? JSON.stringify(source.config.body) : undefined,
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const json = await response.json();
            data = extractRows(json);
          }
          break;
        case 'shareout':
          if (source.config.tableId) {
            const table = this.sdk.table(source.config.tableId);
            // Table API caps a single query — surface truncation so charts don't silently lie.
            const limit = source.config.limit && source.config.limit > 0
              ? Math.min(source.config.limit, SHAREOUT_TABLE_QUERY_LIMIT)
              : SHAREOUT_TABLE_QUERY_LIMIT;
            data = await table.find().limit(limit).exec();
            if (data.length >= limit) {
              truncated = true;
              lastWarning =
                `Hit the ${limit}-row table limit; aggregate upstream or materialize a filtered extract.`;
              console.warn(`Dashboard data source "${label}": ${lastWarning}`);
            }
          }
          break;
        case 'dataset': {
          const name = source.config.datasetName;
          if (!name) throw new Error('dataset source requires config.datasetName');
          const ds = this.sdk.dataset(name);
          if (source.config.limit && source.config.limit > 0) {
            const page = await ds.page({ offset: 0, limit: source.config.limit });
            data = page.data;
            if (page.hasMore || data.length >= source.config.limit) {
              truncated = true;
              lastWarning =
                `Loaded first ${data.length} of ${page.total} dataset rows (config.limit=${source.config.limit}).`;
              console.warn(`Dashboard data source "${label}": ${lastWarning}`);
            }
          } else {
            // Full extract — load once, filter client-side (same model as sdk.dataset().get()).
            data = await ds.get();
          }
          break;
        }
        case 'sql':
          if (source.config.connectionId && source.config.query) {
            const connection = this.sdk.connection(source.config.connectionId);
            // connection.query returns { data, cached, executionTimeMs } — unwrap it.
            const result = await connection.query(source.config.query);
            data = extractRows(result?.data ?? result);
            if (source.config.limit && data.length > source.config.limit) {
              data = data.slice(0, source.config.limit);
              truncated = true;
              lastWarning = `Truncated SQL result to config.limit=${source.config.limit} rows.`;
              console.warn(`Dashboard data source "${label}": ${lastWarning}`);
            }
          }
          break;
      }

      this.dataCache.set(id, data);
      this.update(id, {
        lastRefreshed: new Date().toISOString(),
        truncated,
        lastWarning,
      });
      this.notifyListeners(id, data);
    } catch (error) {
      console.error(`Failed to refresh data source ${id}:`, error);
      throw error;
    }
  }

  /** Whether the last refresh of this source hit a row cap. */
  isTruncated(id: string): boolean {
    return this.get(id)?.truncated === true;
  }

  async refreshAll(): Promise<void> {
    const sources = this.list();
    await Promise.all(sources.map(s => this.refresh(s.id)));
  }

  getData(id: string): unknown[] {
    return this.dataCache.get(id) || [];
  }

  getFilteredData(id: string, filters: FilterState): unknown[] {
    const data = this.getData(id);
    if (Object.keys(filters).length === 0) return data;

    return data.filter(row => {
      const record = row as Record<string, unknown>;
      for (const [key, filterValue] of Object.entries(filters)) {
        const fieldValue = record[key];

        if (typeof filterValue === 'string') {
          if (fieldValue !== filterValue) return false;
        } else if (Array.isArray(filterValue)) {
          if (!filterValue.includes(fieldValue as string)) return false;
        } else if (typeof filterValue === 'object' && filterValue !== null) {
          if ('from' in filterValue && 'to' in filterValue) {
            const dateVal = new Date(fieldValue as string).getTime();
            const from = new Date(filterValue.from).getTime();
            const to = new Date(filterValue.to).getTime();
            if (dateVal < from || dateVal > to) return false;
          } else if ('min' in filterValue && 'max' in filterValue) {
            const numVal = Number(fieldValue);
            if (numVal < filterValue.min || numVal > filterValue.max) return false;
          }
        }
      }
      return true;
    });
  }

  observe(id: string, handler: (data: unknown[]) => void): () => void {
    if (!this.dataListeners.has(id)) {
      this.dataListeners.set(id, new Set());
    }
    this.dataListeners.get(id)!.add(handler);

    const currentData = this.getData(id);
    if (currentData.length > 0) handler(currentData);

    return () => {
      this.dataListeners.get(id)?.delete(handler);
    };
  }

  private notifyListeners(id: string, data: unknown[]): void {
    const listeners = this.dataListeners.get(id);
    if (listeners) {
      for (const handler of listeners) {
        try { handler(data); } catch (e) { console.error('Data listener error:', e); }
      }
    }
  }

  private startAutoRefresh(id: string, intervalSeconds: number): void {
    this.stopAutoRefresh(id);
    const timer = setInterval(() => {
      this.refresh(id).catch(console.error);
    }, intervalSeconds * 1000);
    this.refreshTimers.set(id, timer);
  }

  private stopAutoRefresh(id: string): void {
    const timer = this.refreshTimers.get(id);
    if (timer) {
      clearInterval(timer);
      this.refreshTimers.delete(id);
    }
  }

  startAllAutoRefresh(): void {
    this.autoRefreshEnabled = true;
    for (const source of this.list()) {
      if (source.refreshInterval) {
        this.startAutoRefresh(source.id, source.refreshInterval);
      }
    }
  }

  stopAllAutoRefresh(): void {
    this.autoRefreshEnabled = false;
    for (const id of this.refreshTimers.keys()) {
      this.stopAutoRefresh(id);
    }
  }

  destroy(): void {
    this.stopAllAutoRefresh();
    this.dataListeners.clear();
    this.dataCache.clear();
  }
}

/**
 * Pull a row array out of common API / query envelopes so dashboard widgets
 * always receive `unknown[]`. Mirrors server-side materialize extractRows.
 */
export function extractRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    for (const key of ['rows', 'data', 'results', 'records', 'items']) {
      if (Array.isArray(obj[key])) return obj[key] as unknown[];
    }
    return [obj];
  }
  return payload === undefined || payload === null ? [] : [payload];
}
