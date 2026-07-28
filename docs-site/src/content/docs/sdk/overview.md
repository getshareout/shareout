---
title: SDK overview
description: The browser SDK for ShareOut artifacts — data, files, realtime, email, AI.
---

import { Aside } from '@astrojs/starlight/components';

Published artifacts ship with a browser SDK. Drop in one script tag and your page
gets storage, file uploads, realtime collaboration, email, Python, and an AI chat
agent — no backend to wire up.

## Install

```html
<script src="https://shareout.site/sdk/shareout.js"></script>
<script>
  const sdk = await ShareOut.create();
</script>
```

<Aside type="caution">
Always load from `https://shareout.site/sdk/shareout.js` (not a third-party CDN),
and call `ShareOut.create()` **after** the script loads. A `ShareOut is not
defined` error means the script URL or order is wrong.
</Aside>

## Initialize

```javascript
// Preferred for published HTML — waits for the sandbox session token
const sdk = await ShareOut.create();

// Sync constructor — fine for local/mock, racey for live data in an iframe
const sdk = new ShareOut();
```

`artifactId` and `baseUrl` are auto-detected from the URL. Published artifacts run
in a sandboxed iframe; `create()` waits for the short-lived token the parent frame
injects.

## Readiness & loading

The viewer shows a branded **loading skeleton** while your artifact boots — automatically,
no code. The SDK posts `shareout:content-ready` once your data calls settle, and the
viewer removes the skeleton.

```javascript
const sdk = await ShareOut.create();
renderEverything(await sdk.json.get('snapshot'));
ShareOut.ready(); // optional: hide the skeleton the instant the page is painted
```

`ShareOut.ready()` is optional — without it the SDK auto-detects readiness (network goes
idle). Call it for a crisp hand-off, especially on chart-heavy pages. Keep first paint
fast: read first-paint data from `sdk.json`/`sdk.table()` (prefetched, zero round-trip)
and keep live `connection.query()` off the load path. See [Fast rendering](/guides/performance/).

## Viewer identity

Use `sdk.me()` to read the current viewer's role and identity inside an artifact. It
returns `{ role, isOwner, canEdit, email, name }`, sourced from data the platform
injects at serve time. Anonymous viewers resolve to `role: 'viewer'`.

```javascript
const me = await sdk.me();
if (me.canEdit) showAdminPanel();
else showClientView(me.email);
```

Server-side permissions are always enforced regardless of what `me()` returns — use it
for UI branching only. Collaborator management is REST-only (not an SDK method).

## Local development (mock mode)

On `file://`, `localhost`, or `127.0.0.1` the SDK auto-switches to a localStorage
mock — no network, no auth. Force it with `new ShareOut({ mock: true })`, clear it
with `sdk.clearMockData()`.

## The three data tiers

| Tier | API | For |
| --- | --- | --- |
| 1 | [`sdk.json`](/sdk/json/) | Simple state — prefs, flags, cached values |
| 2 | [`sdk.table(name)`](/sdk/tables/) | Structured records — tasks, leads, entries |
| 2b | [`sdk.grid(name)`](/sdk/grid/) | Editable spreadsheet grid (table or Sheets) |
| 3 | [`sdk.realtime(id)`](/sdk/realtime/) | Live collaboration — docs, whiteboards |

## Working with data

| API | Does |
| --- | --- |
| [`sdk.dataset(name)`](/sdk/datasets/) | Read versioned JSON/CSV extracts from R2 |
| [`sdk.connection(name)`](/sdk/connections/) | Live REST / warehouse query + `materialize` |
| [`sdk.platform`](/sdk/live-data/#platform-providers-bigquery-snowflake-ga-shopify) | OAuth/warehouse providers (BigQuery, GA, Shopify, …) |
| [Live data guide](/sdk/live-data/) | Sandbox auth, platform providers, pagination |
| [`sdk.sheets`](/sdk/sheets/) | Google Sheets read/write |
| [`sdk.workspace.table(name)`](/sdk/tables/#share-a-table-across-artifacts-teams) | Share a table across artifacts in a workspace (Teams) |
| [`sdk.blobs`](/sdk/blobs/) | File storage, served direct from R2 |
| [`sdk.files`](/sdk/files/) | Embed workspace Assets (`dlv_*`) across artifacts |

## Everything else

| API | Does |
| --- | --- |
| [`sdk.email`](/sdk/email/) | Contact-form email to the artifact owner |
| [`sdk.python`](/sdk/python/) | Run Python in the browser (Pyodide) |
| [`sdk.agent`](/guides/ai-agent/) | AI chat agent (visitor-facing) |
| [`sdk.crew`](/crew/overview/) | Server-side autonomous agent (owner-only) |
| `sdk.me()` | Current viewer identity and role (for UI branching) |
| `ShareOut.ready()` | Signal the viewer to hide the loading skeleton |
| `sdk.comments` | Threaded comments |
| [`sdk.sources`](/sdk/sources/) | Data provenance drawer + per-element "where from?" badges |
| `sdk.sheets` / `sdk.shopify` | [Integrations](/integrations/overview/) |

## Manifest

Most stores require you to declare their keys/schemas in a manifest block in your
HTML `<head>`:

```html
<script type="shareout/manifest">
{ "version": "2.0", "sources": { "json": { "counter": { "default": 0 } } } }
</script>
```

Each store page below shows its manifest shape.

## Errors

```javascript
try {
  await sdk.json.get('key');
} catch (e) {
  if (e instanceof ShareOutError) console.log(e.code, e.status, e.message);
}
```
