---
title: Datasets
description: Read versioned bulk extracts stored in R2, direct from the source.
---

Versioned, read-only data files (JSON or CSV) stored in R2. Access via
`sdk.dataset(name)`. Use a dataset when a dashboard needs to load a **whole extract once
and filter or aggregate it client-side** — the "load the data, then play with it" model.
For live, mutable, per-row data use [tables](/sdk/tables/); for external live sources use
[connections](/sdk/connections/).

## Methods

```typescript
get<T>(): Promise<T[]>
// All rows — reads the whole extract direct from R2, parsed for you.
// Falls back to Worker stream when direct R2 serving is blocked.

page<T>(opts?: { offset?: number; limit?: number }): Promise<DatasetPage<T>>
// Worker-paginated slice — use for very large datasets without pulling all rows.

metadata(): Promise<DatasetMetadata>
// rowCount, columns, format, version, size, timestamps.

downloadUrl(): Promise<string>
// Short-lived direct-from-R2 URL (raw bytes). Use for a CSV download link
// or your own streaming parser.

stream(): Promise<ReadableStream<Uint8Array>>
// Worker-proxied byte stream (fallback).

list(): Promise<{ name: string; format: string; sizeBytes: number; version: number; updatedAt: string }[]>
// All datasets for this artifact.
```

```typescript
interface DatasetMetadata {
  name: string;
  format: 'json' | 'csv';
  sizeBytes: number;
  version: number;
  rowCount?: number | null; // null = deferred for large files; use page().total for an exact count
  columns?: string[];
  createdAt: string;
  updatedAt: string;
}

interface DatasetPage<T> {
  data: T[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}
```

## Examples

```javascript
// Load the whole extract and filter client-side — no Worker, no source hit per view
const rows = await sdk.dataset('shipments').get();
const late = rows.filter(r => r.status === 'delayed');

// Paginate a large dataset server-side
const page = await sdk.dataset('shipments').page({ offset: 0, limit: 100 });

// Raw URL — hand to a <a download> link or stream yourself
const url = await sdk.dataset('shipments').downloadUrl();

// Inspect metadata before loading
const meta = await sdk.dataset('shipments').metadata();
// rowCount is null for large files (deferred); page().total is always exact.
const rows = meta.rowCount ?? (await sdk.dataset('shipments').page({ limit: 1 })).total;
console.log(rows, meta.sizeBytes);
```

## Egress model

`get()` reads bytes **directly from R2** (bypassing the Worker) and parses them in the
browser. Auth is enforced by the Worker before the signed URL is issued — the URL is
short-lived and private to the artifact. If direct R2 serving is blocked (e.g. CORS
misconfiguration), `get()` falls back automatically to the Worker stream.

Use `downloadUrl()` when you need the raw URL for a download link. Use `page()` to avoid
pulling the entire extract into the browser for very large files.

## Creating a dataset

Datasets are written by materializing a query or pushing rows — see
[connections](/sdk/connections/) `materialize()`. This store is **read-only**.

## Limits

| Constraint | Value |
|------------|-------|
| Per file (hard cap) | 500 MB |
| Formats | `json`, `csv` |
| Instance total storage | `STORAGE_QUOTA_BYTES` (0 / unset = unlimited) |
| Instance per-file cap | `STORAGE_MAX_FILE_BYTES` (0 / unset = unlimited, still ≤ 500 MB hard cap) |

Caps are enforced on upload and on `materialize()`. An over-cap file returns
`FILE_TOO_LARGE` (413); exceeding total storage returns `STORAGE_QUOTA_EXCEEDED` (507).
Storage is summed per workspace across uploaded datasets, materialized datasets, blobs, and
artifact assets (personal artifacts count against their owner).

Self-hosted operators set the instance env vars on the Worker — there is no Free/Pro plan
table in open source.
