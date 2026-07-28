# REST API: Metric Watches

**One-click anomaly watches** on table-backed dashboards — simpler than full [metric alerts](metric-alerts.md). A watch reads a table metric on an hourly sweep and drops a **bell notification** when the value moves sharply (default ≥20% vs the last baseline). No destination config — the workspace **Needs You** feed always.

Use metric watches when you want *"tell me when this number moves"* without Slack/email routing. Use [metric alerts](metric-alerts.md) when you need cron schedules, destinations, crew follow-up, or json-path KPIs.

## Endpoints

```http
POST   /v1/metric-watch              # Create a watch
GET    /v1/metric-watch?artifact_id=…  # List watches on an artifact
DELETE /v1/metric-watch/{id}         # Remove a watch
```

Auth: ShareOut API token **or** browser session (same as Home Inspector and the workspace assistant).

## Create a watch

```http
POST /v1/metric-watch
Authorization: Bearer {token}
Content-Type: application/json

{
  "artifact_id": "art_abc123",
  "table": "orders",
  "kind": "sum",
  "column": "total",
  "threshold_pct": 20
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `artifact_id` | yes | Dashboard (or any table-backed artifact) to watch. |
| `table` | yes | Table name in the artifact's MiniDB. |
| `kind` | yes | `count` — row count; `sum` — total of a numeric column; `last` — latest row's column value. |
| `column` | for `sum` / `last` | Numeric column name. Ignored for `count`. |
| `threshold_pct` | no | Alert when \|Δ%\| vs last baseline ≥ this value. Default **20**. |

Returns `{ "watch": { … } }` with `201` on success.

### Permissions

Anyone who can **access the artifact** (owner, editor, or workspace member with view) may create watches. Watches are per-user objects tied to the artifact — not workspace-wide alert rules.

## List / delete

```http
GET /v1/metric-watch?artifact_id=art_abc123
```

```json
{ "watches": [
  { "id": "mw_…", "artifact_id": "art_abc123", "table_name": "orders",
    "metric_kind": "sum", "column_name": "total", "threshold_pct": 20,
    "last_value": 48200, "enabled": true }
]}
```

```http
DELETE /v1/metric-watch/mw_abc123
```

Only the watch creator may delete it.

## How evaluation works

- An **hourly sweep** reads the current metric from the artifact's MiniDB (reuses the same audited sources as metric alerts).
- The **first reading** sets a baseline — no alert yet.
- On later runs, when \|percent change\| ≥ `threshold_pct`, a `metric_watch` event lands in **Needs You** (bell + Activity feed).
- **Cooldown:** at most one alert per watch every **6 hours** while the move persists.
- Up to **20 watches per artifact** per user.

## Home Inspector

On an open artifact tab, the Inspector **Watches** section lists watches, lets you add one (pick table + kind + optional column/threshold), or delete existing watches — same API as above.

## Agent tool

The workspace assistant exposes **`watch_metric`** with the same fields — use when the user says *"watch revenue on this dashboard"* or *"alert me if signups spike."*

## Related

- [metric-alerts.md](metric-alerts.md) — threshold rules with Slack/email/Discord destinations
- [../patterns/dashboards.md](../patterns/dashboards.md#one-click-metric-watches-simpler) — when to use watches vs alerts
- [../core/workspace-home.md](../core/workspace-home.md#inspector-right-rail) — Inspector Watches section
- [../team/activity-feed.md](../team/activity-feed.md) — `metric_watch` in Needs You
