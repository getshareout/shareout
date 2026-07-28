import { ShareOutError } from '../shareout-error';
import type { SdkClient } from '../core/sdk-client';

export interface DatasetMetadata {
  name: string;
  format: 'json' | 'csv';
  sizeBytes: number;
  version: number;
  rowCount?: number;
  columns?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DatasetPage<T> {
  data: T[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export class Dataset {
  constructor(private sdk: SdkClient, private name: string) {}

  /**
   * All rows of the dataset, read as a whole extract **directly from R2** (the bytes
   * bypass the Worker) and parsed client-side — the "load the extract once, filter in
   * the browser" model. Falls back to the Worker stream when direct R2 serving is
   * unconfigured or the direct fetch is blocked (e.g. R2 CORS). Use `page()` for
   * server-side pagination of very large datasets.
   */
  async get<T = unknown>(): Promise<T[]> {
    const info = await this._extractInfo();
    let text: string;
    try {
      text = await fetchExtractText(this._absolute(info.url), info.direct, this.sdk._sessionToken);
    } catch (err) {
      if (!info.direct) throw err;
      // Direct-from-R2 fetch failed (likely R2 CORS not configured for this origin) —
      // fall back to the Worker stream, which is same-origin and CORS-open.
      text = await fetchExtractText(this._streamUrl(), false, this.sdk._sessionToken);
    }
    return parseExtract<T>(text, info.format);
  }

  private _extractInfo(): Promise<{ url: string; format: 'json' | 'csv'; direct: boolean }> {
    return this.sdk._internalFetch<{ url: string; format: 'json' | 'csv'; direct: boolean }>(
      `/datasets/${encodeURIComponent(this.name)}/download-url`
    );
  }

  private _absolute(url: string): string {
    return url.startsWith('http') ? url : `${this.sdk._baseUrl}${url}`;
  }

  private _streamUrl(): string {
    return `${this.sdk._baseUrl}/v1/data/${this.sdk._artifactId}/datasets/${encodeURIComponent(this.name)}/stream`;
  }

  async metadata(): Promise<DatasetMetadata> {
    return this.sdk._internalFetch<DatasetMetadata>(
      `/datasets/${encodeURIComponent(this.name)}`
    );
  }

  async page<T = unknown>(options?: { offset?: number; limit?: number }): Promise<DatasetPage<T>> {
    const params = new URLSearchParams();
    if (options?.offset !== undefined) params.set('offset', String(options.offset));
    if (options?.limit !== undefined) params.set('limit', String(options.limit));
    const query = params.toString();
    return this.sdk._internalFetch<DatasetPage<T>>(
      `/datasets/${encodeURIComponent(this.name)}/content${query ? '?' + query : ''}`
    );
  }

  /**
   * Short-lived URL that downloads the whole dataset directly from R2 (bytes bypass
   * the Worker) — fetch it client-side and filter in the browser. Falls back to the
   * Worker stream URL when direct serving is unconfigured.
   */
  async downloadUrl(): Promise<string> {
    const info = await this._extractInfo();
    return this._absolute(info.url);
  }

  async stream(): Promise<ReadableStream<Uint8Array>> {
    const url = `${this.sdk._baseUrl}/v1/data/${this.sdk._artifactId}/datasets/${encodeURIComponent(this.name)}/stream`;
    // Cookies don't reach the cross-origin CDN iframe; carry the viewer session
    // token or private-artifact streams always 401.
    const headers: Record<string, string> = {};
    if (this.sdk._sessionToken) headers['Authorization'] = `Bearer ${this.sdk._sessionToken}`;
    const response = await fetch(url, { credentials: 'include', headers });
    if (!response.ok) {
      throw new ShareOutError('Stream failed', 'STREAM_ERROR', response.status);
    }
    return response.body!;
  }

  async list(): Promise<{ name: string; format: string; sizeBytes: number; version: number; updatedAt: string }[]> {
    const result = await this.sdk._internalFetch<{
      datasets: { name: string; format: string; sizeBytes: number; version: number; updatedAt: string }[];
      count: number;
    }>('/datasets');
    return result.datasets;
  }
}

async function fetchExtractText(
  url: string,
  direct: boolean,
  sessionToken?: string,
): Promise<string> {
  // Presigned R2 URLs authorize via the query signature (no cookies). The Worker
  // stream fallback needs the viewer session Bearer — cookies don't cross the CDN iframe.
  if (direct) {
    const res = await fetch(url);
    if (!res.ok) {
      throw new ShareOutError('Dataset download failed', 'DATASET_DOWNLOAD_ERROR', res.status);
    }
    return res.text();
  }
  const headers: Record<string, string> = {};
  if (sessionToken) headers['Authorization'] = `Bearer ${sessionToken}`;
  const res = await fetch(url, { credentials: 'include', headers });
  if (!res.ok) {
    throw new ShareOutError('Dataset download failed', 'DATASET_DOWNLOAD_ERROR', res.status);
  }
  return res.text();
}

function parseExtract<T>(text: string, format: 'json' | 'csv'): T[] {
  if (format === 'csv') return parseCsv(text) as T[];
  const parsed = JSON.parse(text);
  return (Array.isArray(parsed) ? parsed : [parsed]) as T[];
}

// Mirrors the server-side CSV parse (datasets/paginate.ts): newline-delimited rows,
// quoted fields with embedded commas and "" escapes, values trimmed. Values are strings.
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split('\n').filter((line) => line.trim());
  if (lines.length === 0) return [];
  const headers = parseCsvLine(lines[0]);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) row[headers[j]] = values[j] || '';
    rows.push(row);
  }
  return rows;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}
