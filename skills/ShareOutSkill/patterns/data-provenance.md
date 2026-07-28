# Data Provenance — "where does this data come from?"

Most artifacts run on queries, connectors, snapshots, and scheduled deliveries.
Viewers (and the people they forward a Slack/email to) constantly ask **where the
numbers come from and how to reproduce them.** Answer it *at build time* — declare
provenance in the manifest and ShareOut renders the UI for you. Don't make the
viewer (or a future agent) reverse-engineer it.

> This is a strong recommendation, not a gate. ShareOut never blocks a publish for
> missing provenance — but the publish readiness profile **warns** when a live
> source has no query/description, and the editor flags it. Treat those warnings
> as "finish the data story."

## The one rule

**For every dataset an artifact reads, declare in the manifest: what it is, the
query/script that produced it, the tables it touches, when it refreshes, and how to
rebuild it.** Then link each chart/table to its source. That's the whole pattern.

## 1. Declare provenance on sources (manifest)

Every `sources.{connections,json,tables}` entry takes optional provenance fields:

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
          "credentials": "path/to/warehouse-credentials.json (Snowflake key-pair)"
        },
        "default": [{ "company_id": "c1", "act": 42 }]
      }
    }
  }
}
</script>
```

| Field | Purpose |
|-------|---------|
| `label` | Human name for the dataset |
| `description` | One line: what it is |
| `query` | The exact SQL / API call / build step that produced the data |
| `tables` | Underlying warehouse/source tables |
| `refresh` | Cadence in words (`daily 12:00 UTC`, `manual`, `live`) |
| `as_of` | Date/time the snapshot reflects |
| `replication` | `{ build, publish, credentials, notes }` — how to rebuild from scratch |

All optional, all backward-compatible. Keep `default` too — it powers editor preview.

## 2. Link each chart/table to its source

Two ways; use either or both.

**Per-element attribute** (simplest):

```html
<div id="rev-chart" data-shareout-source="connection:warehouse"></div>
<table data-shareout-source="json:revenue">…</table>
```

**Manifest `feeds`** (when you can't edit the element, or want a note):

```json
"feeds": [
  { "element": "#rev-chart", "source": "connection:warehouse", "note": "90-day rollup" }
]
```

`source` is a `kind:key` ref — `connection:warehouse`, `json:revenue`, `table:rooms`.

## 3. Render the drawer (one line) — or zero lines

```js
const so = await ShareOut.create();
so.sources.mount();   // floating "Data sources" button + drawer + per-element badges
```

Zero-JS auto-mount — add the attribute and the SDK mounts on DOM ready:

```html
<body data-shareout-sources>
```

What viewers get:

- A **Data sources** drawer: one card per dataset with description, tables,
  refresh, as-of, a collapsible **View query**, and a **Replicate** block
  (build/publish/credentials).
- A small **ⓘ source** badge on every element you tagged (or mapped via `feeds`);
  clicking it opens the drawer at that dataset.

### SDK API

| Call | Returns |
|------|---------|
| `so.sources.list()` | `SourceEntry[]` — all declared sources + provenance |
| `so.sources.get(ref)` | one `SourceEntry` (by `connection:warehouse` or bare `warehouse`) |
| `so.sources.feeds()` | declared element→source mappings |
| `so.sources.mount(opts?)` | render drawer + badges, returns `{ open(ref?), close(), destroy() }` |
| `so.sources.open(ref?)` | open the drawer (optionally at a source) |

`mount` options: `{ title, side: 'left'|'right', badges, button, buttonLabel }`.
Theme via CSS vars: `--so-src-accent`, `--so-src-bg`, `--so-src-ink`, `--so-src-card`.

## 4. Attribute deliveries (crew / scheduled)

When a crew or job delivers data-derived numbers to Slack/Telegram/email, the
recipient is one forward away from "where's this from?". Pass `source` to
`notify_send`:

```js
notify_send({
  destination: "slack",
  config: { connection: "team_slack", channelId: "C0…" },
  message: "Weekly adoption: 62% of accounts active (+4pts).",
  source: {
    connection: "acme_snowflake",
    query: "SELECT ... FROM CUSTOMER_METRICS.FCT_CUSTOMER_ACTIVITY ...",
    asOf: "2026-06-22",
    tables: ["CUSTOMER_METRICS.FCT_CUSTOMER_ACTIVITY"],
    columns: ["company_id", "act"],
    filters: ["event_date >= last 90 days"]
  }
});
```

A compact footer is appended: `_Source: acme_snowflake · as of 2026-06-22_` plus
**Tables**, **Columns**, and **Filters** lines when provided. When only a query is
passed (no structured fields), the one-line query is clipped into the footer instead.
The crew is also instructed to state the source + as-of in its narrative. For recurring
delivery, store the same fields in the [`query_snapshot`](../api/jobs.md#querysnapshotconfig)
job config — `tables`/`columns`/`filters` are resolved from the snapshot when omitted.

## Checklist

- [ ] Every connection/dataset declares `description` + `query` (+ `tables`)
- [ ] `refresh` + `as_of` set so viewers know how fresh the data is
- [ ] `replication.{build,publish,credentials}` filled — the KEY "how to rebuild" answer
- [ ] Each chart/table tagged `data-shareout-source` or mapped in `feeds`
- [ ] `so.sources.mount()` (or `<body data-shareout-sources>`) so viewers see it
- [ ] Crew/job deliveries pass `source` to `notify_send`
- [ ] Publish readiness profile shows no `provenance` warnings

## Related

- [Manifest](../core/html-spec/manifest.md#provenance-where-the-data-comes-from)
- [Connections](../sdk/connections.md) — live query + materialize
- [Crew](../agents/crew.md) — refresh → narrate → deliver
- [Jobs: query_snapshot](../api/jobs.md#querysnapshotconfig) — scheduled refresh
