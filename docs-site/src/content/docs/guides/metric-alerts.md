---
title: Metric alerts
description: Follow a number on a dashboard and get alerted when it crosses a threshold.
---

A metric alert watches a number on an artifact and notifies you when it crosses a
threshold — "tell me when revenue drops below 100k" — delivered to Slack, email,
Discord, or a webhook. It checks the artifact's stored data on a schedule, so the
dashboard and the alert always agree.

## How it works

1. **Expose a followable metric** on the artifact (a manager does this once).
2. **Subscribe to it** with a condition, a schedule, and a destination.

The evaluator reads stored data, never the rendered page — so write the displayed
KPI to your JSON store (or a table), then point the metric at it.

## 1. Define a metric

```bash
curl -X PUT https://shareout.site/v1/metric-alerts/definitions \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{
    "artifact_id": "art_abc123",
    "metric_id": "revenue",
    "label": "Revenue",
    "format": "currency:USD",
    "source": { "type": "json_path", "key": "metrics", "path": "$.revenue" }
  }'
```

| Source | Reads |
| --- | --- |
| `json_path` | A value inside a JSON-store key (e.g. `$.revenue`) |
| `table_count` | Row count of a table (optional `where` filter) |
| `table_aggregate` | `sum` / `avg` / `min` / `max` of a numeric field |

## 2. Create an alert

```bash
curl -X POST https://shareout.site/v1/metric-alerts \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{
    "artifact_id": "art_abc123",
    "metric_id": "revenue",
    "name": "Revenue below target",
    "condition": { "op": "lt", "value": 100000 },
    "schedule": "0 9 * * 1-5",
    "destination": {
      "kind": "slack",
      "config": { "connection": "team", "targetType": "channel", "channelId": "C0123456789", "mode": "message" }
    }
  }'
```

### Conditions

| Operator | Fires when the value… |
| --- | --- |
| `gt` / `gte` | rises above / at or above the threshold |
| `lt` / `lte` | drops below / at or below |
| `eq` | equals it |
| `change_pct_gt` / `change_pct_lt` | moves up / down more than N% since the last check |

`schedule` is a cron expression (how often to check). A **cooldown** (default 1
day) stops a metric that stays past its threshold from alerting on every check.

## Who can do what

- **Managers** (artifact owner/editor, or a workspace owner/admin) define metrics
  and send alerts anywhere — team Slack channels, webhooks, any email.
- **Viewers** can subscribe to themselves only — a Slack DM or an email to their
  own address. On a published page they can do this from the **Follow metric**
  button in the toolbar.

## Run, pause, inspect

| Action | Endpoint |
| --- | --- |
| Check now | `POST /v1/metric-alerts/{id}/run` |
| Pause | `PATCH /v1/metric-alerts/{id}` → `{ "enabled": false }` |
| History | `GET /v1/metric-alerts/{id}/events` |

Related: [Scheduling jobs](/guides/jobs/) for recurring delivery without a threshold.
For a natural-language **investigation** when an alert fires, add `on_trigger.crew` —
see [Crew](/guides/crew/#metric-alert-investigation).

## Metric watches

**Metric watches** are a lighter sibling of metric alerts — zero destination
config, bell-only. From an open page's Inspector → **Watches**, pick a table and
a metric kind:

| Kind | Watches |
| --- | --- |
| `count` | Row count of a table |
| `sum` | Sum of a numeric column |
| `last` | Most recent value of a column |

An hourly sweep compares the current value to the stored baseline. When it moves
**±20%** (default, configurable), you get a **metric watch** card in the bell.
Cooldown is six hours between repeat alerts for the same watch.

| | Metric alerts | Metric watches |
| --- | --- | --- |
| Setup | Define metric + condition + cron + destination | Pick table + kind in Inspector |
| Delivery | Slack, email, Discord, webhook | Bell only |
| Use case | "Tell me when revenue &lt; 100k every weekday" | "Ping me if this table row count jumps" |

### API

```http
POST   /v1/metric-watch     { "artifact_id", "table", "kind", "column?", "threshold_pct?" }
GET    /v1/metric-watch?artifact_id=…
DELETE /v1/metric-watch/{id}
```

Auth: session cookie or API token. The workspace assistant also exposes a
`watch_metric` tool for the same create flow.
