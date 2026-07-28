# SDK: Datasets (bulk read-only extracts)

Versioned, read-only data files (JSON or CSV) stored in R2. Access via
`sdk.dataset(name)`. Use a dataset when a dashboard needs to load a **whole extract
once and filter/aggregate it client-side** — the "load the data, then play with it"
model, like a Tableau extract or Power BI import. For live, mutable, per-row data use
[table.md](table.md); for external live sources use [connections.md](connections.md).

## Methods

```typescript
get<T>(): Promise<T[]>                                   // ALL rows — whole extract direct-from-R2, parsed for you
page<T>(opts?: { offset?: number; limit?: number }): Promise<DatasetPage<T>>  // Worker-paginated slice
metadata(): Promise<DatasetMetadata>                     // rowCount, columns, version, size
downloadUrl(): Promise<string>                           // short-lived DIRECT-from-R2 URL (raw bytes)
stream(): Promise<ReadableStream<Uint8Array>>            // Worker-proxied stream (fallback)
list(): Promise<DatasetSummary[]>
```

## Egress: read the extract directly from R2

`get()` loads the **entire** dataset and parses it for you. Under the hood it reads the
bytes **directly from R2** (they bypass the Worker), then parses JSON/CSV in the browser —
the "load the extract once, filter client-side" model. It falls back to the Worker stream
automatically when direct R2 serving isn't configured or the direct fetch is blocked.
Datasets are private to the artifact; auth is enforced before the URL is signed.

```javascript
// get() returns every row, read direct-from-R2 and parsed for you
const rows = await sdk.dataset('shipments').get();
const late = rows.filter(r => r.status === 'delayed');   // client-side, no Worker, no source hit
```

Use `downloadUrl()` when you want the raw URL/bytes yourself (hand a CSV to a download
link or your own streaming parser); use `page()` for server-side slicing of a very large
dataset without pulling the whole extract into the browser.

```javascript
const url = await sdk.dataset('shipments').downloadUrl();          // raw direct-from-R2 URL
const firstHundred = await sdk.dataset('shipments').page({ offset: 0, limit: 100 });
```

## Creating a dataset

Datasets are written by **materializing** a query or pushing rows — see
[connections.md](connections.md) `materialize()`. They are read-only via this store.

## Limits

| Constraint | Value |
|------------|-------|
| Per file (Free) | 25 MB |
| Per file (Pro / Teams) | 500 MB |
| Total storage | Free 50 MB · Pro 5 GB · Teams 10 GB/seat |
| Formats | `json`, `csv` |

Per-file and total-storage caps are enforced at upload **and** at `materialize()` — an
over-cap upload returns `FILE_TOO_LARGE` (413) and an over-quota one returns
`STORAGE_QUOTA_EXCEEDED` (507). Storage counts uploaded datasets, materialized datasets,
blobs, and artifact assets across the workspace (personal artifacts count against the owner).

> `metadata().rowCount` is computed inline for files up to ~10 MB. For larger files
> `rowCount` may be `null` (deferred) — use `page().total`, which is always exact, when you
> need the count. `columns` is always populated.

## Related

- [connections.md](connections.md) — query a source and materialize into a dataset
- [table.md](table.md) — mutable, queryable per-row storage
