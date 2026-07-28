---
title: Crew patterns & examples
description: Production patterns for artifact crews — refresh, narrate, deliver, and real-world setups.
---

## Refresh → narrate → deliver

The most common production chain for warehouse-backed dashboards:

| Step | Mechanism | LLM? |
| --- | --- | --- |
| **Refresh** | [`query_snapshot` job](/guides/jobs/) on cron | No — fixed SQL → `sdk.json` / tables |
| **Narrate** | Crew reads data (`json_get`), optional `connection_query` | Yes — summary via `json_set` |
| **Deliver** | Crew `notify_send` or a separate delivery job | Optional |

1. **Refresh (deterministic)** — cron job runs fixed SQL against a workspace connection
   and writes into `sdk.json` or tables. No LLM; SQL lives in job config.
2. **Narrate (crew)** — scheduled crew reads refreshed json, writes a summary, does small
   follow-up lookups if needed.
3. **Deliver (crew or job)** — `notify_send` posts narrative (+ screenshot/link) to
   Slack/email, or a delivery job runs on the same schedule.

## Daily Slack briefing

A programmatic ads dashboard: BigQuery refresh every morning, written briefing to Slack.

**1. Refresh job** (12:50 UTC) — chart queries + compact `digest` json key:

```bash
curl -X POST https://shareout.site/v1/jobs \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{
    "artifact_id": "art_dashboard",
    "action": "query_snapshot",
    "schedule": "50 12 * * *",
    "config": {
      "connection": "bigquery",
      "params": { "projectId": "my-gcp-project" },
      "queries": [
        {
          "query": "SELECT … AS last_day_revenue, … AS rev_7d_avg …",
          "target": { "type": "json", "name": "digest", "path": "trends" }
        },
        {
          "query": "SELECT platform, SUM(revenue) …",
          "target": { "type": "json", "name": "digest", "path": "by_platform" }
        }
      ]
    }
  }'
```

**2. Narration crew** (13:00 UTC):

```javascript
await sdk.crew.define({
  name: 'Daily briefing',
  instructions: `
    1. json_get('digest') — trends, by_platform, by_ad_type.
    2. Write a 110–170 word briefing in Slack mrkdwn (*bold*, _italic_, • bullets).
       Use only the numbers given. Lead with the biggest takeaway.
    3. notify_send: destination 'slack', message = your text, config = {
         "connection": "team", "channelId": "C0123456789", "mode": "both"
       }.`,
  model: 'claude-sonnet-4-20250514',
  maxIterations: 6,
  tools: {
    read: ['json_get'],
    write: ['notify_send'],
    approval: { notify_send: 'never' },
  },
});

await sdk.crew.triggers.create({ kind: 'cron', cron: '0 13 * * *' });
```

Splitting refresh and narration keeps cost predictable and data reliable.

## Anomaly monitor

Crew keeps a json alerts list fresh; the dashboard reads it on load.

```javascript
await sdk.crew.define({
  instructions: 'Query sales. If any row has revenue < 0, json_set key "alerts" with ids and dates. Otherwise json_set alerts to [].',
  tools: { read: ['table_query'], write: ['json_set'] },
});

await sdk.crew.triggers.create({ kind: 'cron', cron: '0 */6 * * *' });
```

## Metric alert investigation

When a [metric alert](/guides/metric-alerts/) fires, run the crew to **explain** — not
just ping a number:

```jsonc
{
  "artifact_id": "art_dashboard",
  "metric_id": "revenue",
  "condition": { "op": "lt", "value": 100000 },
  "schedule": "0 9 * * 1-5",
  "destination": { "kind": "slack", "config": { "connection": "team", "channelId": "C…" } },
  "on_trigger": {
    "crew": true,
    "instruction": "Revenue dropped below target. Read json metrics and digest, explain drivers in 3 bullets, notify_send to the same Slack channel."
  }
}
```

Set `on_trigger` to `null` on `PATCH` to disable.

## Warehouse Monday refresh (crew-only)

When SQL isn't fixed in advance:

```javascript
await sdk.crew.define({
  instructions: 'Every Monday: materialize_query last week revenue by region into snapshot.byRegion, then json_set key "narrative" with a 2-sentence summary.',
  tools: {
    read: ['connection_query', 'json_get'],
    write: ['materialize_query', 'json_set'],
  },
});
```

Prefer `query_snapshot` when queries are stable.

## Run from Telegram

Linked owners/editors can trigger the page's crew from **@ShareOutAI_bot** (`ask_crew`).
The bot proposes the run and waits for Confirm. See [Telegram bot](/guides/telegram-bot/).

## Condition trigger

Run when the errors table grows past 10 rows (1-hour cooldown):

```javascript
await sdk.crew.triggers.create({
  kind: 'condition',
  condition: {
    predicate: { table: 'errors', op: 'gt', value: 10 },
    cooldownSeconds: 3600,
  },
});
```

## Inspect runs

```javascript
const { runs } = await sdk.crew.runs.list({ limit: 10 });
const { run, events } = await sdk.crew.runs.get(runs[0].id);

for await (const event of sdk.crew.runs.stream(runs[0].id)) {
  console.log(event.type, event.content ?? event.summary ?? '');
}
```

Each run records `terminationReason` (`finish`, `max_iterations`, `budget_exhausted`, …)
and `costMicroUsd`.
