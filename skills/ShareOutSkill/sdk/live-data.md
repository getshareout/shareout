# SDK: Live data from workspace connections

Use this when an **HTML artifact** queries live data from a workspace connection
(Mixpanel, BigQuery, Snowflake, Shopify, a generic REST API, etc.) on page load.

**Read this before writing `fetch('/v1/data/...')` or `new ShareOut()`.** Getting it
wrong produces `Authentication required`, empty charts, or silently wrong numbers.

## How published HTML runs

Published HTML uses a **two-origin model** (ADR 30):

| Layer | Host | What runs there |
|-------|------|-----------------|
| **Trusted shell** | `$ORIGIN_HOST` (or workspace subdomain) | Page chrome, link-preview meta, session cookies, parent→iframe bridge |
| **Untrusted content** | `<hex>.shareoutcdn.site` | Your artifact HTML/JS inside a sandboxed iframe (opaque origin) |

Each artifact's immutable id (`art_<hex>`) maps to a dedicated content subdomain
(`<hex>.shareoutcdn.site`), so artifact code cannot reach the app's session cookie or
sibling artifacts. Private/gated artifacts load under a path-prefix capability token
(`/c/<token>/…`) so relative asset requests inherit access without cookies.

The parent shell mints a short-lived **Bearer `sessionToken`** and passes it to the SDK
via `postMessage`.

| Approach | Works in sandbox? |
|----------|-------------------|
| `await ShareOut.create()` + SDK methods | **Yes** — SDK sends `Authorization: Bearer …` |
| `fetch(…/v1/data/…, { credentials: 'include' })` | **No** — cookies are not sent from the iframe |
| `new ShareOut()` at top-level script (no await) | **Racey** — token may arrive after init |

## Required initialization

```html
<!-- Absolute URL (always works) or relative /sdk/shareout.js (resolves on content host) -->
<script src="$ORIGIN/sdk/shareout.js"></script>
<script>
(async () => {
  const sdk = await ShareOut.create();  // waits for embedded sessionToken in iframe

  // … load data, then render …
})();
</script>
```

**SDK on the content host:** the same bundles (`/sdk/shareout.js`, `shareout.css`,
`shareout-ui.js`) are also served on `<hex>.shareoutcdn.site`, so relative `/sdk/…`
paths work inside the iframe. `ShareOut.create()` still talks to `$ORIGIN_HOST` for
the data API — do not change `baseUrl` to the content host.

Use an async IIFE (or top-level `await` in a module script). Do **not** call
`load()` before `ShareOut.create()` resolves.

## Rule: never call `/v1/data/*` with raw `fetch`

```javascript
// ❌ WRONG — fails in sandbox; cookies don't cross the iframe boundary
const res = await fetch(`${base}/v1/data/${aid}/connections/mixpanel/query`, {
  method: 'POST',
  credentials: 'include',
  body: JSON.stringify({ query, options }),
});

// ✅ RIGHT — generic REST workspace connection (Mixpanel, Meta Graph as rest_api, etc.)
const body = await sdk.connection('mixpanel').fetch('/query/events', {
  params: { project_id: '123', event: '["login_success"]', type: 'general', unit: 'day', from_date, to_date },
  ttl: 300,
});
```

All `/v1/data/{artifactId}/*` calls from artifact JavaScript should go through the SDK
(`sdk.connection`, `sdk._internalFetch`, `sdk.json`, `sdk.table`, …).

## Generic REST connections (`sdk.connection`)

Workspace connections with `kind: generic` and `provider: rest_api` (e.g. Mixpanel,
custom APIs) use **`sdk.connection(name)`**:

```javascript
const sdk = await ShareOut.create();

// .fetch() returns the provider response body (unwraps ShareOut envelope)
const mpBody = await sdk.connection('mixpanel').fetch('/query/events', {
  params: {
    project_id: '3212168',
    event: JSON.stringify(['$ae_session', 'login_success']),
    type: 'general',
    unit: 'day',
    from_date: '2026-05-01',
    to_date: '2026-05-07',
  },
  ttl: 300,
});

// Mixpanel nests series under .data — always unwrap defensively
const inner = mpBody?.data ?? mpBody;
const dates = inner.series;
const sessions = dates.map(d => Number((inner.values?.['$ae_session'] || {})[d] || 0));
```

String query (path only):

```javascript
await sdk.connection('my_api').fetch('/items', { params: { limit: 10 } });
```

Object query (method + body — e.g. Meta Graph POST):

```javascript
const r = await sdk.connection('meta').query(
  { endpoint: '/act_123/insights', method: 'GET' },
  { params: { fields: 'impressions,clicks' }, ttl: 120 }
);
const payload = r.data; // .query() keeps { data, cached, executionTimeMs }
```

See [connections.md](connections.md) for materialize / scheduled refresh.

## Data Platform providers (BigQuery, Snowflake, GA, Shopify)

Platform connections (`kind: platform`) are queried via **`sdk._internalFetch`**
(relative to `/v1/data/{artifactId}`). There is no `sdk.platform` store in the browser
bundle today — do not invent it.

```javascript
const sdk = await ShareOut.create();

// 1. Resolve connection id (owner-only)
const { connections } = await sdk._internalFetch('/platform/connections');
const bq = connections.find(c => c.name === 'bigquery');
if (!bq) throw new Error("No 'bigquery' connection in this workspace.");

// 2. Execute provider endpoint
const result = await sdk._internalFetch('/platform/bigquery/jobs.query/execute', {
  method: 'POST',
  body: JSON.stringify({
    connectionId: bq.id,
    params: {
      pathParams: { projectId: 'analytics-platform' },
      body: {
        query: 'SELECT CAST(MAX(date) AS STRING) AS maxd FROM `proj.dataset.table`',
        useLegacySql: false,
        maxResults: 5000,
      },
    },
  }),
});

// 3. Parse BigQuery rows
if (result.success === false || result.error) {
  throw new Error(result.error?.message || 'Query failed');
}
const bqResp = result.data || result;
const fields = (bqResp.schema?.fields || []).map(f => f.name);
const rows = (bqResp.rows || []).map(row => {
  const o = {};
  (row.f || []).forEach((cell, i) => { o[fields[i]] = cell.v; });
  return o;
});
```

Provider-specific endpoint paths: see [../integrations/overview.md](../integrations/overview.md)
and each provider doc. Pattern is always
`/platform/{providerId}/{endpointId}/execute`.

### BigQuery pagination

`jobs.query` caps the synchronous response by **payload size**, not only `maxResults`.
Large result sets return a `pageToken` (also surfaced on the execute envelope as
`pagination.hasMore` / `pagination.cursor`). Without following that token, dashboards
silently drop rows after the first page.

Fetch the next page with `jobs.getQueryResults`, passing the `jobId` from
`jobReference.jobId` and the token as a query param:

```javascript
function parseBqRows(bqResp) {
  const fields = (bqResp.schema?.fields || []).map(f => f.name);
  return (bqResp.rows || []).map(row => {
    const o = {};
    (row.f || []).forEach((cell, i) => { o[fields[i]] = cell.v; });
    return o;
  });
}

async function fetchAllBqRows(sdk, connectionId, projectId, sql) {
  let pageToken;
  let jobId;
  const allRows = [];

  while (true) {
    const endpointId = pageToken ? 'jobs.getQueryResults' : 'jobs.query';
    const params = pageToken
      ? { pathParams: { projectId, jobId }, queryParams: { pageToken } }
      : {
          pathParams: { projectId },
          body: { query: sql, useLegacySql: false, maxResults: 10000 },
        };

    const result = await sdk._internalFetch(`/platform/bigquery/${endpointId}/execute`, {
      method: 'POST',
      body: JSON.stringify({ connectionId, params }),
    });
    if (result.success === false || result.error) {
      throw new Error(result.error?.message || 'Query failed');
    }

    const bqResp = result.data || result;
    jobId = jobId || bqResp.jobReference?.jobId;
    allRows.push(...parseBqRows(bqResp));

    pageToken = result.pagination?.cursor || bqResp.pageToken || null;
    if (!pageToken) break;
  }

  return allRows;
}
```

For very large extracts, prefer [connections.md](connections.md) materialize or a scheduled
[`query_snapshot`](../api/jobs.md#querysnapshotconfig) job instead of paging in the browser.

## Parallel queries

The SDK deduplicates in-flight POSTs by **path + body hash**. Parallel calls to the
same endpoint with **different bodies** (e.g. three BigQuery SQL strings) are safe on
current SDK builds.

If you target an older SDK, run warehouse queries sequentially or upgrade the worker.

## Auth: who can query live?

| API | Viewer with password | Artifact owner | Workspace member (`per_user` connector) |
|-----|----------------------|----------------|----------------------------------------|
| `sdk.json` / `sdk.table()` | Yes (scoped by access policy) | Yes | Yes (same as viewer rules) |
| `sdk.connection().query/fetch` (shared workspace generic) | **No** | Yes | **No** |
| `sdk.connection().query/fetch` (`credentialScope: per_user`) | **No** | Yes (own token) | Yes (own token via `my-credentials`) |
| `sdk._internalFetch('/platform/…')` (shared, not private) | **No** | Yes | Yes |

Live connection queries are **not** available to password-only viewers — they never hold a ShareOut user identity. For **public** dashboards, use **materialize** so reads come from dataset/table, not live credentials.

Per-user workspace connectors return `403` with `code: "CREDENTIALS_REQUIRED"` until the member calls `PUT /v1/workspaces/{id}/connections/{connectionId}/my-credentials`. Full Teams guide: [../team/workspace-connections.md](../team/workspace-connections.md).

For **public dashboards** that must work for any viewer, use **materialize**:

```javascript
await sdk.connection('mixpanel').materialize({
  query: '/query/events',
  to: 'dataset:daily_sessions',
  mode: 'replace',
});
// Readers use sdk.dataset('daily_sessions') — no live credential needed
```

## Common mistakes → symptoms

| Mistake | Symptom |
|---------|---------|
| Raw `fetch` + `credentials: 'include'` | `Authentication required` or `No 'bigquery' connection…` |
| `new ShareOut()` without `create()` | Intermittent auth failures |
| Wrong Mixpanel unwrap (`r.data` vs `r.data.data`) | Charts render, numbers all zero |
| Parallel POST same path, old SDK | First query’s shape reused → empty/wrong charts |
| Ignoring BigQuery `pageToken` | First page only — missing rows with no error |
| Expecting password viewers to run live queries | `Forbidden` or empty data |

## Checklist for live-data dashboards

- [ ] `const sdk = await ShareOut.create()` inside async IIFE
- [ ] No raw `fetch` to `/v1/data/{artifactId}/…`
- [ ] REST sources → `sdk.connection('name').fetch(…)`
- [ ] BigQuery / platform → `sdk._internalFetch('/platform/…')`
- [ ] BigQuery result sets that may exceed one page → follow `pageToken` via `jobs.getQueryResults`
- [ ] Defensive unwrap of provider nested `.data`
- [ ] Owner-only live queries documented in UI copy, or materialize for public audience

## Related

- [connections.md](connections.md) — generic REST connections + materialize
- [datasets.md](datasets.md) — read materialized extracts
- [overview.md](overview.md) — SDK loading and errors
- [../integrations/overview.md](../integrations/overview.md) — provider setup (workspace admin)
- [../patterns/dashboards.md](../patterns/dashboards.md) — dashboard layout patterns
