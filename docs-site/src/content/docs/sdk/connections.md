---
title: Connections
description: Query external data sources and materialize results into datasets or tables.
---

import { Aside } from '@astrojs/starlight/components';

Query external data sources (REST APIs, workspace connectors) and optionally
**materialize** the result into a durable [dataset](/sdk/datasets/) or
[table](/sdk/tables/). Access via `sdk.connection(name)`. Connections are defined
once with encrypted credentials; the artifact references them by name.

<Aside type="caution" title="Sandbox auth required">
Call `await ShareOut.create()` before using any SDK method. Raw `fetch` to
`/v1/data/…` with `credentials: 'include'` fails inside the artifact sandbox — cookies
are not sent across the iframe boundary. See [live-data](/sdk/live-data/) for the full
initialization pattern.
</Aside>

## Methods

```typescript
// Live query — cached server-side per the connection's TTL
query<T>(
  query: string | Record<string, unknown>,
  options?: { cache?: boolean; ttl?: number; params?: Record<string, unknown> }
): Promise<QueryResult<T>>

// Same as query() but returns .data directly (unwraps the envelope)
fetch<T>(
  query: string | Record<string, unknown>,
  options?: { cache?: boolean; ttl?: number; params?: Record<string, unknown> }
): Promise<T>

// Extract once → store durably (owner only)
materialize(params: {
  query?: string | Record<string, unknown>; // run server-side via this connection
  rows?: unknown[];                          // OR push pre-fetched rows from any source
  to: string;                               // "dataset:NAME" | "table:NAME" | "json:KEY"
  mode?: 'replace' | 'append';             // default replace
  format?: 'json' | 'csv';                 // dataset only, default json
}): Promise<MaterializeResult>
```

```typescript
interface QueryResult<T> {
  data: T;
  cached: boolean;
  executionTimeMs: number;
  rowCount?: number;
}

interface MaterializeResult {
  target: 'dataset' | 'table' | 'json';
  name: string;
  rowCount: number;
  version?: number;
  sizeBytes?: number;
  mode?: 'replace' | 'append';
  path?: string;
}
```

## Live vs. extract

| | `query` / `fetch` | `materialize` |
|---|---|---|
| When to use | Always-fresh, small results | "Load once, read offline" at scale |
| Source hit | Each call (server-side cache) | Once per refresh |
| Viewers | Owner only | Anyone (reads come from dataset/table) |
| Analogy | Power BI DirectQuery | Power BI Import / Tableau extract |

## Examples

### Live query (REST connection)

```javascript
const sdk = await ShareOut.create();

// .fetch() unwraps the envelope and returns the provider body directly
const body = await sdk.connection('mixpanel').fetch('/query/events', {
  params: {
    project_id: '123',
    event: JSON.stringify(['login_success']),
    type: 'general',
    unit: 'day',
    from_date: '2026-05-01',
    to_date: '2026-05-07',
  },
  ttl: 300,
});

// .query() keeps { data, cached, executionTimeMs }
const r = await sdk.connection('meta').query(
  { endpoint: '/act_123/insights', method: 'GET' },
  { params: { fields: 'impressions,clicks' }, ttl: 120 }
);
const payload = r.data;
```

### Materialize → read offline

```javascript
// Run a server-side query and store the result as a dataset
await sdk.connection('shipping_api').materialize({
  query: '/shipments?since=2026-01-01',
  to: 'dataset:shipments',
  mode: 'replace',
});

// Dashboard reads direct from R2 — no live source hit on every view
const rows = await sdk.dataset('shipments').get();
const late = rows.filter(r => r.status === 'delayed');

// Or materialize into a queryable table (server-side filter/sort)
await sdk.connection('shipping_api').materialize({ query: '/shipments', to: 'table:shipments' });
const delayed = await sdk.table('shipments').find({ status: 'delayed' }).exec();
```

### Warehouse live query (BigQuery / Snowflake)

Generic `bigquery` and `snowflake` connections support the same `query` / `fetch` /
`materialize` path as REST. Pass the SQL string as `query`:

```javascript
const result = await sdk.connection('warehouse').query(
  'SELECT region, SUM(revenue) AS revenue FROM shipments GROUP BY 1',
  { params: { projectId: 'my-gcp-project' } }, // BigQuery
);
const rows = result.data; // array of row objects

// Or materialize for public dashboards (no live warehouse hit per viewer)
await sdk.connection('warehouse').materialize({
  query: 'SELECT * FROM shipments WHERE status = \'delayed\'',
  to: 'dataset:late_shipments',
});
```

### Push rows from any source

`rows` accepts pre-fetched data from any source — platform engine, Python, a proxy:

```javascript
const result = await sdk.connection('warehouse').query('SELECT * FROM shipments');
await sdk.connection('warehouse').materialize({
  rows: result.data,
  to: 'dataset:shipments',
});

// Snapshot into the JSON store for first-paint dashboards
await sdk.connection('shipping_api').materialize({
  rows: result.data,
  to: 'json:snapshot',
});
```

## Scheduled refresh

Refresh an extract on a cron with a `materialize` job (`POST /v1/jobs`). Scheduled
refresh uses `query` (server-side re-run), not inline `rows`:

```json
{
  "artifact_id": "art_abc123",
  "action": "materialize",
  "trigger_type": "cron",
  "schedule": "0 6 * * *",
  "config": {
    "connection": "shipping_api",
    "query": "/shipments",
    "target": { "type": "dataset", "name": "shipments" },
    "mode": "replace"
  }
}
```

## Notes

- `materialize` and live `query`/`fetch` are **owner-only**. For public dashboards
  that need to work for all viewers, materialize the data and let readers use
  [datasets](/sdk/datasets/) or [tables](/sdk/tables/).
- Per-user workspace connectors return `403 CREDENTIALS_REQUIRED` until the workspace
  member saves their own token via `PUT /v1/workspaces/{id}/connections/{id}/my-credentials`.
- Connection credentials are encrypted at rest and private to the artifact or workspace.
- Extract size is capped at the dataset hard limit (500 MB), optional instance env
  `STORAGE_MAX_FILE_BYTES` / `STORAGE_QUOTA_BYTES`, or table row limits. Over-cap
  materialize fails with `FILE_TOO_LARGE` / `STORAGE_QUOTA_EXCEEDED`.
- `rest_api` `baseUrl` values must be public http(s) URLs — private, loopback, and
  cloud-metadata hosts are blocked (same SSRF policy as the secrets proxy).
