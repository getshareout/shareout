---
title: Fuentes de datos
description: Conectá widgets del dashboard a datos estáticos, APIs, tablas, datasets o SQL en vivo.
---

import { Aside } from '@astrojs/starlight/components';

Every chart, KPI, and table widget reads from a **data source** registered on the
dashboard. Sources live in the realtime document and refresh independently.

```javascript
const dashboard = await sdk.dashboards.open(id);

const src = dashboard.dataSources.add({
  name: 'Shipments',
  type: 'dataset',
  config: { datasetName: 'shipments' },
});
await dashboard.dataSources.refresh(src.id);

dashboard.widgets.add('chart', {
  // …chart config…
  // bind via widget.dataSource = src.id after add, or set in create options
});
```

## Source types

| Type | Config | When to use |
| --- | --- | --- |
| `static` | `data: unknown[]` | Demo data, fixtures, small fixed series |
| `api` | `url`, optional `method` / `headers` / `body` | Public HTTPS APIs the browser can call |
| `shareout` | `tableId` | Live rows in an artifact table (`sdk.table`) |
| `dataset` | `datasetName`, optional `limit` | Materialized JSON/CSV extracts (`sdk.dataset`) |
| `sql` | `connectionId`, `query` | Live REST or warehouse connection (`sdk.connection`) |

`csv` and `websocket` are reserved for future loaders.

### `static`

```javascript
dashboard.dataSources.add({
  name: 'Demo',
  type: 'static',
  config: { data: [{ month: 'Jan', revenue: 10 }, { month: 'Feb', revenue: 14 }] },
});
```

### `api`

Browser `fetch` to a URL. Response bodies are unwrapped with the same envelope
rules as SQL (`data` / `rows` / `results` / array).

```javascript
dashboard.dataSources.add({
  name: 'Public metrics',
  type: 'api',
  config: { url: 'https://api.example.com/metrics', method: 'GET' },
  refreshInterval: 60,
});
```

<Aside type="caution">
Credentials in `headers` are visible to every viewer of a public dashboard. Prefer
[connections](/sdk/connections/) + `sql`, or materialize to a dataset for public pages.
</Aside>

### `shareout` (tables)

Reads via `sdk.table(tableId).find().limit(n)`. The table API hard-caps a single
query at **1000 rows**.

```javascript
dashboard.dataSources.add({
  name: 'Leads',
  type: 'shareout',
  config: { tableId: 'leads' }, // optional: limit: 500 (max 1000)
});
```

After `refresh()`, check truncation:

```javascript
if (dashboard.dataSources.isTruncated(src.id)) {
  console.warn(dashboard.dataSources.get(src.id)?.lastWarning);
}
```

For larger tables, aggregate upstream, filter with a [materialize](/sdk/connections/)
extract, or use `type: 'dataset'`.

### `dataset` (R2 extracts)

Loads a versioned extract written by materialize or upload — ideal for public
dashboards (viewers never hit the warehouse).

```javascript
// Full extract into the browser (filter client-side)
dashboard.dataSources.add({
  name: 'Shipments extract',
  type: 'dataset',
  config: { datasetName: 'shipments' },
});

// Server-paged slice (sets truncated when hasMore)
dashboard.dataSources.add({
  name: 'Shipments page',
  type: 'dataset',
  config: { datasetName: 'shipments', limit: 500 },
});
```

Requires `await ShareOut.create()` so the sandbox session can read the artifact’s
datasets. See [Live data](/sdk/live-data/) and [Datasets](/sdk/datasets/).

### `sql` (connections)

Runs `sdk.connection(connectionId).query(query)` and unwraps
`{ data, cached, executionTimeMs }`. Works for `rest_api`, BigQuery, and Snowflake
generic connections.

```javascript
dashboard.dataSources.add({
  name: 'Regional revenue',
  type: 'sql',
  config: {
    connectionId: 'warehouse',
    query: 'SELECT region, SUM(revenue) AS revenue FROM sales GROUP BY 1',
  },
  refreshInterval: 300,
});
```

Live query is **owner-oriented**. For anonymous public viewers, materialize on a
schedule and bind a `dataset` or `shareout` source instead.

Optional `config.limit` slices the unwrapped row array client-side after the query.

## Auto-refresh

Set `refreshInterval` (seconds) on the source. Call
`dashboard.dataSources.startAllAutoRefresh()` in editor mode if you stopped timers.

## Truncation contract

| Field | Meaning |
| --- | --- |
| `source.truncated` | Last refresh hit a known cap |
| `source.lastWarning` | Human-readable reason |
| `dataSources.isTruncated(id)` | Convenience read |

Always prefer showing `lastWarning` in the editor chrome over silent empty charts.

## Related

- [Connections & materialize](/sdk/connections/)
- [Datasets](/sdk/datasets/)
- [Tables](/sdk/tables/)
- [Live data (sandbox auth)](/sdk/live-data/)
- [SDK API → dataSources](/dashboards/sdk-api/#dashboarddatasources)
