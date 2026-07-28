# REST API: Metric Alerts

Follow a number on an artifact and get alerted when it crosses a threshold. A
metric alert evaluates a value from the artifact's own data (`sdk.json` or a
table) on a cron schedule and, when the condition matches, delivers through the
shared destination layer (Slack, email, Discord, webhook).

Two object types:

- **Metric definitions** — the followable numbers an owner exposes on an artifact.
- **Alert rules** — subscriptions that watch a defined metric and deliver when it crosses a threshold.

> **Make the dashboard and the alert share the same number.** The evaluator reads
> stored data, never the rendered page. Write displayed KPIs to `sdk.json` (or a
> table) and point the metric definition at that same key. See
> [../patterns/dashboards.md](../patterns/dashboards.md#followable-kpis-metric-alerts).

## Endpoints

```http
PUT    /v1/metric-alerts/definitions                  # Create/update a followable metric
GET    /v1/metric-alerts/definitions?artifact_id=…    # List metrics on an artifact
DELETE /v1/metric-alerts/definitions/{artifactId}/{metricId}

POST   /v1/metric-alerts              # Create an alert rule
GET    /v1/metric-alerts?artifact_id=…  # List alert rules on an artifact
GET    /v1/metric-alerts/{id}         # Get one rule
PATCH  /v1/metric-alerts/{id}         # Update (enable/pause, schedule, condition, message, cooldown)
DELETE /v1/metric-alerts/{id}         # Delete
POST   /v1/metric-alerts/{id}/run     # Evaluate now (manual)
GET    /v1/metric-alerts/{id}/events  # Recent evaluation history (value, matched, delivered)
```

All endpoints use the standard ShareOut API token (same auth as `/v1/jobs`), not
the artifact-scoped data tokens.

## Permissions (workspace-aware)

| Role | Who | Can do |
|------|-----|--------|
| **manager** | Artifact owner/editor, or owner/admin of the artifact's workspace | Define metrics; create alerts to any destination (team Slack channels, webhooks, multiple email recipients); list and manage every alert on the artifact. |
| **viewer** | Viewer-collaborator, or a workspace member | Read metric definitions; create **personal** alerts only — a Slack DM to their own member id or an email to their own account address. Cannot define metrics or use channel/webhook destinations. |

`GET /v1/metric-alerts?artifact_id=…` is manager-aware: a manager sees **every**
alert on the artifact (including viewer self-subscriptions); a viewer sees only
their own. A rule's creator **or** a manager may pause/delete/run it.

If a creator loses access to the artifact, the rule fails closed: it is disabled
on its next evaluation and stops delivering.

## Metric Definitions

A definition names a number and says where to read it from. Define it once; many
viewers can then follow it.

**Declare in HTML (recommended for agents):** add a `<script type="shareout/metrics">`
block to the page; on publish it's parsed and the definitions are registered
automatically — no API call. Upsert-only (removing one from the HTML doesn't delete
it). See [../patterns/dashboards.md](../patterns/dashboards.md#followable-kpis-metric-alerts).

```html
<script type="shareout/metrics">
{ "metrics": [ { "id": "revenue", "label": "Revenue", "format": "currency:USD",
  "source": { "type": "json_path", "key": "metrics", "path": "$.revenue" } } ] }
</script>
```

Or register/manage them over the API:

### PUT /v1/metric-alerts/definitions

```json
{
  "artifact_id": "art_abc123",
  "metric_id": "revenue",
  "label": "Revenue",
  "format": "currency:USD",
  "source": { "type": "json_path", "key": "metrics", "path": "$.revenue" }
}
```

Upserts by `(artifact_id, metric_id)`.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `artifact_id` | string | yes | Artifact the metric lives on. |
| `metric_id` | string | yes | Stable key referenced by rules. Letters, digits, `_`, `-`. |
| `label` | string | yes | Human label used in alert messages. |
| `format` | string | no | Display hint: `currency:USD`, `number`, `percent`. |
| `source` | object | yes | Where the number comes from (see Source Types). |

### Source Types

| `type` | Reads | Fields |
|--------|-------|--------|
| `json_path` | A numeric value inside a `sdk.json` key | `key` (json key), `path` (e.g. `$.revenue`, `$.totals.mrr`, `$.rows[0].n`) |
| `table_count` | Row count of a table | `table`, optional `where` filter |
| `table_aggregate` | `sum`/`avg`/`min`/`max` of a numeric field over a table | `table`, `field`, `fn`, optional `where` |

```json
// Count of open tickets
{ "type": "table_count", "table": "tickets", "where": { "status": "open" } }

// Sum of order totals in the last 7 days
{ "type": "table_aggregate", "table": "orders", "field": "total", "fn": "sum",
  "where": { "createdAt": { "$gte": { "$daysAgo": 7 } } } }
```

> `where` uses the same filter operators as `sdk.table().query()` (`$gt`, `$gte`,
> `$lt`, `$eq`, …). `{ "$daysAgo": N }` is replaced with an ISO timestamp at
> evaluation time. Metrics are evaluated at owner scope (the global snapshot), not
> per-viewer row scope.

Up to **10 metrics per artifact**.

## Alert Rules

### POST /v1/metric-alerts (Create)

```json
{
  "artifact_id": "art_abc123",
  "metric_id": "revenue",
  "name": "Revenue dropped below target",
  "condition": { "op": "lt", "value": 100000 },
  "schedule": "0 * * * *",
  "destination": {
    "kind": "slack",
    "config": { "connection": "team", "targetType": "channel", "channelId": "C0123456789", "mode": "message" }
  },
  "message": "Revenue is below target — open the dashboard to see what changed.",
  "cooldown_seconds": 86400
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `artifact_id` | string | yes | Artifact the metric is defined on. |
| `metric_id` | string | yes | Must match an existing definition. |
| `name` | string | yes | Label for the rule. |
| `condition` | object | yes | `{ op, value }` — see Condition Operators. |
| `schedule` | string | yes | 5-field cron (when to check). |
| `destination` | object | yes | `{ kind, config }`. `kind`: `slack`\|`email`\|`discord`\|`webhook`\|`http_get`\|`telegram`. `config` is the matching destination config (see [api/jobs.md](jobs.md#config-interfaces)). |
| `message` | string | no | Author note appended to the alert. |
| `cooldown_seconds` | number | no | Min seconds between deliveries once matched. Default `86400` (1 day), clamped to 60s–30d. |
| `on_trigger` | object | no | Optional follow-up when the alert fires and delivers (manager only). See [Crew investigation](#crew-investigation-on-trigger). |

The default message is built automatically (metric label, current value,
threshold); `message` adds context on top of it.

### Condition Operators

| `op` | Meaning |
|------|---------|
| `gt` / `gte` | Value rises above / at or above `value` |
| `lt` / `lte` | Value drops below / at or below `value` |
| `eq` | Value equals `value` |
| `change_pct_gt` | Percent change vs. the last evaluation is greater than `value` (e.g. `value: 10` = up >10%) |
| `change_pct_lt` | Percent change vs. the last evaluation is less than `value` (e.g. `value: -10` = down >10%) |

> Percent-change operators need a prior reading. The first evaluation only records
> a baseline and never fires; subsequent runs compare against the stored value.

When matched, the rule respects `cooldown_seconds` before delivering again, so a
metric that stays below target won't alert every hour.

### Crew investigation (`on_trigger`)

**Manager only** (artifact owner/editor). After the alert **successfully delivers**,
optionally run the artifact's crew to investigate and post a follow-up summary to
the same destination (Slack, Discord, Telegram, or email).

```json
{
  "on_trigger": {
    "crew": true,
    "instruction": "Summarize what changed and list the top 3 likely causes."
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `crew` | boolean | When `true`, run the artifact crew after delivery. |
| `instruction` | string | Optional prompt for the crew (defaults to a generic investigate prompt). |

- Viewers cannot enable crew follow-up on personal alerts (prevents spending the owner's crew credits).
- Crew failure never affects the alert outcome — the threshold alert already delivered; the investigation is a bonus message prefixed `Crew investigation:`.
- Set `on_trigger` to `null` on `PATCH` to disable.

### PATCH /v1/metric-alerts/{id}

Supports `enabled`, `schedule`, `condition`, `message`, `cooldown_seconds`, and `on_trigger`.

### Response

```json
{
  "alert": {
    "id": "alert_abc123",
    "artifact_id": "art_abc123",
    "metric_id": "revenue",
    "name": "Revenue dropped below target",
    "condition": { "op": "lt", "value": 100000 },
    "schedule": "0 * * * *",
    "destination_kind": "slack",
    "cooldown_seconds": 86400,
    "next_run_at": 1750000000,
    "last_value": null,
    "last_triggered_at": null,
    "last_status": null,
    "enabled": true
  }
}
```

### GET /v1/metric-alerts/{id}/events

```json
{
  "events": [
    { "id": "mev_…", "evaluated_at": 1750003600, "value": 92420, "matched": 1,
      "delivered": 1, "destination_kind": "slack", "error": null,
      "message": "Revenue is now 92420 (alert threshold: below 100000)." }
  ]
}
```

## Rate Limits

| Limit | Value |
|-------|-------|
| Metrics per artifact | 10 |
| Active alert rules per artifact | 20 |
| Active personal alerts per user (viewers) | 10 |
| Rules evaluated per scheduled tick | 50 |

## Error Codes

| Status | When |
|--------|------|
| 400 | Invalid cron, unknown `op`/`source.type`, undefined `metric_id`, bad destination config, quota reached |
| 403 | Viewer using a non-self destination; non-manager defining a metric |
| 404 | Artifact, metric, or alert not found |

## Examples

### Alert a team Slack channel when revenue drops (manager)

```json
// 1) Define the metric (PUT /v1/metric-alerts/definitions)
{
  "artifact_id": "art_abc123",
  "metric_id": "revenue",
  "label": "Revenue",
  "format": "currency:USD",
  "source": { "type": "json_path", "key": "metrics", "path": "$.revenue" }
}
// 2) Create the rule (POST /v1/metric-alerts)
{
  "artifact_id": "art_abc123",
  "metric_id": "revenue",
  "name": "Revenue below target",
  "condition": { "op": "lt", "value": 100000 },
  "schedule": "0 9 * * 1-5",
  "destination": { "kind": "slack", "config": { "connection": "team", "targetType": "channel", "channelId": "C0123456789", "mode": "message" } }
}
```

### Viewer follows a metric with a Slack DM to themselves

```json
{
  "artifact_id": "art_abc123",
  "metric_id": "signups",
  "name": "Signups spiked",
  "condition": { "op": "change_pct_gt", "value": 25 },
  "schedule": "0 * * * *",
  "destination": { "kind": "slack", "config": { "connection": "team", "targetType": "dm", "slackUserId": "U0123456789", "mode": "message" } }
}
```

### Viewer follows a metric with Telegram (linked chat)

```json
{
  "artifact_id": "art_abc123",
  "metric_id": "signups",
  "name": "Signups spiked",
  "condition": { "op": "change_pct_gt", "value": 25 },
  "schedule": "0 * * * *",
  "destination": { "kind": "telegram", "config": { "mode": "message" } }
}
```

Omit `chatId` in `TelegramConfig` to deliver to the rule creator's linked Telegram chat.

### Alert with crew investigation (manager)

```json
{
  "artifact_id": "art_abc123",
  "metric_id": "revenue",
  "name": "Revenue below target",
  "condition": { "op": "lt", "value": 100000 },
  "schedule": "0 9 * * 1-5",
  "destination": { "kind": "slack", "config": { "connection": "team", "targetType": "channel", "channelId": "C0123456789", "mode": "message" } },
  "on_trigger": { "crew": true, "instruction": "Explain the drop and suggest next steps." }
}
```

### Alert on a table aggregate (open tickets exceed 50)

```json
// definition
{ "artifact_id": "art_abc123", "metric_id": "open_tickets", "label": "Open tickets",
  "source": { "type": "table_count", "table": "tickets", "where": { "status": "open" } } }
// rule
{ "artifact_id": "art_abc123", "metric_id": "open_tickets", "name": "Backlog alert",
  "condition": { "op": "gt", "value": 50 }, "schedule": "0 */2 * * *",
  "destination": { "kind": "email", "config": { "recipients": ["ops@company.com"] } } }
```

## Related

- [Pattern: Dashboards](../patterns/dashboards.md#followable-kpis-metric-alerts) - Make a KPI followable
- [REST API: Jobs](jobs.md) - Scheduled delivery + destination config interfaces
- [Delivery layer](destinations.md) - Slack/email/discord/webhook config shapes
- [SDK: json](../sdk/json.md) - Storing KPI values the evaluator reads
