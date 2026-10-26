# Data Provenance — "where does this data come from?"

Most artifacts run on queries, connectors, snapshots, and scheduled deliveries.
Viewers (and the people they forward a Slack/email to) constantly ask **where the
numbers come from and how to reproduce them.** Answer it *at build time* — declare
provenance in the manifest and **viewers see it automatically**: every page that shows
data gets a **Data** button (shared links, guests and signed-in viewers alike) that
lists each source, where it comes from, how fresh it is, and highlights the elements it
feeds. You write no UI. Don't make the viewer (or a future agent) reverse-engineer it.

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
| `as_of` | Date/time the snapshot reflects — whatever refreshes the data must rewrite it on every run |
| `freshness_sla` | Oldest the data may get before viewers see **may be out of date** (`24h`, `2d`, `PT6H`). Without it: twice the refresh job's schedule, else twice what `refresh` says, else a week |
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

## 3. Viewers see it automatically

Nothing to mount. When the page shows data (declared sources or feeds, bound elements,
or SDK data calls), the viewer gets a **Data / Datos** button next to the ShareOut
toolbar. It opens **Data sources**: one row per source with

- its label (yours, or the key) and where it comes from (`From BigQuery`),
- freshness — what ShareOut saw (`Updated 2 h ago · by the job “Ads diario”`), else your
  `as_of` / `refresh`, else an honest **not declared**; flagged **may be out of date**
  past `freshness_sla` (or twice the schedule),
- what it feeds (`Feeds: 3 elements`); hovering or picking a source outlines those
  elements on the page.

ShareOut also folds in what it knows server-side: the connections your names resolve to,
`materialize` / `query_snapshot` jobs and crews that write your stores, sheet syncs,
datasets, followable metrics and MCP connections — so even an undeclared source shows
up, tagged **Not declared**. Declaring is what makes the row read well.

Who sees what:

| Viewer | Sees |
|--------|------|
| Anyone who can open the page (incl. a public link) | labels, kinds, where it comes from, freshness, what each source feeds — refreshes as "updated automatically, daily at 06:00 UTC" |
| People tied to the page or its workspace (collaborators, members, guests) | + who refreshes it (`by the job “Ads diario”`) — name jobs and AI tasks so they read well to clients |
| Editors / workspace admins | + `query`, `tables`, `replication`, the connection and its credential scope, every job/crew and its status |
| Viewers under an [access policy](../core/access-policy.md) | only what the page source names; no job/crew names, no timing beyond scheduled refreshes |

The same list is an API: `GET /v1/artifacts/{id}/sources`
([api/artifacts.md](../api/artifacts.md#get-v1artifactsidsources--where-a-pages-data-comes-from)),
and Studio and the editor show it in their **Data** tabs.

### In-page drawer (optional)

`so.sources.mount()` still renders an in-page drawer and per-element **ⓘ source** badges
(or `<body data-shareout-sources>` for zero JS). Use it only when you want badges inside
the page itself; viewers no longer need it to see sources. Inside the ShareOut viewer (and
Studio) its floating button stays hidden — the host's **Data** button replaces it; badges
and `so.sources.open()` still work. Its **stale** tags read only the manifest: past
`freshness_sla`, else a week after `as_of`.

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
- [ ] `refresh` + `as_of` set so viewers know how fresh the data is (`freshness_sla` when the
      tolerance isn't twice the schedule)
- [ ] `replication.{build,publish,credentials}` filled — the KEY "how to rebuild" answer
- [ ] Each chart/table tagged `data-shareout-source` or mapped in `feeds`
- [ ] Open the page's **Data** button: every source has a label, a freshness line and the elements it feeds
- [ ] Crew/job deliveries pass `source` to `notify_send`
- [ ] Publish readiness profile shows no `provenance` warnings

## Related

- [Manifest](../core/html-spec/manifest.md#provenance-where-the-data-comes-from)
- [Connections](../sdk/connections.md) — live query + materialize
- [Crew](../agents/crew.md) — refresh → narrate → deliver
- [Jobs: query_snapshot](../api/jobs.md#querysnapshotconfig) — scheduled refresh
