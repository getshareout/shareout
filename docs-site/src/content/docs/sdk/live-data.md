---
title: Live data
description: Query workspace connections from published artifact HTML without auth failures.
---

import { Aside } from '@astrojs/starlight/components';

How to query live data from a published HTML artifact. Read this before writing any
`fetch('/v1/data/…')` or `new ShareOut()` call — getting it wrong causes
`Authentication required`, empty charts, or silently wrong numbers.

## Two-origin model

Published artifacts run in a **sandboxed iframe** on a separate content host:

| Layer | Host | Role |
|-------|------|------|
| Trusted shell | `shareout.site` (or workspace subdomain) | Page chrome, session cookies, parent↔iframe bridge |
| Untrusted content | `<hex>.shareoutcdn.site` | Your artifact HTML/JS — opaque origin |

The parent shell mints a short-lived Bearer `sessionToken` and delivers it to the SDK
via `postMessage`. Cookies are **not** sent from the iframe.

| Approach | Works in sandbox? |
|----------|-------------------|
| `await ShareOut.create()` + SDK methods | Yes — SDK sends `Authorization: Bearer …` |
| `fetch(…/v1/data/…, { credentials: 'include' })` | No — cookies not sent from iframe |
| `new ShareOut()` at top-level (no `await`) | Racey — token may arrive after init |

## Required initialization

```html
<script src="https://shareout.site/sdk/shareout.js"></script>
<script>
(async () => {
  const sdk = await ShareOut.create(); // waits for the sessionToken from the parent shell

  // load data, then render
})();
</script>
```

Use an async IIFE (or top-level `await` in a module script). Never call `.get()`,
`.query()`, or any other SDK method before `ShareOut.create()` resolves.

## Never call `/v1/data/*` with raw fetch

```javascript
// WRONG — fails in sandbox
const res = await fetch(`${base}/v1/data/${aid}/connections/mixpanel/query`, {
  method: 'POST',
  credentials: 'include',
  body: JSON.stringify({ query, options }),
});

// RIGHT — REST workspace connection (Mixpanel, Meta Graph, any rest_api)
const body = await sdk.connection('mixpanel').fetch('/query/events', {
  params: { project_id: '123', event: '["login_success"]', type: 'general', unit: 'day', from_date, to_date },
  ttl: 300,
});
```

All `/v1/data/{artifactId}/*` calls from artifact JS must go through the SDK.

## Generic REST connections (`sdk.connection`)

Workspace connections with `kind: generic` and `provider: rest_api`:

```javascript
const sdk = await ShareOut.create();

// .fetch() unwraps the envelope — returns the provider body directly
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

// Providers often nest data — unwrap defensively
const inner = mpBody?.data ?? mpBody;

// .query() keeps { data, cached, executionTimeMs }
const r = await sdk.connection('meta').query(
  { endpoint: '/act_123/insights', method: 'GET' },
  { params: { fields: 'impressions,clicks' }, ttl: 120 }
);
const payload = r.data;
```

See [connections](/sdk/connections/) for `materialize()` and scheduled refresh.

## Platform providers (BigQuery, Snowflake, GA, Shopify)

Use **`sdk.platform`** (preferred). The low-level path is still
`POST /v1/data/{id}/platform/{provider}/{endpoint}/execute` if you need raw REST.

```javascript
const sdk = await ShareOut.create();

// 1. Resolve the connection id (owner-only list)
const bq = await sdk.platform.connectionByName('bigquery');
if (!bq) throw new Error("No 'bigquery' connection on this artifact.");

// 2. Execute the provider endpoint
const result = await sdk.platform.execute('bigquery', 'jobs.query', {
  connectionId: bq.id,
  params: {
    pathParams: { projectId: 'my-gcp-project' },
    body: {
      query: 'SELECT CAST(MAX(date) AS STRING) AS maxd FROM `proj.dataset.table`',
      useLegacySql: false,
      maxResults: 5000,
    },
  },
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

Equivalent forms:

```javascript
// Fluent
await sdk.platform.provider('bigquery').execute('jobs.query', { connectionId, params });

// List providers / connections
const providers = await sdk.platform.providers();
const connections = await sdk.platform.connections();
```

Provider endpoint pattern: `/platform/{providerId}/{endpointId}/execute`.

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

    const result = await sdk.platform.execute('bigquery', endpointId, {
      connectionId,
      params,
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

For very large extracts, prefer [materialize](/sdk/connections/) or a scheduled
[`query_snapshot`](/guides/jobs/) job instead of paging in the browser.

## Parallel queries

The SDK deduplicates in-flight POSTs by path + body hash. Parallel calls to the same
endpoint with **different bodies** are safe on current SDK builds. For older SDKs, run
warehouse queries sequentially.

## Who can query live?

| API | Password viewer | Owner | Workspace member (per_user connector) |
|-----|----------------|-------|--------------------------------------|
| `sdk.json` / `sdk.table()` | Yes (scoped by access policy) | Yes | Yes |
| `sdk.connection().query/fetch` (shared) | No | Yes | No |
| `sdk.connection().query/fetch` (per_user) | No | Yes (own token) | Yes (own token) |
| `sdk.platform.execute(…)` (shared) | No | Yes | Yes |

<Aside type="caution" title="Public dashboards">
Live connection queries are not available to password-only viewers — they hold no
ShareOut user identity. For public dashboards, **materialize** data into a dataset or
table so reads come from storage, not live credentials.
</Aside>

Per-user connectors return `403 CREDENTIALS_REQUIRED` until the workspace member saves
their token via `PUT /v1/workspaces/{id}/connections/{connectionId}/my-credentials`.

## Common mistakes

| Mistake | Symptom |
|---------|---------|
| Raw `fetch` + `credentials: 'include'` | `Authentication required` |
| `new ShareOut()` without `create()` | Intermittent auth failures |
| Wrong provider unwrap (`r.data` vs `r.data.data`) | Charts render, numbers all zero |
| Parallel POST same path on old SDK | First query shape reused — empty/wrong data |
| Ignoring BigQuery `pageToken` | First page only — missing rows with no error |
| Expecting password viewers to run live queries | `Forbidden` or empty data |

## Checklist

- `const sdk = await ShareOut.create()` inside async IIFE
- No raw `fetch` to `/v1/data/{artifactId}/…`
- REST sources → `sdk.connection('name').fetch(…)`
- BigQuery / platform → `sdk._internalFetch('/platform/…')`
- Defensive unwrap of nested `.data` from providers
- Owner-only live queries documented in UI copy, or use materialize for public audiences
