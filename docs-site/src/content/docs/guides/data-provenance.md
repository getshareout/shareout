---
title: Data provenance
description: Show viewers where your numbers come from — manifest fields, per-element links, and the Data sources drawer.
---

import { Aside } from '@astrojs/starlight/components';

Dashboards and reports run on queries, connectors, snapshots, and scheduled
deliveries. Viewers (and the people they forward a Slack or email to) constantly
ask **where the numbers come from and how to reproduce them.** Answer it at build
time — declare provenance in the manifest and ShareOut renders the UI for you.

<Aside type="note">
This is a strong recommendation, not a gate. ShareOut never blocks a publish for
missing provenance — but the publish readiness profile **warns** when a live
source has no query or description, and the editor flags it. Treat those warnings
as "finish the data story."
</Aside>

## The one rule

**For every dataset an artifact reads, declare in the manifest: what it is, the
query or script that produced it, the tables it touches, when it refreshes, and
how to rebuild it.** Then link each chart or table to its source.

## 1. Declare provenance on sources

Every `sources.{connections,json,tables}` entry accepts optional provenance
fields:

```html
<script type="shareout/manifest">
{
  "version": "2.0",
  "sources": {
    "connections": {
      "warehouse": {
        "label": "Customer activity (90d)",
        "description": "Per-company create/interaction events, last 90 days.",
        "query": "SELECT company_id, SUM(recipes_created + vendors_created) AS act\nFROM CUSTOMER_METRICS.FCT_CUSTOMER_ACTIVITY\nWHERE event_date >= DATEADD(day,-90,CURRENT_DATE)\nGROUP BY 1",
        "tables": ["CUSTOMER_METRICS.FCT_CUSTOMER_ACTIVITY"],
        "refresh": "daily 12:00 UTC",
        "as_of": "2026-06-22",
        "replication": {
          "build": "python build_scorecard.py",
          "publish": "node publish_scorecard.mjs",
          "credentials": "Snowflake key-pair in workspace connection"
        },
        "default": [{ "company_id": "c1", "act": 42 }]
      }
    }
  }
}
</script>
```

| Field | Purpose |
| --- | --- |
| `label` | Human name for the dataset |
| `description` | One line: what it is |
| `query` | The exact SQL, API call, or build step that produced the data |
| `tables` | Underlying warehouse or source tables |
| `refresh` | Cadence in words (`daily 12:00 UTC`, `manual`, `live`) |
| `as_of` | Date or time the snapshot reflects |
| `replication` | `{ build, publish, credentials, notes }` — how to rebuild from scratch |

All fields are optional and backward-compatible. Keep `default` too — it powers
editor preview. See [Manifest → Provenance](/spec/manifest/#provenance) for the
full schema.

## 2. Link each chart or table to its source

Two ways; use either or both.

**Per-element attribute** (simplest):

```html
<div id="rev-chart" data-shareout-source="connection:warehouse"></div>
<table data-shareout-source="json:revenue">…</table>
```

**Manifest `feeds`** (when you cannot edit the element, or want a note):

```json
"feeds": [
  { "element": "#rev-chart", "source": "connection:warehouse", "note": "90-day rollup" }
]
```

`source` is a `kind:key` ref — `connection:warehouse`, `json:revenue`,
`table:rooms`.

## 3. Show the drawer to viewers

One line of JavaScript:

```javascript
const sdk = await ShareOut.create();
sdk.sources.mount(); // floating "Data sources" button + drawer + per-element badges
```

Or zero lines — add the attribute and the SDK mounts on DOM ready:

```html
<body data-shareout-sources>
```

What viewers get:

- A **Data sources** drawer: one card per dataset with description, tables,
  refresh, as-of, a collapsible **View query**, and a **Replicate** block
  (build/publish/credentials).
- A small **ⓘ source** badge on every element you tagged (or mapped via `feeds`);
  clicking it opens the drawer at that dataset.

See [Sources SDK](/sdk/sources/) for the full API.

## 4. Attribute crew deliveries

When a crew or job delivers data-derived numbers to Slack, Telegram, or email,
pass `source` to `notify_send` so recipients can trace the figures:

```jsonc
{
  "destination": "slack",
  "message": "Weekly adoption: 62% of accounts active (+4pts).",
  "config": { "connection": "team_slack", "channelId": "C0…" },
  "source": {
    "connection": "acme_snowflake",
    "query": "SELECT … FROM CUSTOMER_METRICS.FCT_CUSTOMER_ACTIVITY …",
    "asOf": "2026-06-22"
  }
}
```

A compact footer is appended: `_Source: acme_snowflake · as of 2026-06-22_`
plus the one-line query. See [Crew tools → notify_send](/crew/tools/#notify_send).

## Checklist

- [ ] Every connection or dataset declares `description` + `query` (+ `tables`)
- [ ] `refresh` + `as_of` set so viewers know how fresh the data is
- [ ] `replication.{build,publish,credentials}` filled — the "how to rebuild" answer
- [ ] Each chart or table tagged `data-shareout-source` or mapped in `feeds`
- [ ] `sdk.sources.mount()` (or `<body data-shareout-sources>`) so viewers see it
- [ ] Crew or job deliveries pass `source` to `notify_send`
- [ ] Publish readiness profile shows no `provenance` warnings

## Related

- [Manifest](/spec/manifest/) — provenance fields and `feeds`
- [Sources SDK](/sdk/sources/) — `sdk.sources` API
- [Publishing artifacts](/guides/publishing/) — `editor_readiness` provenance findings
- [Connections](/sdk/connections/) — live query + materialize
- [Crew tools](/crew/tools/) — `notify_send` with `source`
