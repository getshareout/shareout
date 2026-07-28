---
title: Crew tools
description: Built-in read and write tools for artifact crews — data queries, snapshots, delivery, and approvals.
---

import { Aside } from '@astrojs/starlight/components';

Grant tools when you call `sdk.crew.define({ tools: { read: [...], write: [...] } })`.
The runtime only exposes what the owner enabled — artifact HTML cannot widen grants.

```javascript
await sdk.crew.define({
  instructions: '…',
  tools: {
    read: ['json_get', 'connection_query'],
    write: ['json_set', 'notify_send'],
    approval: { notify_send: 'always', json_set: 'whenPublic' },
    limits: { connection_query: { maxCalls: 5, maxRows: 100 } },
  },
});
```

## Read tools

| Tool | What it does |
| --- | --- |
| `json_get` | Read a key from the artifact JSON store |
| `table_query` | Query rows from an artifact table (filters, limits) |
| `table_schema` | Inspect table column names and types |
| `connection_query` | Query a [workspace connection](/teams/connections/) — REST or warehouse SQL |
| `web_search` | Web lookup (when enabled for the workspace) |

### `connection_query`

Query a workspace connection by name.

- **REST:** `query = "GET /endpoint/path"`
- **Warehouse (BigQuery, Snowflake, …):** `query` = SQL string; pass `params.projectId` for BigQuery

Returns rows into the crew conversation — best for **aggregates and small result sets**.

Runs as the **artifact owner**, including `per_user` connectors, so unattended crews
can query BigQuery the same way the interactive data API does.

```jsonc
{
  "connection": "team_bigquery",
  "query": "SELECT region, SUM(revenue) AS revenue FROM analytics.daily GROUP BY 1",
  "params": { "projectId": "my-gcp-project" }
}
```

## Write tools

| Tool | What it does |
| --- | --- |
| `json_set` | Write or merge a value in the JSON store |
| `materialize_query` | Run a connection query and **save** results without loading every row into the conversation |
| `table_insert` | Insert rows into an artifact table |
| `table_update` | Update rows by id or filter |
| `comment_create` | Add a comment on the artifact |
| `email_send` | Send email from the artifact |
| `notify_send` | One-shot delivery to Slack, email, Discord, or webhook |
| `scheduled_job_create` | Create a recurring [scheduled job](/guides/jobs/) |

### `json_set`

Owner-scoped write to the artifact JSON store. Creates or replaces a key; optional
`path` merges one field inside the key's object.

Use for computed summaries, status flags, or narratives the page reads on next load.

<Aside type="note">
Blocked when a row-level `access_policy` is active — the JSON store is owner/editor-only
under a policy.
</Aside>

### `materialize_query`

Run a connection query and save results. Same target shapes as [`query_snapshot`](/guides/jobs/):

| `target.type` | Writes to |
| --- | --- |
| `table` | `sdk.table(name)` |
| `dataset` | `sdk.dataset(name)` |
| `json` | `sdk.json` key `name`; optional `path` merges at a field inside the object |

```jsonc
{
  "connection": "team_bigquery",
  "query": "SELECT * FROM `project.dataset.table` LIMIT 500",
  "params": { "projectId": "my-gcp-project" },
  "target": { "type": "json", "name": "snapshot", "path": "rows" }
}
```

Use **`query_snapshot` jobs** when SQL is stable. Use **`materialize_query`** when the
agent should decide what to refresh interactively.

### `notify_send`

One-shot delivery via the shared destination layer. Pass a top-level `message` for the
crew's narrative — forwarded as `customMessage`. Slack `mode: "both"` attaches a
dashboard screenshot and link alongside the message.

```jsonc
{
  "destination": "slack",
  "message": "*Daily summary*\nRevenue up 12% vs yesterday.",
  "config": {
    "connection": "team",
    "channelId": "C0123456789",
    "mode": "both"
  },
  "source": {
    "connection": "warehouse",
    "query": "SELECT … FROM metrics.daily_revenue …",
    "asOf": "2026-06-22"
  }
}
```

Pass `source` when delivering data-derived numbers — a compact attribution footer
(`_Source: … · as of …_` plus the one-line query) is appended so recipients can
trace where the figures came from. See [Data provenance](/guides/data-provenance/).

See [Slack integration](/integrations/slack/) for connection and channel setup.

### `scheduled_job_create`

Creates a recurring job (`POST /v1/jobs` under the hood). Config shapes match
[Scheduling jobs](/guides/jobs/).

## Write approvals

| Policy | When approval is required |
| --- | --- |
| `never` | Execute immediately (owner already authorized the grant) |
| `always` | Every call queues for owner approval |
| `whenPublic` | Only when the artifact is publicly accessible |

```javascript
approval: {
  notify_send: 'always',
  table_insert: 'whenPublic',
}
```

```javascript
const { approvals } = await sdk.crew.approvals.list('pending');
await sdk.crew.approvals.approve(approvals[0].id);
```

## Tool limits

Per-tool caps in `limits`:

```javascript
limits: {
  connection_query: { maxCalls: 10, maxRows: 500 },
  materialize_query: { maxCalls: 3 },
}
```
