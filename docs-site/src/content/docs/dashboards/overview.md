---
title: Dashboards overview
description: Real-time collaborative dashboards with live data, interactive filtering, and presenter mode.
---

Dashboards are collaborative, real-time publishing artifacts. You build them in
an authenticated editor and share a separate read-only URL — both stay in sync
over a live Y.js document.

## When to use dashboards

| Scenario | Key features |
| --- | --- |
| Executive reporting | KPIs, trend charts, filter presets |
| Sales analytics | Pipeline funnel, leaderboard, drill-down |
| Operations monitoring | Live metrics, auto-refresh, WebSocket sources |
| Marketing analytics | Campaign performance, conversion funnel |
| Financial reporting | P&L, period comparisons |
| TV displays | Presenter mode, auto-cycling, fullscreen |

Use dashboards when you need real-time collaboration, interactive filtering, or
presenter mode. For static reports or simple embeds, a plain artifact with the
[JSON store](/sdk/json/) or [tables](/sdk/tables/) is simpler.

## Two URLs, one document

Every dashboard creates two artifacts that share a single Y.js CRDT document:

| Mode | URL | Access |
| --- | --- | --- |
| Editor | `shareout.site/a/{slug}` | Authenticated; full editing |
| Published | `shareout.site/p/{slug}` | Shareable; read-only, filters interactive |

Changes in the editor propagate to the published view in real time (typical
latency 50–200 ms). The published viewer can apply filters and follow a
presenter but cannot modify widget definitions or data sources.

On Teams workspaces both URLs are also available under the workspace subdomain:
`{workspace}.shareout.site/a/{slug}` and `{workspace}.shareout.site/p/{slug}`.

## Publishing

### Create

```javascript
const sdk = new ShareOut();

const result = await sdk.dashboards.create({
  title: 'Sales Dashboard',
  visibility: 'public',
});

console.log(result.editorUrl);    // shareout.site/a/sales-dashboard
console.log(result.publishedUrl); // shareout.site/p/sales-dashboard
```

Both artifacts are created automatically. `editorArtifactId` and
`publishedArtifactId` are also returned if you need them for API calls.

### Visibility

| Value | Who can view the published URL |
| --- | --- |
| `private` | Collaborators only; requires authentication |
| `workspace` | Any member of the artifact's workspace (Teams) |
| `public` | Anyone on the internet with the link; listed on workspace homepage (Teams) |

Change visibility at any time:

```javascript
const dashboard = await sdk.dashboards.open('sales-dashboard');
dashboard.publish.setVisibility('public');
```

### Unpublish / republish

```javascript
dashboard.publish.unpublish();  // published URL returns 404
dashboard.publish.republish();  // restore
```

### Embed

Public dashboards are embeddable by default:

```html
<iframe
  src="https://shareout.site/embed/my-dashboard/"
  width="100%"
  height="600"
  frameborder="0"
></iframe>
```

Restrict origins or disable embedding via the artifacts API (`embed_allowed`,
`embed_origins` fields on `PATCH /v1/artifacts/{id}`).

## Integration with the SDK

Dashboards build on existing SDK primitives:

| SDK feature | Role in dashboards |
| --- | --- |
| `sdk.realtime()` | Underlying Y.js document |
| `sdk.blobs` | Image storage for widgets |
| `sdk.comments` | Per-widget threads (`contextId: 'widget-{id}'`) |
| `sdk.table()` | `shareout` data source type for widgets |
| `sdk.dataset()` | `dataset` data source — R2 extracts |
| `sdk.connection()` | `sql` data source — live REST / warehouse |

See [Data sources](/dashboards/data-sources/) for how to bind widgets to tables,
datasets, APIs, and SQL; [Widgets & charts](/dashboards/widgets/) for layout; and
[SDK API](/dashboards/sdk-api/) for the full method reference.
