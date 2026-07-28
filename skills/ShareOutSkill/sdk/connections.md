# SDK: Connections (query sources + materialize extracts)

Query external data sources (REST APIs, GraphQL, and via workspace connections: warehouses) and
optionally **materialize** the result into a durable dataset or table. Access via
`sdk.connection(name)`. Connections are defined once (artifact- or workspace-scoped)
with encrypted credentials; the artifact references them by name.

> **Teams workspaces:** Connectors can be **shared** (one team token) or **per-user** (each member saves their own token). See [../team/workspace-connections.md](../team/workspace-connections.md).

> **Artifact authors:** If the dashboard queries live data on page load, read
> [live-data.md](live-data.md) first (sandbox auth, `ShareOut.create()`, response
> unwrapping). Do not use raw `fetch` to `/v1/data/…`.

## Methods

```typescript
// Live query (cached server-side per the connection's TTL)
query<T>(query: string | object, options?: { cache?: boolean; ttl?: number; params?: object }): Promise<QueryResult<T>>
fetch<T>(query, options?): Promise<T>   // same, returns .data directly

// Extract once → store durably (the "import" model)
materialize(params: {
  query?: string | object;     // run server-side via this connection (REST path or warehouse SQL)
  rows?: unknown[];            // OR push pre-fetched rows (from any source)
  to: string;                  // "dataset:NAME", "table:NAME", or "json:KEY" (jobs API also supports path merge)
  mode?: 'replace' | 'append'; // default replace
  format?: 'json' | 'csv';     // dataset only, default json
}): Promise<MaterializeResult>
```

## Live vs. extract — which to use

- **Live** (`query`/`fetch`): hits the source each call (with a server-side cache).
  Use for always-fresh, small results. Like Tableau "live" / Power BI DirectQuery.
- **Extract** (`materialize`): runs the query once, stores the result as a dataset (R2),
  table (D1), or json key. The dashboard then reads the extract offline — no source hit per view.
  Like a Tableau extract / Power BI import. Refresh it on demand or on a schedule.

## Materialize: extract once, play offline

```javascript
// Run a query and store the result as a dataset (read whole-extract, filter client-side)
await sdk.connection('shipping_api').materialize({
  query: '/shipments?since=2026-01-01',
  to: 'dataset:shipments',
  mode: 'replace',
});
// Dashboard reads it offline, direct from R2:
const url = await sdk.dataset('shipments').downloadUrl();
const rows = await (await fetch(url)).json();

// Or materialize into a queryable table (server-side filter/sort/aggregate):
await sdk.connection('shipping_api').materialize({ query: '/shipments', to: 'table:shipments' });
const delayed = await sdk.table('shipments').find({ status: 'delayed' }).exec();
```

### Warehouses (Snowflake / BigQuery) — push rows

Warehouse queries run through the Data Platform engine (proxy mode; credentials never
leave the Worker). Fetch the rows however you query the warehouse, then push them into a
durable extract with `rows`:

```javascript
// 1) query the warehouse (via platform connection), 2) materialize the rows
const result = await sdk.connection('shipping_wh').query('SELECT * FROM shipments'); // if supported
await sdk.connection('shipping_wh').materialize({ rows: result.data, to: 'dataset:shipments' });
```

`rows` works with data from ANY source (platform engine, Python, proxy) — it's the
general "push these rows into a dataset/table" primitive.

## Scheduled refresh (extract once, refresh nightly)

Create a scheduled job with the `materialize` action (`POST /v1/jobs`) to refresh a
single extract on a cron, or use `query_snapshot` when you need **multiple fixed queries**
against one connection (common for warehouse dashboards). Scheduled refresh must use
`query` (it re-runs server-side), not inline `rows`:

```json
POST /v1/jobs
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

The Worker runs the query off the serving path and rewrites the extract; reads stay
direct-from-R2. See [../api/jobs.md](../api/jobs.md) for the job API.

## Notes / limits

- `materialize` is **owner-only**.
- Live `query`/`fetch` is **owner-only** (viewers with artifact password cannot proxy credentials).
- Server-side `query` (and scheduled refresh) supports generic `rest_api` connections
  today; for warehouses use the `rows` push form or platform `_internalFetch` — see [live-data.md](live-data.md).
- Extract size capped at the dataset per-file limit (Free 25MB · Pro/Teams 500MB) and the workspace storage quota / table limits. Over-cap materialize fails with `FILE_TOO_LARGE` / `STORAGE_QUOTA_EXCEEDED`.
- Connection auth: encrypted at rest; private to the artifact or workspace.

## Provenance

When you declare a connection in the manifest, add provenance (`description`,
`query`, `tables`, `refresh`, `as_of`, `replication`) so viewers can see where the
data comes from and how to rebuild it — ShareOut renders a Data sources drawer +
per-element badges from it. See [../patterns/data-provenance.md](../patterns/data-provenance.md).

## Related

- [datasets.md](datasets.md) — read materialized extracts (direct-from-R2)
- [table.md](table.md) — query materialized rows server-side
- [../patterns/data-provenance.md](../patterns/data-provenance.md) — show viewers where data comes from
- [../integrations/overview.md](../integrations/overview.md) — Data Platform sources
